defmodule Backend.Production do
  @moduledoc """
  Production boundary — Bills of Materials today, manufacturing
  orders + routings + workstations in future passes.

  BOM CRUD enforces:

    * Output item belongs to the actor's company.
    * Item's `item_type` is `finished_product` or `semi_finished`.
      Raw materials and packaging are recipe inputs, never outputs;
      letting them carry BOMs would break the catalog story. The FE
      hides the entry point on the same rule, but the check is
      server-authoritative — a hand-crafted POST gets the same
      rejection.
    * Exactly one `is_primary` row per item (Postgres partial index
      enforces; the `set_primary/2` action clears the previous primary
      in the same transaction).

  Children (`bom_lines`) are replaced wholesale on each save call.
  The wizard / form holds the full set in memory and POSTs the
  current snapshot; deleting a row in the UI shows up as "row not
  present in the payload" on the next save.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.ListQueries
  alias Backend.Items.Item
  alias Backend.Production.{
    BOM,
    BOMLine,
    BOMVersion,
    Workstation,
    WorkstationDefaultWorker,
    WorkstationGroup
  }

  alias Backend.Warehouses.Warehouse
  alias Backend.Repo
  alias Backend.Stock.Lot, as: StockLot

  # Item types that CAN own a BOM. Anything else is a recipe input,
  # never an output. Kept here (rather than the schema) because this
  # is a Production-domain rule — Items doesn't care about BOMs at
  # all.
  @bommable_item_types ~w(finished_product semi_finished)

  @bom_search [:name, :notes]
  @bom_sortable [:inserted_at, :updated_at, :name]
  @bom_default_sort {:inserted_at, :desc}

  # ----- list / get -----------------------------------------------

  @doc """
  Paginated BOM ledger. Filters:

    * `:item_id` — narrow to one output item (used by the Item detail
      page's "BOMs on this item" card).
    * `:is_active` — defaults to all; pass `true` to hide archived.

  Cursor / sort follow the shared `Backend.ListQueries` convention.
  """
  def list_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = Keyword.get(opts, :sort, @bom_default_sort)

    base =
      BOM
      |> where([b], b.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @bom_search)
      |> maybe_item_filter(opts[:item_id])
      |> maybe_active_filter(opts[:is_active])
      |> ListQueries.apply_sort(sort, @bom_sortable, @bom_default_sort)
      |> preload([:item, :created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp maybe_item_filter(query, nil), do: query

  defp maybe_item_filter(query, item_id) when is_integer(item_id),
    do: where(query, [b], b.item_id == ^item_id)

  defp maybe_item_filter(query, raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} -> where(query, [b], b.item_id == ^n)
      _ -> query
    end
  end

  defp maybe_item_filter(query, _), do: query

  defp maybe_active_filter(query, nil), do: query
  defp maybe_active_filter(query, true), do: where(query, [b], b.is_active == true)
  defp maybe_active_filter(query, false), do: where(query, [b], b.is_active == false)
  defp maybe_active_filter(query, "true"), do: where(query, [b], b.is_active == true)
  defp maybe_active_filter(query, "false"), do: where(query, [b], b.is_active == false)
  defp maybe_active_filter(query, _), do: query

  @doc """
  Fetch one BOM by uuid (scoped to the company). Returns the row
  with `:item`, `:lines` (each with `:part` + `:unit_of_measurement`),
  `:created_by`, `:updated_by` preloaded — everything the desktop
  detail page renders without re-querying.
  """
  def get(company_id, uuid) when is_integer(company_id) and is_binary(uuid) do
    Repo.get_by(BOM, uuid: uuid, company_id: company_id)
    |> case do
      nil ->
        nil

      %BOM{} = bom ->
        Repo.preload(bom, [
          :item,
          :created_by,
          :updated_by,
          lines: [:part, :unit_of_measurement]
        ])
    end
  end

  @doc """
  List every BOM on one item — used by the Item detail page's BOMs
  card. Returns the rows preloaded with the same shape `get/2`
  emits so the card can render names + primary flags without a
  follow-up fetch.
  """
  def list_for_item(company_id, item_id)
      when is_integer(company_id) and is_integer(item_id) do
    BOM
    |> where([b], b.company_id == ^company_id and b.item_id == ^item_id)
    |> order_by([b], desc: b.is_primary, desc: b.inserted_at)
    |> preload([:item, :created_by, :updated_by, lines: [:part, :unit_of_measurement]])
    |> Repo.all()
  end

  # ----- create / update / delete ---------------------------------

  @doc """
  Create a fresh BOM. Stamps `is_primary = true` automatically when
  it's the first BOM on the item — that's the most-common case and
  avoids an extra "Set as primary" tap on the first save.
  """
  def create_bom(%User{} = actor, attrs) do
    attrs = stringify_keys(attrs)
    lines_attrs = pull_lines(attrs)

    with {:ok, item} <- fetch_output_item(actor, attrs["item_id"]),
         :ok <- ensure_bommable_item_type(item) do
      existing_count = Repo.aggregate(item_boms_query(actor.company_id, item.id), :count)

      attrs =
        attrs
        |> Map.put("company_id", actor.company_id)
        |> Map.put("item_id", item.id)
        |> Map.put_new("name", default_bom_name(item))
        |> Map.put("created_by_id", actor.id)
        |> Map.put("updated_by_id", actor.id)
        # First BOM on the item → auto-primary. Subsequent ones land
        # as not-primary; promotion is an explicit `set_primary/2` call.
        |> maybe_default_primary(existing_count == 0)

      Repo.transaction(fn ->
        with {:ok, bom} <-
               %BOM{}
               |> BOM.changeset(attrs)
               |> Repo.insert(),
             {:ok, lines} <- replace_lines(actor, bom, lines_attrs),
             {:ok, _version} <-
               snapshot_version(actor, bom, lines, attrs["version_notes"]) do
          Audit.record_created(actor, "bom", bom, snapshot(bom))
          {bom, lines}
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
      |> case do
        {:ok, {bom, _lines}} -> {:ok, reload(bom)}
        other -> other
      end
    end
  end

  @doc """
  Update an existing BOM's header + replace its lines.
  """
  def update_bom(%User{} = actor, %BOM{} = bom, attrs) do
    attrs = stringify_keys(attrs)
    lines_attrs = pull_lines(attrs)
    before = snapshot(bom)

    attrs =
      attrs
      |> Map.delete("company_id")
      |> Map.delete("item_id")
      |> Map.delete("is_primary")
      |> Map.put("updated_by_id", actor.id)

    Repo.transaction(fn ->
      with {:ok, updated} <-
             bom
             |> BOM.changeset(attrs)
             |> Repo.update(),
           {:ok, lines} <- replace_lines(actor, updated, lines_attrs),
           {:ok, _version} <-
             snapshot_version(actor, updated, lines, attrs["version_notes"]) do
        Audit.record_updated(actor, "bom", updated, before, snapshot(updated))
        {updated, lines}
      else
        {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
    |> case do
      {:ok, {bom, _lines}} -> {:ok, reload(bom)}
      other -> other
    end
  end

  @doc """
  List every version row attached to a BOM, newest first.
  """
  def list_versions(%BOM{} = bom) do
    Repo.all(
      from v in BOMVersion,
        where: v.bom_id == ^bom.id,
        order_by: [desc: v.version_no],
        preload: [:created_by]
    )
  end

  @doc """
  Restore a prior version's snapshot onto the live BOM. Writes a new
  version row on top (so the timeline stays monotonic — the revert
  itself is audited as version N+1, never an in-place rewind).
  """
  def revert_to_version(%User{} = actor, %BOM{} = bom, version_no)
      when is_integer(version_no) do
    case Repo.get_by(BOMVersion, bom_id: bom.id, version_no: version_no) do
      nil ->
        {:error, :version_not_found}

      %BOMVersion{snapshot: snapshot} ->
        attrs =
          %{
            "name" => snapshot["name"] || bom.name,
            "notes" => snapshot["notes"],
            "lines" => snapshot["lines"] || [],
            "version_notes" => "Reverted to version #{version_no}"
          }

        update_bom(actor, bom, attrs)
    end
  end

  # Append one snapshot row for the given BOM state. Runs inside the
  # parent transaction so a save + version write are atomic.
  defp snapshot_version(%User{} = actor, %BOM{} = bom, lines, notes) do
    next_no =
      Repo.one(
        from v in BOMVersion,
          where: v.bom_id == ^bom.id,
          select: coalesce(max(v.version_no), 0)
      ) + 1

    snapshot = build_version_snapshot(bom, lines)

    %BOMVersion{}
    |> BOMVersion.changeset(%{
      "company_id" => actor.company_id,
      "bom_id" => bom.id,
      "version_no" => next_no,
      "snapshot" => snapshot,
      "notes" => coerce_notes(notes),
      "created_by_id" => actor.id
    })
    |> Repo.insert()
  end

  defp build_version_snapshot(%BOM{} = bom, lines) do
    %{
      "name" => bom.name,
      "notes" => bom.notes,
      "is_primary" => bom.is_primary,
      "is_active" => bom.is_active,
      "item_id" => bom.item_id,
      "lines" =>
        Enum.map(lines, fn l ->
          %{
            "part_id" => l.part_id,
            "qty" => l.qty && Decimal.to_string(l.qty),
            "is_fixed" => l.is_fixed,
            "notes" => l.notes,
            "unit_of_measurement_id" => l.unit_of_measurement_id,
            "sort_order" => l.sort_order
          }
        end)
    }
  end

  defp coerce_notes(nil), do: nil
  defp coerce_notes(""), do: nil
  defp coerce_notes(s) when is_binary(s), do: String.trim(s) |> nil_if_empty()
  defp coerce_notes(_), do: nil
  defp nil_if_empty(""), do: nil
  defp nil_if_empty(s), do: s

  @doc """
  Map of `part_id => last_unit_cost` (Decimal) for the lots in the
  actor's company. Pulled from `stock_lots.unit_cost` on the most
  recently received row per item. The BOM detail page joins this to
  the line list to surface "Average cost" per line.

  Items with no received lots return without a key — the FE renders
  `—` in the column.
  """
  def average_unit_costs(company_id, part_ids)
      when is_integer(company_id) and is_list(part_ids) do
    if part_ids == [] do
      %{}
    else
      from(l in StockLot,
        where:
          l.company_id == ^company_id and
            l.item_id in ^part_ids and
            not is_nil(l.unit_cost),
        order_by: [asc: l.item_id, desc: l.received_at, desc: l.id],
        select: {l.item_id, l.unit_cost}
      )
      |> Repo.all()
      |> Enum.reduce(%{}, fn {item_id, cost}, acc ->
        # Keep the FIRST occurrence per item_id (most recent thanks
        # to the order_by). Subsequent rows are older lots — skip.
        Map.put_new(acc, item_id, cost)
      end)
    end
  end

  @doc """
  Flip `is_primary = true` on the target BOM and `false` on every
  sibling. Wrapped in a transaction so the partial unique index
  never races.
  """
  def set_primary(%User{} = actor, %BOM{} = bom) do
    Repo.transaction(fn ->
      from(b in BOM,
        where: b.item_id == ^bom.item_id and b.id != ^bom.id and b.is_primary == true
      )
      |> Repo.update_all(set: [is_primary: false, updated_at: now()])

      with {:ok, updated} <-
             bom
             |> Ecto.Changeset.change(%{is_primary: true, updated_by_id: actor.id})
             |> Repo.update() do
        Audit.record_updated(
          actor,
          "bom",
          updated,
          %{is_primary: bom.is_primary},
          %{is_primary: true}
        )

        reload(updated)
      else
        {:error, cs} -> Repo.rollback(cs)
      end
    end)
  end

  @doc """
  Delete a BOM and cascade its lines.
  """
  def delete_bom(%User{} = actor, %BOM{} = bom) do
    case Repo.delete(bom) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "bom", deleted, snapshot(deleted))
        {:ok, deleted}

      other ->
        other
    end
  end

  # ----- helpers --------------------------------------------------

  defp fetch_output_item(%User{company_id: company_id}, raw_id) do
    case parse_id(raw_id) do
      nil ->
        {:error, :item_required}

      id ->
        case Repo.get(Item, id) do
          nil ->
            {:error, :item_not_found}

          %Item{company_id: ^company_id} = item ->
            {:ok, item}

          _ ->
            {:error, :item_not_in_company}
        end
    end
  end

  defp ensure_bommable_item_type(%Item{item_type: t}) when t in @bommable_item_types,
    do: :ok

  defp ensure_bommable_item_type(_), do: {:error, :bom_not_allowed_for_item_type}

  defp item_boms_query(company_id, item_id) do
    from b in BOM, where: b.company_id == ^company_id and b.item_id == ^item_id
  end

  defp maybe_default_primary(attrs, true), do: Map.put_new(attrs, "is_primary", true)
  defp maybe_default_primary(attrs, _), do: attrs

  defp default_bom_name(%Item{name: name, id: id}),
    do: "#{name || "Item ##{id}"} BOM"

  defp pull_lines(attrs) do
    Map.get(attrs, "lines") || []
  end

  # Replace every line on a BOM in one shot. Old rows get deleted,
  # new rows get inserted. Simpler than diffing — the BOM editor
  # always holds the full set in memory, so we don't need to merge.
  defp replace_lines(%User{} = actor, %BOM{} = bom, lines_attrs) do
    Repo.delete_all(from l in BOMLine, where: l.bom_id == ^bom.id)

    Enum.with_index(lines_attrs)
    |> Enum.reduce_while({:ok, []}, fn {raw, idx}, {:ok, acc} ->
      attrs =
        raw
        |> stringify_keys()
        |> Map.put("company_id", actor.company_id)
        |> Map.put("bom_id", bom.id)
        |> Map.put_new("sort_order", idx)

      case %BOMLine{} |> BOMLine.changeset(attrs) |> Repo.insert() do
        {:ok, line} -> {:cont, {:ok, [line | acc]}}
        {:error, cs} -> {:halt, {:error, {:line_failed, idx, cs}}}
      end
    end)
    |> case do
      {:ok, lines} -> {:ok, Enum.reverse(lines)}
      other -> other
    end
  end

  defp reload(%BOM{} = bom) do
    Repo.preload(
      bom,
      [
        :item,
        :created_by,
        :updated_by,
        lines: [:part, :unit_of_measurement]
      ],
      force: true
    )
  end

  defp snapshot(%BOM{} = bom) do
    %{
      name: bom.name,
      is_primary: bom.is_primary,
      is_active: bom.is_active,
      item_id: bom.item_id
    }
  end

  defp stringify_keys(attrs) when is_map(attrs) do
    Enum.into(attrs, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      {k, v} -> {k, v}
    end)
  end

  defp parse_id(nil), do: nil
  defp parse_id(""), do: nil
  defp parse_id(n) when is_integer(n), do: n

  defp parse_id(raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp parse_id(_), do: nil

  defp now, do: DateTime.utc_now() |> DateTime.truncate(:second)

  # ============================================================
  # Workstation groups
  # ============================================================
  #
  # A workstation group is a named cluster of identical workstations
  # (an oven bank, a packaging line). Individual workstations come in
  # a later pass; the group is the parent every workstation will point
  # at. Fields mirror the MRPEasy reference (Name, Instances, Type,
  # Hourly rate, custom working hours / holidays, Colour, Notes).

  @wg_search [:name, :notes]
  @wg_sortable [:inserted_at, :updated_at, :name]
  @wg_default_sort {:inserted_at, :desc}

  @doc """
  Paginated workstation-group ledger. Filters:

    * `:kind` — `active_processing` / `passive_processing`.
    * `:is_active` — defaults to all; pass `true` to hide archived.

  Sort + cursor follow `Backend.ListQueries`.
  """
  def list_workstation_groups_page(company_id, opts \\ [])
      when is_integer(company_id) do
    sort = Keyword.get(opts, :sort, @wg_default_sort)

    base =
      WorkstationGroup
      |> where([g], g.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @wg_search)
      |> maybe_wg_kind_filter(opts[:kind])
      |> maybe_active_filter(opts[:is_active])
      |> ListQueries.apply_sort(sort, @wg_sortable, @wg_default_sort)
      |> preload([:created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp maybe_wg_kind_filter(query, nil), do: query

  defp maybe_wg_kind_filter(query, kind) when kind in ~w(active_processing passive_processing),
    do: where(query, [g], g.kind == ^kind)

  defp maybe_wg_kind_filter(query, _), do: query

  @doc """
  Fetch a workstation group by uuid, scoped to the company. Preloads
  the audit actor associations the detail page renders.
  """
  def get_workstation_group(company_id, uuid)
      when is_integer(company_id) and is_binary(uuid) do
    WorkstationGroup
    |> where([g], g.company_id == ^company_id and g.uuid == ^uuid)
    |> preload([:created_by, :updated_by])
    |> Repo.one()
  end

  @doc """
  Create a workstation group under the actor's company. Stamps the
  audit log and returns the row preloaded.
  """
  def create_workstation_group(%User{} = actor, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("company_id", actor.company_id)
      |> Map.put("created_by_id", actor.id)
      |> Map.put("updated_by_id", actor.id)

    %WorkstationGroup{}
    |> WorkstationGroup.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, group} ->
        Audit.record_created(actor, "workstation_group", group, wg_snapshot(group))
        {:ok, reload_workstation_group(group)}

      {:error, _} = err ->
        err
    end
  end

  @doc """
  Update an existing workstation group. Strips identity fields the
  client can't change (company_id, created_by).
  """
  def update_workstation_group(%User{} = actor, %WorkstationGroup{} = group, attrs) do
    before = wg_snapshot(group)

    attrs =
      attrs
      |> stringify_keys()
      |> Map.delete("company_id")
      |> Map.delete("created_by_id")
      |> Map.put("updated_by_id", actor.id)

    group
    |> WorkstationGroup.changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(actor, "workstation_group", updated, before, wg_snapshot(updated))
        {:ok, reload_workstation_group(updated)}

      {:error, _} = err ->
        err
    end
  end

  @doc """
  Delete a workstation group. Hard delete for now — workstations
  hanging off the group land in a later migration with a
  `:restrict` on_delete so we won't silently lose those links once
  they exist.
  """
  def delete_workstation_group(%User{} = actor, %WorkstationGroup{} = group) do
    before = wg_snapshot(group)

    case Repo.delete(group) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "workstation_group", deleted, before)
        {:ok, deleted}

      err ->
        err
    end
  end

  defp reload_workstation_group(%WorkstationGroup{} = g),
    do: Repo.preload(g, [:created_by, :updated_by], force: true)

  # Audit snapshot — every column the operator can change at form time.
  defp wg_snapshot(%WorkstationGroup{} = g) do
    %{
      name: g.name,
      notes: g.notes,
      instances: g.instances,
      kind: g.kind,
      hourly_rate_enabled: g.hourly_rate_enabled,
      hourly_rate: g.hourly_rate,
      custom_working_hours: g.custom_working_hours,
      working_hours: g.working_hours,
      custom_holidays: g.custom_holidays,
      holidays: g.holidays,
      color: g.color,
      is_active: g.is_active
    }
  end

  # ============================================================
  # Workstations
  # ============================================================
  #
  # One workstation = one physical machine / line slot / cell inside
  # a workstation group on a production-facility-kind site. Default
  # workers (M2M) ride on `workstation_default_workers`. Sync with
  # vita-performance keys on `external_id` (UUID).

  @ws_search [:name, :notes]
  @ws_sortable [:inserted_at, :updated_at, :name]
  @ws_default_sort {:inserted_at, :desc}

  def list_workstations_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = Keyword.get(opts, :sort, @ws_default_sort)

    base =
      Workstation
      |> where([w], w.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @ws_search)
      |> maybe_ws_group_filter(opts[:workstation_group_id])
      |> maybe_ws_warehouse_filter(opts[:warehouse_id])
      |> maybe_active_filter(opts[:is_active])
      |> ListQueries.apply_sort(sort, @ws_sortable, @ws_default_sort)
      |> preload([:workstation_group, :warehouse, :created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp maybe_ws_group_filter(query, nil), do: query

  defp maybe_ws_group_filter(query, id) when is_integer(id),
    do: where(query, [w], w.workstation_group_id == ^id)

  defp maybe_ws_group_filter(query, raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} -> where(query, [w], w.workstation_group_id == ^n)
      _ -> query
    end
  end

  defp maybe_ws_group_filter(query, _), do: query

  defp maybe_ws_warehouse_filter(query, nil), do: query

  defp maybe_ws_warehouse_filter(query, id) when is_integer(id),
    do: where(query, [w], w.warehouse_id == ^id)

  defp maybe_ws_warehouse_filter(query, raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} -> where(query, [w], w.warehouse_id == ^n)
      _ -> query
    end
  end

  defp maybe_ws_warehouse_filter(query, _), do: query

  def get_workstation(company_id, uuid)
      when is_integer(company_id) and is_binary(uuid) do
    Workstation
    |> where([w], w.company_id == ^company_id and w.uuid == ^uuid)
    |> preload([
      :workstation_group,
      :warehouse,
      :created_by,
      :updated_by,
      default_worker_assignments: :user
    ])
    |> Repo.one()
  end

  @doc """
  Create a workstation. The `default_worker_ids` key (if present) is
  pulled off the attrs map and replayed as M2M inserts inside the
  same transaction so the row + its assignments commit atomically.

  Refuses to create against a non-production-facility warehouse —
  workstations are a production concept and a warehouse-kind row
  hosting them would short-circuit a future capability check.
  """
  def create_workstation(%User{} = actor, attrs) do
    {worker_ids, attrs} = pull_worker_ids(attrs)
    attrs = stringify_keys(attrs)

    attrs =
      attrs
      |> Map.put("company_id", actor.company_id)
      |> Map.put("created_by_id", actor.id)
      |> Map.put("updated_by_id", actor.id)
      # Block any client attempt to populate the sync hook directly.
      |> Map.delete("external_id")

    with :ok <- ensure_production_facility(actor, attrs["warehouse_id"]),
         :ok <- ensure_group_in_company(actor, attrs["workstation_group_id"]) do
      Repo.transaction(fn ->
        with {:ok, ws} <-
               %Workstation{}
               |> Workstation.changeset(attrs)
               |> Repo.insert(),
             {:ok, _} <- replace_default_workers(actor, ws, worker_ids) do
          Audit.record_created(actor, "workstation", ws, ws_snapshot(ws))
          ws
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
      |> case do
        {:ok, ws} -> {:ok, reload_workstation(ws)}
        other -> other
      end
    end
  end

  def update_workstation(%User{} = actor, %Workstation{} = ws, attrs) do
    {worker_ids, attrs} = pull_worker_ids(attrs)
    attrs = stringify_keys(attrs)
    before = ws_snapshot(ws)

    attrs =
      attrs
      |> Map.delete("company_id")
      |> Map.delete("created_by_id")
      |> Map.delete("external_id")
      |> Map.put("updated_by_id", actor.id)

    with :ok <-
           (if Map.has_key?(attrs, "warehouse_id"),
              do: ensure_production_facility(actor, attrs["warehouse_id"]),
              else: :ok),
         :ok <-
           (if Map.has_key?(attrs, "workstation_group_id"),
              do: ensure_group_in_company(actor, attrs["workstation_group_id"]),
              else: :ok) do
      Repo.transaction(fn ->
        with {:ok, updated} <-
               ws
               |> Workstation.changeset(attrs)
               |> Repo.update(),
             {:ok, _} <-
               (if is_list(worker_ids),
                  do: replace_default_workers(actor, updated, worker_ids),
                  else: {:ok, :unchanged}) do
          Audit.record_updated(
            actor,
            "workstation",
            updated,
            before,
            ws_snapshot(updated)
          )

          updated
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
      |> case do
        {:ok, ws} -> {:ok, reload_workstation(ws)}
        other -> other
      end
    end
  end

  def delete_workstation(%User{} = actor, %Workstation{} = ws) do
    before = ws_snapshot(ws)

    case Repo.delete(ws) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "workstation", deleted, before)
        {:ok, deleted}

      err ->
        err
    end
  end

  defp reload_workstation(%Workstation{} = ws) do
    Repo.preload(
      ws,
      [
        :workstation_group,
        :warehouse,
        :created_by,
        :updated_by,
        default_worker_assignments: :user
      ],
      force: true
    )
  end

  defp pull_worker_ids(attrs) do
    case Map.pop(attrs, "default_worker_ids", :unset) do
      {:unset, attrs} ->
        case Map.pop(attrs, :default_worker_ids, :unset) do
          {:unset, attrs} -> {nil, attrs}
          {ids, attrs} -> {normalise_ids(ids), attrs}
        end

      {ids, attrs} ->
        {normalise_ids(ids), attrs}
    end
  end

  defp normalise_ids(ids) when is_list(ids) do
    ids
    |> Enum.map(fn
      n when is_integer(n) -> n
      s when is_binary(s) ->
        case Integer.parse(s) do
          {n, ""} -> n
          _ -> nil
        end
      _ -> nil
    end)
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end

  defp normalise_ids(_), do: []

  defp replace_default_workers(_actor, _ws, nil), do: {:ok, :unchanged}

  defp replace_default_workers(%User{} = actor, %Workstation{} = ws, ids)
       when is_list(ids) do
    # Wholesale-replace: wipe + reinsert inside the parent transaction.
    Repo.delete_all(
      from a in WorkstationDefaultWorker, where: a.workstation_id == ^ws.id
    )

    inserts =
      Enum.map(ids, fn user_id ->
        %{
          workstation_id: ws.id,
          user_id: user_id,
          company_id: actor.company_id,
          inserted_at: now()
        }
      end)

    case inserts do
      [] -> {:ok, 0}
      rows -> {:ok, elem(Repo.insert_all(WorkstationDefaultWorker, rows), 0)}
    end
  end

  defp ensure_production_facility(_actor, nil), do: {:error, :warehouse_required}

  defp ensure_production_facility(%User{} = actor, id) do
    int_id =
      case id do
        n when is_integer(n) -> n
        s when is_binary(s) ->
          case Integer.parse(s) do
            {n, ""} -> n
            _ -> nil
          end
        _ -> nil
      end

    case int_id && Repo.get(Warehouse, int_id) do
      %Warehouse{company_id: cid, kind: "production_facility"} when cid == actor.company_id ->
        :ok

      %Warehouse{company_id: cid} when cid == actor.company_id ->
        {:error, :site_must_be_production_facility}

      _ ->
        {:error, :warehouse_not_found}
    end
  end

  defp ensure_group_in_company(_actor, nil), do: {:error, :workstation_group_required}

  defp ensure_group_in_company(%User{} = actor, id) do
    int_id =
      case id do
        n when is_integer(n) -> n
        s when is_binary(s) ->
          case Integer.parse(s) do
            {n, ""} -> n
            _ -> nil
          end
        _ -> nil
      end

    case int_id && Repo.get(WorkstationGroup, int_id) do
      %WorkstationGroup{company_id: cid} when cid == actor.company_id -> :ok
      _ -> {:error, :workstation_group_not_found}
    end
  end

  defp ws_snapshot(%Workstation{} = ws) do
    %{
      name: ws.name,
      notes: ws.notes,
      workstation_group_id: ws.workstation_group_id,
      warehouse_id: ws.warehouse_id,
      hourly_rate_enabled: ws.hourly_rate_enabled,
      hourly_rate: ws.hourly_rate,
      productivity: ws.productivity,
      idle_from: ws.idle_from,
      idle_to: ws.idle_to,
      is_active: ws.is_active,
      external_id: ws.external_id
    }
  end
end
