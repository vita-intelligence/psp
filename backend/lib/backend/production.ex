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
    ManufacturingOrder,
    ManufacturingOrderBooking,
    ManufacturingOrderStep,
    ManufacturingOrderStepWorker,
    MOConsumerLink,
    Routing,
    RoutingStep,
    RoutingStepWorker,
    ScheduleWalker,
    Workstation,
    WorkstationDefaultWorker,
    WorkstationGroup
  }

  alias Backend.Warehouses.Warehouse
  alias Backend.Companies.Company
  alias Backend.Repo
  alias Backend.Stock.Lot, as: StockLot
  alias Backend.Stock.Placement, as: StockPlacementAlias

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

  # ============================================================
  # Routings
  # ============================================================
  #
  # Routing = ordered list of operations against workstation groups
  # that turns a BOM's inputs into a finished item. Belongs to an
  # Item (required, same bommable gate as BOMs) + optional BOM.
  #
  # Steps + per-step workers are wholesale-replaced on save inside
  # the same transaction as the header — audit captures one update
  # event per save instead of one per step.

  @routing_search [:name, :notes]
  @routing_sortable [:inserted_at, :updated_at, :name]
  @routing_default_sort {:inserted_at, :desc}

  def list_routings_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = Keyword.get(opts, :sort, @routing_default_sort)

    base =
      Routing
      |> where([r], r.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @routing_search)
      |> maybe_routing_item_filter(opts[:item_id])
      |> maybe_routing_bom_filter(opts[:bom_id])
      |> maybe_active_filter(opts[:is_active])
      |> ListQueries.apply_sort(sort, @routing_sortable, @routing_default_sort)
      |> preload([:item, :bom, :created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp maybe_routing_item_filter(query, nil), do: query

  defp maybe_routing_item_filter(query, id) when is_integer(id),
    do: where(query, [r], r.item_id == ^id)

  defp maybe_routing_item_filter(query, raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} -> where(query, [r], r.item_id == ^n)
      _ -> query
    end
  end

  defp maybe_routing_item_filter(query, _), do: query

  defp maybe_routing_bom_filter(query, nil), do: query

  defp maybe_routing_bom_filter(query, id) when is_integer(id),
    do: where(query, [r], r.bom_id == ^id)

  defp maybe_routing_bom_filter(query, raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} -> where(query, [r], r.bom_id == ^n)
      _ -> query
    end
  end

  defp maybe_routing_bom_filter(query, _), do: query

  def get_routing(company_id, uuid)
      when is_integer(company_id) and is_binary(uuid) do
    Routing
    |> where([r], r.company_id == ^company_id and r.uuid == ^uuid)
    |> preload([
      :item,
      :bom,
      :created_by,
      :updated_by,
      steps: [:workstation_group, worker_assignments: :user]
    ])
    |> Repo.one()
  end

  @doc """
  Create a routing. `steps` and `default_worker_ids` (per step) are
  pulled off attrs and replayed inside a single transaction.
  """
  def create_routing(%User{} = actor, attrs) do
    attrs = stringify_keys(attrs)
    steps_attrs = pull_steps(attrs)

    with {:ok, item} <- fetch_output_item(actor, attrs["item_id"]),
         :ok <- ensure_bommable_item_type(item),
         :ok <- ensure_bom_for_item(actor, item.id, attrs["bom_id"]) do
      attrs =
        attrs
        |> Map.put("company_id", actor.company_id)
        |> Map.put("item_id", item.id)
        |> Map.put_new("name", default_routing_name(item))
        |> Map.put("created_by_id", actor.id)
        |> Map.put("updated_by_id", actor.id)

      Repo.transaction(fn ->
        with {:ok, routing} <-
               %Routing{}
               |> Routing.changeset(attrs)
               |> Repo.insert(),
             {:ok, _steps} <- replace_routing_steps(actor, routing, steps_attrs) do
          Audit.record_created(actor, "routing", routing, routing_snapshot(routing))
          routing
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, {:step_failed, idx, cs}} -> Repo.rollback({:step_failed, idx, cs})
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
      |> case do
        {:ok, routing} -> {:ok, reload_routing(routing)}
        other -> other
      end
    end
  end

  def update_routing(%User{} = actor, %Routing{} = routing, attrs) do
    attrs = stringify_keys(attrs)
    steps_attrs = pull_steps(attrs)
    before = routing_snapshot(routing)

    attrs =
      attrs
      |> Map.delete("company_id")
      |> Map.delete("item_id")
      |> Map.put("updated_by_id", actor.id)

    with :ok <-
           (if Map.has_key?(attrs, "bom_id"),
              do: ensure_bom_for_item(actor, routing.item_id, attrs["bom_id"]),
              else: :ok) do
      Repo.transaction(fn ->
        with {:ok, updated} <-
               routing
               |> Routing.changeset(attrs)
               |> Repo.update(),
             {:ok, _steps} <-
               (if is_list(steps_attrs),
                  do: replace_routing_steps(actor, updated, steps_attrs),
                  else: {:ok, :unchanged}) do
          Audit.record_updated(
            actor,
            "routing",
            updated,
            before,
            routing_snapshot(updated)
          )

          updated
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, {:step_failed, idx, cs}} -> Repo.rollback({:step_failed, idx, cs})
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
      |> case do
        {:ok, routing} -> {:ok, reload_routing(routing)}
        other -> other
      end
    end
  end

  def delete_routing(%User{} = actor, %Routing{} = routing) do
    before = routing_snapshot(routing)

    case Repo.delete(routing) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "routing", deleted, before)
        {:ok, deleted}

      err ->
        err
    end
  end

  defp reload_routing(%Routing{} = r) do
    Repo.preload(
      r,
      [
        :item,
        :bom,
        :created_by,
        :updated_by,
        steps: [:workstation_group, worker_assignments: :user]
      ],
      force: true
    )
  end

  # Pull steps off the attrs map. `nil` means "no steps key given —
  # leave the existing set alone" (matters for PATCH that only edits
  # the header). `[]` means "wipe all steps".
  defp pull_steps(attrs) do
    case Map.get(attrs, "steps", :unset) do
      :unset -> nil
      list when is_list(list) -> list
      _ -> nil
    end
  end

  defp replace_routing_steps(_actor, _routing, nil), do: {:ok, :unchanged}

  defp replace_routing_steps(%User{} = actor, %Routing{} = routing, steps_attrs)
       when is_list(steps_attrs) do
    Repo.delete_all(from s in RoutingStep, where: s.routing_id == ^routing.id)

    steps_attrs
    |> Enum.with_index()
    |> Enum.reduce_while({:ok, []}, fn {raw, idx}, {:ok, acc} ->
      step_attrs =
        raw
        |> stringify_keys()
        |> Map.put("company_id", actor.company_id)
        |> Map.put("routing_id", routing.id)
        |> Map.put_new("sort_order", idx)

      worker_ids = step_attrs |> Map.get("default_worker_ids") |> normalise_ids()

      step_attrs = Map.delete(step_attrs, "default_worker_ids")

      case %RoutingStep{}
           |> RoutingStep.changeset(step_attrs)
           |> Repo.insert() do
        {:ok, step} ->
          assign_step_workers(actor, step, worker_ids)
          {:cont, {:ok, [step | acc]}}

        {:error, cs} ->
          {:halt, {:error, {:step_failed, idx, cs}}}
      end
    end)
    |> case do
      {:ok, steps} -> {:ok, Enum.reverse(steps)}
      err -> err
    end
  end

  defp assign_step_workers(%User{} = actor, %RoutingStep{} = step, ids) when is_list(ids) do
    rows =
      Enum.map(ids, fn user_id ->
        %{
          routing_step_id: step.id,
          user_id: user_id,
          company_id: actor.company_id,
          inserted_at: now()
        }
      end)

    case rows do
      [] -> {:ok, 0}
      list -> {n, _} = Repo.insert_all(RoutingStepWorker, list); {:ok, n}
    end
  end

  defp default_routing_name(%Item{name: name}),
    do: name <> " Routing"

  # If `bom_id` is present and not nil, ensure it belongs to the
  # same company AND points at the same output item as the routing.
  # A BOM for one item paired with a routing for another would
  # silently break MO planning.
  defp ensure_bom_for_item(_actor, _item_id, nil), do: :ok

  defp ensure_bom_for_item(%User{} = actor, item_id, raw_bom_id) do
    int_id =
      case raw_bom_id do
        n when is_integer(n) -> n
        s when is_binary(s) ->
          case Integer.parse(s) do
            {n, ""} -> n
            _ -> nil
          end

        _ -> nil
      end

    case int_id && Repo.get(BOM, int_id) do
      %BOM{company_id: cid, item_id: bom_item_id}
      when cid == actor.company_id and bom_item_id == item_id ->
        :ok

      %BOM{company_id: cid} when cid == actor.company_id ->
        {:error, :bom_item_mismatch}

      _ ->
        {:error, :bom_not_found}
    end
  end

  defp routing_snapshot(%Routing{} = r) do
    %{
      name: r.name,
      notes: r.notes,
      item_id: r.item_id,
      bom_id: r.bom_id,
      is_active: r.is_active,
      other_fixed_cost: r.other_fixed_cost,
      other_variable_cost: r.other_variable_cost,
      other_variable_cost_basis: r.other_variable_cost_basis
    }
  end

  # ============================================================
  # Manufacturing orders
  # ============================================================
  #
  # Status state machine:
  #   draft       → approved | cancelled
  #   approved    → in_progress | cancelled | draft (amend)
  #   in_progress → completed | cancelled
  #   completed   → (terminal)
  #   cancelled   → (terminal)

  @mo_search [:revision, :notes]
  @mo_sortable [:inserted_at, :updated_at, :due_date]
  @mo_default_sort {:inserted_at, :desc}

  # Status-change pairs that the generic transition endpoint accepts.
  # Approval-flow transitions (prepare / approve / reject / amend) and
  # scheduling (schedule_mo / unschedule_mo) go through their own
  # context functions so the side effects (cascade, 4-eyes rule,
  # required reason, step time writes) can be enforced cleanly.
  @mo_transitions %{
    {"draft", "cancelled"} => "production.mo_execute",
    {"prepared", "cancelled"} => "production.mo_execute",
    {"approved", "cancelled"} => "production.mo_execute",
    {"scheduled", "cancelled"} => "production.mo_execute",
    {"scheduled", "in_progress"} => "production.mo_execute",
    {"in_progress", "completed"} => "production.mo_execute",
    {"in_progress", "cancelled"} => "production.mo_execute"
  }

  def mo_transitions, do: @mo_transitions

  def list_manufacturing_orders_page(company_id, opts \\ [])
      when is_integer(company_id) do
    sort = Keyword.get(opts, :sort, @mo_default_sort)

    base =
      ManufacturingOrder
      |> where([m], m.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @mo_search)
      |> maybe_mo_status_filter(opts[:status])
      |> maybe_mo_item_filter(opts[:item_id])
      |> maybe_mo_warehouse_filter(opts[:warehouse_id])
      |> ListQueries.apply_sort(sort, @mo_sortable, @mo_default_sort)
      |> preload([
        :item,
        :bom,
        :warehouse,
        :assigned_to,
        :prepared_by,
        :approved_by,
        :created_by,
        :updated_by
      ])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp maybe_mo_status_filter(query, nil), do: query

  defp maybe_mo_status_filter(query, s) when is_binary(s) and s != "",
    do: where(query, [m], m.status == ^s)

  defp maybe_mo_status_filter(query, _), do: query

  defp maybe_mo_item_filter(query, nil), do: query

  defp maybe_mo_item_filter(query, id) when is_integer(id),
    do: where(query, [m], m.item_id == ^id)

  defp maybe_mo_item_filter(query, raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} -> where(query, [m], m.item_id == ^n)
      _ -> query
    end
  end

  defp maybe_mo_item_filter(query, _), do: query

  defp maybe_mo_warehouse_filter(query, nil), do: query

  defp maybe_mo_warehouse_filter(query, id) when is_integer(id),
    do: where(query, [m], m.warehouse_id == ^id)

  defp maybe_mo_warehouse_filter(query, raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} -> where(query, [m], m.warehouse_id == ^n)
      _ -> query
    end
  end

  defp maybe_mo_warehouse_filter(query, _), do: query

  def get_manufacturing_order(company_id, uuid)
      when is_integer(company_id) and is_binary(uuid) do
    ManufacturingOrder
    |> where([m], m.company_id == ^company_id and m.uuid == ^uuid)
    |> preload([
      :item,
      :warehouse,
      :assigned_to,
      :approved_by,
      :prepared_by,
      :created_by,
      :updated_by,
      steps: [:workstation_group, :routing_step, worker_assignments: :user],
      bookings: [:item, :storage_cell, stock_lot: [placements: :storage_cell]],
      bom: [lines: [:part, :unit_of_measurement]],
      routing: [steps: [:workstation_group, worker_assignments: :user]],
      parent_mo: [:item],
      children: [:item],
      consumer_links: [consumer_mo: [:item]],
      supplier_links: [batch_mo: [:item]]
    ])
    |> Repo.one()
  end

  def get_mo_step(company_id, uuid)
      when is_integer(company_id) and is_binary(uuid) do
    ManufacturingOrderStep
    |> where([s], s.company_id == ^company_id and s.uuid == ^uuid)
    |> preload([
      :workstation_group,
      :routing_step,
      :manufacturing_order,
      :created_by,
      :updated_by,
      worker_assignments: :user
    ])
    |> Repo.one()
  end

  def create_manufacturing_order(%User{} = actor, attrs) do
    attrs = stringify_keys(attrs)

    attrs =
      attrs
      |> Map.put("company_id", actor.company_id)
      |> Map.put("created_by_id", actor.id)
      |> Map.put("updated_by_id", actor.id)
      |> Map.delete("status")
      |> Map.delete("approved_by_id")
      |> Map.delete("approved_at")
      # Default to the item's primary BOM when the caller hasn't
      # picked one — used by Add-sub-MO from the parts table where
      # the operator only knows the part, not which recipe to pick.
      |> maybe_resolve_bom(actor)
      |> maybe_resolve_routing(actor)

    with :ok <- ensure_mo_site_production_facility(actor, attrs["warehouse_id"]),
         :ok <- ensure_mo_bom_for_item(actor, attrs["item_id"], attrs["bom_id"]) do
      Repo.transaction(fn ->
        with {:ok, mo} <-
               %ManufacturingOrder{}
               |> ManufacturingOrder.changeset(attrs)
               |> Repo.insert(),
             :ok <- snapshot_mo_steps(actor, mo),
             # Auto-book FEFO so existing stock is reserved up-front.
             # Then cascade only the unbooked remainder of semi-finished
             # inputs into child MOs — so a parent that already has
             # half its inputs in stock spawns a child MO only for the
             # missing half.
             {:ok, _bookings} <- book_all_for_mo(actor, mo, strategy: :fefo),
             :ok <- cascade_unbooked_children(actor, mo, 0) do
          Audit.record_created(actor, "manufacturing_order", mo, mo_snapshot(mo))
          mo
        else
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
      |> case do
        {:ok, mo} ->
          # Add-sub-MO under an already-signed parent invalidates the
          # approval — the tree no longer matches what was signed off.
          # The initial cascade-create on a brand-new root MO can't
          # trigger this (the new MO is itself draft so the root walk
          # finds the same draft MO; no-op).
          if mo.parent_mo_id, do: demote_root_if_signed(actor, mo)
          {:ok, reload_manufacturing_order(mo)}

        err ->
          err
      end
    end
  end

  @max_cascade_depth 5

  # Walk the MO's BOM for semi-finished inputs whose existing-stock
  # booking didn't cover the full requirement. For each shortfall,
  # spawn a child MO for the unbooked remainder. The child gets
  # `parent_mo_id` set; its own auto-book + cascade runs recursively
  # so a tree of MOs is created in one shot.
  defp cascade_unbooked_children(_actor, _mo, depth) when depth >= @max_cascade_depth, do: :ok

  defp cascade_unbooked_children(%User{} = actor, %ManufacturingOrder{} = mo, depth) do
    mo = Repo.preload(mo, [:bookings, bom: [lines: :part]], force: true)

    lines =
      case mo.bom do
        %BOM{lines: lines} when is_list(lines) -> lines
        _ -> []
      end

    Enum.each(lines, fn line ->
      maybe_spawn_unbooked_child(actor, mo, line, depth)
    end)

    :ok
  end

  defp maybe_spawn_unbooked_child(%User{} = actor, %ManufacturingOrder{} = mo, line, depth) do
    case line.part do
      %Item{item_type: "semi_finished"} = part ->
        per_output = line.qty || Decimal.new(0)

        required =
          if line.is_fixed do
            per_output
          else
            Decimal.mult(per_output, mo.quantity || Decimal.new(0))
          end

        booked =
          mo.bookings
          |> Enum.filter(fn b ->
            b.item_id == part.id and b.status == "requested"
          end)
          |> Enum.reduce(Decimal.new(0), fn b, acc ->
            Decimal.add(acc, b.quantity || Decimal.new(0))
          end)

        gap = Decimal.sub(required, booked)

        if Decimal.compare(gap, Decimal.new("0")) == :gt do
          spawn_child_mo(actor, mo, part, gap, depth)
        else
          :ok
        end

      _ ->
        :ok
    end
  end

  defp spawn_child_mo(%User{} = actor, %ManufacturingOrder{} = mo, %Item{} = part, gap, depth) do
    case primary_bom_for_item(mo.company_id, part.id) do
      nil ->
        # No BOM on this semi-finished — can't auto-make it. Planner
        # has to fix the catalogue or hand-create the run.
        :ok

      %BOM{id: bom_id} ->
        child_attrs =
          %{
            "company_id" => mo.company_id,
            "warehouse_id" => mo.warehouse_id,
            "item_id" => part.id,
            "bom_id" => bom_id,
            "parent_mo_id" => mo.id,
            "quantity" => gap,
            # Child lands in the backlog without a schedule — the
            # planner places it on the calendar before the parent's
            # start when they're ready.
            "assigned_to_id" => mo.assigned_to_id,
            "revision" => mo.revision,
            "created_by_id" => actor.id,
            "updated_by_id" => actor.id
          }
          |> maybe_resolve_routing(actor)

        case %ManufacturingOrder{}
             |> ManufacturingOrder.changeset(child_attrs)
             |> Repo.insert() do
          {:ok, child} ->
            :ok = snapshot_mo_steps(actor, child)
            Audit.record_created(actor, "manufacturing_order", child, mo_snapshot(child))
            {:ok, _} = book_all_for_mo(actor, child, strategy: :fefo)
            cascade_unbooked_children(actor, child, depth + 1)

          {:error, _cs} ->
            :ok
        end
    end
  end

  @doc """
  Full MO chain centered on `mo` — walks up to the root via
  `parent_mo_id` then collects every descendant breadth-first.
  Returns a flat list of MO records (with item preloaded) so the
  FE can rebuild the tree from `parent_mo_id`. Cycle-safe via a
  seen-set; depth-capped to match the cascade limit.
  """
  def mo_chain(%ManufacturingOrder{} = mo) do
    root = walk_to_root(mo, MapSet.new())
    collect_descendants([root], MapSet.new([root.id]))
  end

  defp walk_to_root(%ManufacturingOrder{parent_mo_id: nil} = mo, _seen) do
    Repo.preload(mo, :item)
  end

  defp walk_to_root(%ManufacturingOrder{parent_mo_id: pid} = mo, seen) do
    cond do
      MapSet.member?(seen, mo.id) ->
        Repo.preload(mo, :item)

      parent = Repo.get(ManufacturingOrder, pid) ->
        walk_to_root(parent, MapSet.put(seen, mo.id))

      true ->
        Repo.preload(mo, :item)
    end
  end

  defp collect_descendants(frontier, seen) when frontier == [], do: []

  defp collect_descendants(frontier, seen) do
    loaded = Enum.map(frontier, &Repo.preload(&1, :item))

    ids = Enum.map(loaded, & &1.id)

    children =
      from(c in ManufacturingOrder,
        where: c.parent_mo_id in ^ids and c.id not in ^MapSet.to_list(seen),
        preload: :item
      )
      |> Repo.all()

    next_seen = Enum.reduce(children, seen, &MapSet.put(&2, &1.id))
    loaded ++ collect_descendants(children, next_seen)
  end

  defp primary_bom_for_item(company_id, item_id) do
    Repo.one(
      from b in BOM,
        where:
          b.company_id == ^company_id and
            b.item_id == ^item_id and
            b.is_active == true,
        order_by: [desc: b.is_primary, desc: b.id],
        limit: 1
    )
  end

  @doc """
  Copy the MO's routing template into per-MO `mo_steps` rows.
  Idempotent: if the MO already has steps, this no-ops.
  Without a routing, also a no-op — the operator can still finish
  the MO; the operations table just stays empty.
  """
  def snapshot_mo_steps(%User{} = actor, %ManufacturingOrder{} = mo) do
    mo =
      Repo.preload(mo, [
        :steps,
        routing: [steps: [:workstation_group, worker_assignments: :user]]
      ])

    cond do
      mo.steps != [] ->
        :ok

      is_nil(mo.routing) ->
        :ok

      true ->
        routing_steps = mo.routing.steps |> Enum.sort_by(& &1.sort_order)

        Enum.each(routing_steps, fn rstep ->
          duration = step_duration_seconds_for_snapshot(rstep, mo.quantity)

          attrs = %{
            "company_id" => mo.company_id,
            "manufacturing_order_id" => mo.id,
            "workstation_group_id" => rstep.workstation_group_id,
            "routing_step_id" => rstep.id,
            "sort_order" => rstep.sort_order,
            "operation_description" =>
              resolve_operation_description(rstep),
            "setup_time_min" => rstep.setup_time_min,
            "cycle_time_min" => rstep.cycle_time_min,
            "fixed_cost" => rstep.fixed_cost,
            "variable_cost" => rstep.variable_cost,
            "capacity" => rstep.capacity,
            # Steps are created with the planned LENGTH baked in
            # but NO position on the calendar. The planner schedules
            # them later via `schedule_mo/3` — that walks the steps
            # forward from a start time using these durations.
            "planned_duration_seconds" => duration,
            "planned_start" => nil,
            "planned_finish" => nil,
            "quantity" => mo.quantity,
            "created_by_id" => actor.id,
            "updated_by_id" => actor.id
          }

          case %ManufacturingOrderStep{}
               |> ManufacturingOrderStep.changeset(attrs)
               |> Repo.insert() do
            {:ok, step} ->
              # Carry over the template's default workers.
              Enum.each(rstep.worker_assignments, fn wa ->
                %ManufacturingOrderStepWorker{}
                |> ManufacturingOrderStepWorker.changeset(%{
                  "manufacturing_order_step_id" => step.id,
                  "user_id" => wa.user_id,
                  "company_id" => mo.company_id
                })
                |> Repo.insert!()
              end)

            {:error, changeset} ->
              throw({:snapshot_failed, changeset})
          end
        end)

        :ok
    end
  catch
    {:snapshot_failed, changeset} -> {:error, changeset}
  end

  # If the routing step has no description of its own, fall back
  # through the group → station chain so a default typed anywhere in
  # that family carries through to the MO.
  defp resolve_operation_description(rstep) do
    cond do
      is_binary(rstep.operation_description) and
          String.trim(rstep.operation_description) != "" ->
        rstep.operation_description

      match?(%Backend.Production.WorkstationGroup{}, rstep.workstation_group) ->
        effective_group_operation_notes(rstep.workstation_group)

      true ->
        nil
    end
  end

  @doc """
  Group's own default, with a station-level fallback. If the group
  hasn't been given a default but at least one of its workstations
  has one, return that station's value. Ties broken by lowest id so
  the choice is deterministic.

  Public so the payload layer can surface this on `workstation_group_summary`
  and the FE prefill matches what the BE snapshot will write.
  """
  def effective_group_operation_notes(%Backend.Production.WorkstationGroup{} = g) do
    cond do
      is_binary(g.default_operation_notes) and
          String.trim(g.default_operation_notes) != "" ->
        g.default_operation_notes

      true ->
        from(w in Workstation,
          where:
            w.workstation_group_id == ^g.id and
              w.is_active == true and
              not is_nil(w.default_operation_notes) and
              fragment("btrim(?) <> ''", w.default_operation_notes),
          order_by: [asc: w.id],
          limit: 1,
          select: w.default_operation_notes
        )
        |> Repo.one()
    end
  end

  def effective_group_operation_notes(_), do: nil

  # Mirror of payloads' step_duration_seconds, kept here so the
  # snapshot doesn't reach into the web layer.
  defp step_duration_seconds_for_snapshot(step, qty) do
    setup = step.setup_time_min || Decimal.new("0")
    cycle = step.cycle_time_min || Decimal.new("0")
    capacity = step.capacity || Decimal.new("1")
    quantity = qty || Decimal.new("0")

    cycle_total =
      if Decimal.equal?(capacity, Decimal.new("0")) do
        Decimal.new("0")
      else
        cycle |> Decimal.mult(quantity) |> Decimal.div(capacity)
      end

    Decimal.add(setup, cycle_total)
    |> Decimal.mult(Decimal.new("60"))
    |> Decimal.round(0, :ceiling)
    |> Decimal.to_integer()
  end

  @doc """
  Move a single step to a new starting time, re-walking through
  working hours so the step's `planned_start` / `planned_finish`
  never land inside closed time. Used by the workstation-view op
  drag — the manager grabs an op block, drops it on a new time
  slot, and the walker auto-pushes the step to the next valid
  working window if the drop landed in a night/weekend/holiday.

  Optional `:workstation_group_id` reassigns the step to a
  different WSG (e.g. dragging onto a different row).

  Returns `{:ok, step, %{outside_hours_seconds: N}}` mirroring the
  schedule_mo shape — non-zero outside hours means the step's
  duration overflowed past available working windows.
  """
  def move_mo_step(actor, step, new_start_dt, opts \\ [])

  def move_mo_step(
        %User{} = actor,
        %ManufacturingOrderStep{} = step,
        %DateTime{} = new_start_dt,
        opts
      ) do
    cond do
      DateTime.compare(new_start_dt, now()) == :lt ->
        {:error, :past_time}

      step_locked_by_pickup?(step) ->
        {:error, :pickup_in_progress}

      true ->
        do_move_mo_step(actor, step, new_start_dt, opts)
    end
  end

  defp step_locked_by_pickup?(%ManufacturingOrderStep{} = step) do
    case Repo.get(ManufacturingOrder, step.manufacturing_order_id) do
      %ManufacturingOrder{} = mo -> mo_pickup_in_progress?(mo)
      _ -> false
    end
  end

  defp do_move_mo_step(actor, step, new_start_dt, opts) do
    mo = Repo.get!(ManufacturingOrder, step.manufacturing_order_id)
    intervals = working_intervals_for_mo(mo, new_start_dt)
    duration = step.planned_duration_seconds || 0

    {:ok,
     %{
       start_at: walked_start,
       finish_at: walked_finish,
       outside_hours_seconds: outside
     }} = ScheduleWalker.walk_forward(intervals, new_start_dt, duration)

    wsg_id = Keyword.get(opts, :workstation_group_id)
    before = mo_step_snapshot(step)

    attrs = %{
      "planned_start" => walked_start,
      "planned_finish" => walked_finish,
      "updated_by_id" => actor.id
    }

    attrs =
      if is_integer(wsg_id) do
        Map.put(attrs, "workstation_group_id", wsg_id)
      else
        attrs
      end

    case step |> ManufacturingOrderStep.changeset(attrs) |> Repo.update() do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "manufacturing_order_step",
          updated,
          before,
          mo_step_snapshot(updated)
        )

        {:ok, updated, %{outside_hours_seconds: outside}}

      {:error, cs} ->
        {:error, cs}
    end
  end

  @doc """
  Persist the planner's explicit work-segment list for a single MO
  step (from the click-to-edit dialog). Segments are stored as the
  literal times the user typed — the walker is NOT consulted. The
  list MUST be in chronological order and may not overlap; pauses
  between consecutive segments are legal.

  planned_start = first segment start; planned_finish = last segment
  finish; planned_duration_seconds = sum of work-segment durations.

  Reject if any segment starts in the past, or if any segment is
  malformed (changeset validation catches the rest).
  """
  def set_mo_step_segments(%User{} = actor, %ManufacturingOrderStep{} = step, segments)
      when is_list(segments) do
    # NOTE on past times: unlike `move_mo_step` (drag-to-reschedule),
    # the planner here is explicitly TYPING values into a form. They
    # may legitimately re-pin an op whose original planned start was
    # in the past (e.g. correcting last week's plan after the fact,
    # or shaving 10 minutes off a paused span that began an hour ago).
    # The change is audit-tracked, so we don't gate it.
    #
    # Pickup-in-progress IS gated, though — once the picker is on the
    # floor we can't move the calendar block out from under them.
    if step_locked_by_pickup?(step) do
      {:error, :pickup_in_progress}
    else
    with {:ok, parsed} <- parse_segment_list(segments) do
      [{first_start, _} | _] = parsed
      {_, last_finish} = List.last(parsed)

      duration_seconds =
        Enum.reduce(parsed, 0, fn {s, f}, acc ->
          acc + DateTime.diff(f, s, :second)
        end)

      jsonb_segments =
        Enum.map(parsed, fn {s, f} ->
          %{"start_at" => DateTime.to_iso8601(s), "finish_at" => DateTime.to_iso8601(f)}
        end)

      before = mo_step_snapshot(step)

      attrs = %{
        "planned_segments" => jsonb_segments,
        "planned_start" => first_start,
        "planned_finish" => last_finish,
        "planned_duration_seconds" => duration_seconds,
        "updated_by_id" => actor.id
      }

      case step |> ManufacturingOrderStep.changeset(attrs) |> Repo.update() do
        {:ok, updated} ->
          Audit.record_updated(
            actor,
            "manufacturing_order_step",
            updated,
            before,
            mo_step_snapshot(updated)
          )

          {:ok, reload_mo_step(updated)}

        {:error, cs} ->
          {:error, cs}
      end
    end
    end
  end

  defp parse_segment_list(list) do
    Enum.reduce_while(list, {:ok, []}, fn seg, {:ok, acc} ->
      start_raw = Map.get(seg, "start_at") || Map.get(seg, :start_at)
      finish_raw = Map.get(seg, "finish_at") || Map.get(seg, :finish_at)

      with start_raw when is_binary(start_raw) <- start_raw,
           finish_raw when is_binary(finish_raw) <- finish_raw,
           {:ok, s, _} <- DateTime.from_iso8601(start_raw),
           {:ok, f, _} <- DateTime.from_iso8601(finish_raw) do
        {:cont, {:ok, acc ++ [{DateTime.shift_zone!(s, "Etc/UTC"), DateTime.shift_zone!(f, "Etc/UTC")}]}}
      else
        _ -> {:halt, {:error, :invalid_segments}}
      end
    end)
  end

  @doc """
  Update one MO step. The form sends the full editable header +
  workers list; we wholesale-replace the worker join rows inside the
  same transaction so audit captures one event.

  Permission gating is enforced upstream by the controller — this
  function trusts the actor to have the right scope.
  """
  def update_mo_step(%User{} = actor, %ManufacturingOrderStep{} = step, attrs) do
    attrs = stringify_keys(attrs)
    before = mo_step_snapshot(step)
    worker_ids = extract_worker_ids(attrs)

    attrs =
      attrs
      |> Map.delete("worker_ids")
      |> Map.delete("workers")
      |> Map.delete("company_id")
      |> Map.delete("manufacturing_order_id")
      |> Map.put("updated_by_id", actor.id)

    Repo.transaction(fn ->
      with {:ok, updated} <-
             step
             |> ManufacturingOrderStep.changeset(attrs)
             |> Repo.update(),
           :ok <- replace_mo_step_workers(updated, worker_ids) do
        Audit.record_updated(
          actor,
          "manufacturing_order_step",
          updated,
          before,
          mo_step_snapshot(updated)
        )

        updated
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
    |> case do
      {:ok, step} -> {:ok, reload_mo_step(step)}
      err -> err
    end
  end

  defp extract_worker_ids(attrs) do
    cond do
      is_list(attrs["worker_ids"]) ->
        attrs["worker_ids"]
        |> Enum.map(&coerce_int/1)
        |> Enum.reject(&is_nil/1)
        |> Enum.uniq()

      is_list(attrs["workers"]) ->
        attrs["workers"]
        |> Enum.map(fn
          %{"id" => id} -> coerce_int(id)
          %{id: id} -> coerce_int(id)
          id when is_integer(id) or is_binary(id) -> coerce_int(id)
          _ -> nil
        end)
        |> Enum.reject(&is_nil/1)
        |> Enum.uniq()

      true ->
        :unchanged
    end
  end

  defp replace_mo_step_workers(_step, :unchanged), do: :ok

  defp replace_mo_step_workers(%ManufacturingOrderStep{} = step, ids) when is_list(ids) do
    from(w in ManufacturingOrderStepWorker,
      where: w.manufacturing_order_step_id == ^step.id
    )
    |> Repo.delete_all()

    Enum.each(ids, fn user_id ->
      %ManufacturingOrderStepWorker{}
      |> ManufacturingOrderStepWorker.changeset(%{
        "manufacturing_order_step_id" => step.id,
        "user_id" => user_id,
        "company_id" => step.company_id
      })
      |> Repo.insert!()
    end)

    :ok
  end

  defp reload_mo_step(%ManufacturingOrderStep{} = step) do
    Repo.preload(
      step,
      [
        :workstation_group,
        :routing_step,
        :manufacturing_order,
        :created_by,
        :updated_by,
        worker_assignments: :user
      ],
      force: true
    )
  end

  defp mo_step_snapshot(%ManufacturingOrderStep{} = step) do
    %{
      operation_description: step.operation_description,
      setup_time_min: step.setup_time_min,
      cycle_time_min: step.cycle_time_min,
      capacity: step.capacity,
      fixed_cost: step.fixed_cost,
      variable_cost: step.variable_cost,
      planned_start: step.planned_start,
      planned_finish: step.planned_finish,
      actual_start: step.actual_start,
      actual_finish: step.actual_finish,
      applied_overhead_cost: step.applied_overhead_cost,
      labor_cost: step.labor_cost,
      quantity: step.quantity,
      workstation_group_id: step.workstation_group_id,
      notes: step.notes
    }
  end

  def update_manufacturing_order(%User{} = actor, %ManufacturingOrder{} = mo, attrs) do
    attrs = stringify_keys(attrs)
    before = mo_snapshot(mo)

    attrs =
      attrs
      |> Map.delete("company_id")
      |> Map.delete("status")
      |> Map.delete("approved_by_id")
      |> Map.delete("approved_at")
      |> Map.put("updated_by_id", actor.id)
      |> maybe_resolve_routing_for_update(actor, mo)

    with :ok <-
           (if Map.has_key?(attrs, "warehouse_id"),
              do: ensure_mo_site_production_facility(actor, attrs["warehouse_id"]),
              else: :ok),
         :ok <-
           (if Map.has_key?(attrs, "bom_id") or Map.has_key?(attrs, "item_id"),
              do:
                ensure_mo_bom_for_item(
                  actor,
                  Map.get(attrs, "item_id", mo.item_id),
                  Map.get(attrs, "bom_id", mo.bom_id)
                ),
              else: :ok) do
      mo
      |> ManufacturingOrder.changeset(attrs)
      |> Repo.update()
      |> case do
        {:ok, updated} ->
          Audit.record_updated(
            actor,
            "manufacturing_order",
            updated,
            before,
            mo_snapshot(updated)
          )

          # Only structural edits break approval — what we're making,
          # not when. Pure scheduling changes (start_at / finish_at /
          # due_date / expiry_date) can be tweaked on an approved MO
          # without re-signing; the rest (item / bom / routing /
          # quantity / assignee / notes / revision) drop the tree
          # back to draft.
          if structural_mo_change?(before, mo_snapshot(updated)) do
            _ = demote_root_if_signed(actor, updated)
          end

          {:ok, reload_manufacturing_order(updated)}

        err ->
          err
      end
    end
  end

  @structural_mo_fields ~w(
    warehouse_id item_id bom_id routing_id quantity
    assigned_to_id revision notes
  )a

  defp structural_mo_change?(before, after_) do
    Enum.any?(@structural_mo_fields, fn key ->
      Map.get(before, key) != Map.get(after_, key)
    end)
  end

  @doc """
  Transition an MO to a new status. Refuses if the pair isn't in
  `@mo_transitions`. Permission gating happens on the controller.
  """
  def transition_mo(%User{} = actor, %ManufacturingOrder{} = mo, to)
      when is_binary(to) do
    case Map.fetch(@mo_transitions, {mo.status, to}) do
      :error ->
        {:error, :invalid_transition, mo.status}

      {:ok, _perm} ->
        # Parent MO can't start until every child finished.
        # Block the approved → in_progress hop specifically; other
        # transitions (cancel, amend) stay open so the planner isn't
        # painted into a corner if a child stalls.
        case ensure_children_complete(mo, to) do
          :ok -> transactional_transition(actor, mo, to)
          {:error, _} = err -> err
        end
    end
  end

  # Wraps the transition so cancel-side effects (releasing bookings,
  # cascade-cancelling open children) are atomic with the status flip
  # itself. A crash mid-way rolls everything back so we never leave
  # an MO half-cancelled.
  defp transactional_transition(%User{} = actor, %ManufacturingOrder{} = mo, to) do
    Repo.transaction(fn ->
      case do_transition(actor, mo, to) do
        {:ok, updated} ->
          if to == "cancelled" do
            release_mo_bookings(actor, updated)
            cancel_open_children(actor, updated)
          end

          updated

        {:error, reason} ->
          Repo.rollback(reason)
      end
    end)
  end

  # Release every still-active booking on this MO. Used as a side
  # effect of cancelling so dead MOs don't keep stock reserved.
  defp release_mo_bookings(%User{} = actor, %ManufacturingOrder{} = mo) do
    bookings =
      from(b in ManufacturingOrderBooking,
        where:
          b.manufacturing_order_id == ^mo.id and
            b.status == "requested"
      )
      |> Repo.all()

    Enum.each(bookings, &delete_booking(actor, &1))
  end

  # Recursively cancel every draft / approved child of this MO. The
  # recursion happens because each child transition itself goes
  # through transition_mo → triggers the same cleanup, all in the
  # current transaction. in_progress + completed children stay put
  # — those are physically running or already produced stock.
  defp cancel_open_children(%User{} = actor, %ManufacturingOrder{} = mo) do
    children =
      from(c in ManufacturingOrder,
        where:
          c.parent_mo_id == ^mo.id and
            c.status in ["draft", "approved"]
      )
      |> Repo.all()

    Enum.each(children, fn child ->
      case transition_mo(actor, child, "cancelled") do
        {:ok, _} -> :ok
        # Don't roll back the parent if a child can't be cancelled —
        # in_progress/completed children are valid terminals; other
        # errors are logged via the changeset path anyway.
        _ -> :ok
      end
    end)
  end

  defp do_transition(%User{} = actor, %ManufacturingOrder{} = mo, to, extra_attrs \\ %{}) do
    before = mo_snapshot(mo)

    attrs =
      %{
        "status" => to,
        "updated_by_id" => actor.id
      }
      |> Map.merge(extra_attrs)

    mo
    |> ManufacturingOrder.transition_changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "manufacturing_order",
          updated,
          before,
          mo_snapshot(updated)
        )

        {:ok, reload_manufacturing_order(updated)}

      err ->
        err
    end
  end

  # ----- Approval workflow (prepare / approve / reject / amend) ----

  @doc """
  1st signature — planner marks the root MO + every draft descendant
  as prepared. From here the scientist countersigns. Operator can
  pull it back to draft with `unprepare_mo/2` without involving the
  approver.

  Only valid on the ROOT MO. Returns `{:error, :not_root}` for sub-
  MOs (the tree is signed at the root).
  """
  def prepare_mo(%User{} = actor, %ManufacturingOrder{} = mo) do
    with :ok <- ensure_root(mo),
         :ok <- ensure_status_in(mo, ["draft"]) do
      cascade_approval_transition(actor, mo, "prepared", %{
        "prepared_by_id" => actor.id,
        "prepared_at" => now(),
        "rejection_reason" => nil
      })
    end
  end

  @doc """
  Preparer's amend — returns the tree to draft before the scientist
  has signed. Clears the preparer signature so the next prep cycle
  records a fresh timestamp.
  """
  def unprepare_mo(%User{} = actor, %ManufacturingOrder{} = mo) do
    with :ok <- ensure_root(mo),
         :ok <- ensure_status_in(mo, ["prepared"]) do
      cascade_approval_transition(actor, mo, "draft", %{
        "prepared_by_id" => nil,
        "prepared_at" => nil
      })
    end
  end

  @doc """
  2nd signature — scientist approves the prepared root + every
  descendant. Enforces the 4-eyes rule (approver != preparer).
  """
  def approve_mo(%User{} = actor, %ManufacturingOrder{} = mo) do
    with :ok <- ensure_root(mo),
         :ok <- ensure_status_in(mo, ["prepared"]),
         :ok <- ensure_different_signer(mo, actor) do
      cascade_approval_transition(actor, mo, "approved", %{
        "approved_by_id" => actor.id,
        "approved_at" => now()
      })
    end
  end

  @doc """
  Scientist sends the tree back to draft with a required reason.
  Clears both signatures so the preparer fixes + re-signs from the
  bottom of the workflow. Reason recorded on the root MO + audit
  trail; shown as a banner until the next prepare cycle.
  """
  def reject_mo(%User{} = actor, %ManufacturingOrder{} = mo, reason)
      when is_binary(reason) do
    trimmed = String.trim(reason)

    with :ok <- ensure_root(mo),
         :ok <- ensure_status_in(mo, ["prepared"]),
         :ok <- ensure_non_empty_reason(trimmed) do
      cascade_approval_transition(actor, mo, "draft", %{
        "approved_by_id" => nil,
        "approved_at" => nil,
        "prepared_by_id" => nil,
        "prepared_at" => nil,
        "rejection_reason" => trimmed
      })
    end
  end

  def reject_mo(_actor, _mo, _), do: {:error, :reason_required}

  @doc """
  Approver's amend — returns an approved tree to draft. Clears both
  signatures so the next pass starts fresh.
  """
  def amend_mo(%User{} = actor, %ManufacturingOrder{} = mo) do
    with :ok <- ensure_root(mo),
         :ok <- ensure_status_in(mo, ["approved"]) do
      cascade_approval_transition(actor, mo, "draft", %{
        "approved_by_id" => nil,
        "approved_at" => nil,
        "prepared_by_id" => nil,
        "prepared_at" => nil
      })
    end
  end

  @doc """
  Walk to the root of `mo`'s tree; if it's in a signed state
  (`prepared` or `approved`), demote the whole tree back to draft
  and clear the signatures. Called as a side effect of any
  structural change so the approval invariant holds: what's
  approved == what's actually run.

  No-op when the root is draft / in_progress / completed / cancelled.
  Logs to the audit trail via the same cascade path the approver
  uses, so the timeline shows "edit X by user Y → auto-demoted".
  """
  def demote_root_if_signed(%User{} = actor, %ManufacturingOrder{} = mo) do
    root = walk_to_root(mo, MapSet.new())

    case root.status do
      "prepared" ->
        cascade_approval_transition(actor, root, "draft", %{
          "prepared_by_id" => nil,
          "prepared_at" => nil
        })

      "approved" ->
        cascade_approval_transition(actor, root, "draft", %{
          "approved_by_id" => nil,
          "approved_at" => nil,
          "prepared_by_id" => nil,
          "prepared_at" => nil
        })

      _ ->
        :ok
    end
  end

  # Apply the transition to the root then cascade to every draft /
  # prepared / approved descendant inside one transaction. Children
  # already in_progress / completed / cancelled stay put — physical
  # production is immutable.
  defp cascade_approval_transition(%User{} = actor, %ManufacturingOrder{} = root, to, signature_attrs) do
    Repo.transaction(fn ->
      with {:ok, updated} <- do_transition(actor, root, to, signature_attrs),
           :ok <- cascade_approval_to_children(actor, updated, to, signature_attrs) do
        updated
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  defp cascade_approval_to_children(actor, %ManufacturingOrder{} = parent, to, signature_attrs) do
    children =
      from(c in ManufacturingOrder,
        where:
          c.parent_mo_id == ^parent.id and
            c.status in ["draft", "prepared", "approved"]
      )
      |> Repo.all()

    Enum.each(children, fn child ->
      case do_transition(actor, child, to, signature_attrs) do
        {:ok, updated_child} ->
          cascade_approval_to_children(actor, updated_child, to, signature_attrs)

        {:error, _} ->
          :ok
      end
    end)

    :ok
  end

  defp ensure_root(%ManufacturingOrder{parent_mo_id: nil}), do: :ok
  defp ensure_root(%ManufacturingOrder{}), do: {:error, :not_root}

  defp ensure_status_in(%ManufacturingOrder{status: s}, allowed) do
    if s in allowed, do: :ok, else: {:error, {:invalid_status, s}}
  end

  defp ensure_different_signer(%ManufacturingOrder{prepared_by_id: pid}, %User{id: aid})
       when not is_nil(pid) and pid == aid,
       do: {:error, :same_signer}

  defp ensure_different_signer(_mo, _actor), do: :ok

  defp ensure_non_empty_reason(""), do: {:error, :reason_required}
  defp ensure_non_empty_reason(_), do: :ok

  # Block in_progress when any child MO hasn't completed yet. Other
  # transitions stay open so the planner can still cancel / amend
  # while children are mid-flight.
  defp ensure_children_complete(%ManufacturingOrder{} = mo, "in_progress") do
    open =
      from(c in ManufacturingOrder,
        where:
          c.parent_mo_id == ^mo.id and
            c.status not in ["completed", "cancelled"],
        select: count(c.id)
      )
      |> Repo.one()

    if open > 0 do
      {:error, :children_not_complete}
    else
      :ok
    end
  end

  defp ensure_children_complete(_mo, _to), do: :ok

  def delete_manufacturing_order(%User{} = actor, %ManufacturingOrder{} = mo) do
    before = mo_snapshot(mo)

    case Repo.delete(mo) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "manufacturing_order", deleted, before)
        {:ok, deleted}

      err ->
        err
    end
  end

  defp reload_manufacturing_order(%ManufacturingOrder{} = mo) do
    Repo.preload(
      mo,
      [
        :item,
        :warehouse,
        :assigned_to,
        :approved_by,
        :created_by,
        :updated_by,
        steps: [:workstation_group, :routing_step, worker_assignments: :user],
        bom: [lines: [:part, :unit_of_measurement]],
        routing: [steps: [:workstation_group, worker_assignments: :user]]
      ],
      force: true
    )
  end

  defp ensure_mo_site_production_facility(_actor, nil), do: {:error, :warehouse_required}

  defp ensure_mo_site_production_facility(%User{} = actor, id) do
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

    case int_id && Repo.get(Backend.Warehouses.Warehouse, int_id) do
      %{company_id: cid, kind: "production_facility"} when cid == actor.company_id ->
        :ok

      %{company_id: cid} when cid == actor.company_id ->
        {:error, :site_must_be_production_facility}

      _ ->
        {:error, :warehouse_not_found}
    end
  end

  # The MO form doesn't ask the operator to pick a routing — there's
  # usually one canonical routing per BOM. Resolve it here on create
  # (and on bom_id/item_id change in update) so the operations table
  # has something to render and so labour cost projection works.
  # Precedence: routing pinned to this BOM > item-level default
  # (bom_id IS NULL) > nothing (operator can attach one later via the
  # routings UI).
  # Fill in bom_id from the item's primary BOM when the caller
  # didn't pick one explicitly. Used by the "Add sub-MO" dialog on
  # the parts table where the operator only knows the part.
  defp maybe_resolve_bom(attrs, %User{} = actor) do
    cond do
      Map.has_key?(attrs, "bom_id") and not is_nil(attrs["bom_id"]) ->
        attrs

      true ->
        case attrs["item_id"] |> coerce_int() do
          nil ->
            attrs

          item_id ->
            case primary_bom_for_item(actor.company_id, item_id) do
              %BOM{id: bom_id} -> Map.put(attrs, "bom_id", bom_id)
              _ -> attrs
            end
        end
    end
  end

  defp maybe_resolve_routing(attrs, %User{} = actor) do
    cond do
      Map.has_key?(attrs, "routing_id") and not is_nil(attrs["routing_id"]) ->
        attrs

      true ->
        case resolve_routing(actor, attrs["item_id"], attrs["bom_id"]) do
          nil -> attrs
          rid -> Map.put(attrs, "routing_id", rid)
        end
    end
  end

  defp maybe_resolve_routing_for_update(attrs, %User{} = actor, %ManufacturingOrder{} = mo) do
    cond do
      Map.has_key?(attrs, "routing_id") ->
        attrs

      not (Map.has_key?(attrs, "bom_id") or Map.has_key?(attrs, "item_id")) ->
        attrs

      true ->
        item_id = Map.get(attrs, "item_id", mo.item_id)
        bom_id = Map.get(attrs, "bom_id", mo.bom_id)

        case resolve_routing(actor, item_id, bom_id) do
          nil -> Map.put(attrs, "routing_id", nil)
          rid -> Map.put(attrs, "routing_id", rid)
        end
    end
  end

  defp resolve_routing(%User{} = actor, item_id, bom_id) do
    item_id = coerce_int(item_id)
    bom_id = coerce_int(bom_id)

    cond do
      is_nil(item_id) ->
        nil

      true ->
        # Prefer the most specific match: a routing pinned to a BOM
        # outranks one that's null-bom (item-level default). The
        # CASE form sidesteps Postgres's parser tripping on the
        # natural-looking `NOT (... IS NULL)::int` ordering.
        from(r in Routing,
          where: r.company_id == ^actor.company_id and r.item_id == ^item_id,
          order_by: [
            desc: fragment("CASE WHEN ? IS NULL THEN 0 ELSE 1 END", r.bom_id),
            desc: r.updated_at
          ],
          limit: 1,
          select: r
        )
        |> maybe_pin_to_bom(bom_id)
        |> Repo.one()
        |> case do
          %Routing{id: id} -> id
          _ -> nil
        end
    end
  end

  defp maybe_pin_to_bom(query, nil), do: query

  defp maybe_pin_to_bom(query, bom_id) when is_integer(bom_id) do
    # Prefer a routing pinned to this BOM if one exists; otherwise the
    # query above already falls back to the item-level default.
    bom_match =
      from(r in Routing,
        where: r.bom_id == ^bom_id,
        limit: 1,
        select: r.id
      )

    case Repo.one(bom_match) do
      nil -> query
      _id -> from(r in query, where: r.bom_id == ^bom_id)
    end
  end

  defp coerce_int(n) when is_integer(n), do: n

  defp coerce_int(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp coerce_int(_), do: nil

  defp ensure_mo_bom_for_item(_actor, _item_id, nil), do: {:error, :bom_required}

  defp ensure_mo_bom_for_item(%User{} = actor, item_id, raw_bom_id) do
    int_bom =
      case raw_bom_id do
        n when is_integer(n) -> n
        s when is_binary(s) ->
          case Integer.parse(s) do
            {n, ""} -> n
            _ -> nil
          end

        _ -> nil
      end

    int_item =
      case item_id do
        n when is_integer(n) -> n
        s when is_binary(s) ->
          case Integer.parse(s) do
            {n, ""} -> n
            _ -> nil
          end

        _ -> nil
      end

    case int_bom && Repo.get(BOM, int_bom) do
      %BOM{company_id: cid, item_id: bom_item_id}
      when cid == actor.company_id and bom_item_id == int_item ->
        :ok

      %BOM{company_id: cid} when cid == actor.company_id ->
        {:error, :bom_item_mismatch}

      _ ->
        {:error, :bom_not_found}
    end
  end

  defp mo_snapshot(%ManufacturingOrder{} = mo) do
    %{
      warehouse_id: mo.warehouse_id,
      item_id: mo.item_id,
      bom_id: mo.bom_id,
      routing_id: mo.routing_id,
      quantity: mo.quantity,
      due_date: mo.due_date,
      expiry_date: mo.expiry_date,
      assigned_to_id: mo.assigned_to_id,
      revision: mo.revision,
      status: mo.status,
      approved_by_id: mo.approved_by_id,
      approved_at: mo.approved_at,
      notes: mo.notes,
      released_to_warehouse_at: mo.released_to_warehouse_at,
      released_to_warehouse_by_id: mo.released_to_warehouse_by_id,
      pickup_window_hours: mo.pickup_window_hours,
      pickup_started_at: mo.pickup_started_at,
      pickup_started_by_id: mo.pickup_started_by_id,
      pickup_completed_at: mo.pickup_completed_at,
      pickup_completed_by_id: mo.pickup_completed_by_id,
      production_cell_id: mo.production_cell_id
    }
  end

  # ----- MO bookings (stock reservations) --------------------------

  @doc """
  Active bookings against `lot_id`, ignoring an optional one (used
  by the update path so a booking doesn't count itself when checking
  capacity).
  """
  def lot_booked_qty(lot_id, exclude_booking_id \\ nil)
      when is_integer(lot_id) do
    base =
      from(b in ManufacturingOrderBooking,
        where: b.stock_lot_id == ^lot_id and b.status == "requested",
        select: coalesce(sum(b.quantity), 0)
      )

    case exclude_booking_id do
      nil -> Repo.one(base)
      id when is_integer(id) -> Repo.one(from b in base, where: b.id != ^id)
    end
  end

  @doc """
  Available qty for `lot_id` = sum(placements.qty) - active bookings.
  Returned as a Decimal.
  """
  def lot_available_qty(lot_id, exclude_booking_id \\ nil)
      when is_integer(lot_id) do
    on_hand =
      from(p in StockPlacementAlias,
        where: p.stock_lot_id == ^lot_id,
        select: coalesce(sum(p.qty), 0)
      )
      |> Repo.one()
      |> decimal_or_zero()

    booked =
      lot_booked_qty(lot_id, exclude_booking_id)
      |> decimal_or_zero()

    Decimal.sub(on_hand, booked)
  end

  @doc """
  Lots an operator can pick from to book against an item. Excludes
  lots with zero available qty, lots in disposed / rejected / on_hold
  states, and lots not in the actor's company.

  Returns a list of `{lot, available_qty, primary_cell}` triples
  sorted by FEFO (earliest expiry first).
  """
  def list_bookable_lots(%User{} = actor, item_id, opts \\ [])
      when is_integer(item_id) do
    exclude_booking_id = Keyword.get(opts, :exclude_booking_id)
    strategy = normalise_strategy(Keyword.get(opts, :strategy, :fefo))

    eligible_statuses = ~w(received available)

    query =
      StockLot
      |> where([l], l.company_id == ^actor.company_id)
      |> where([l], l.item_id == ^item_id)
      |> where([l], l.status in ^eligible_statuses)
      |> preload([:item, placements: :storage_cell])

    query =
      case strategy do
        :fifo ->
          # First-in, first-out — oldest received goods leave first.
          # Falls back to the lot id for deterministic ordering.
          query
          |> order_by([l], asc_nulls_last: l.received_at, asc: l.id)

        :fefo ->
          # First-expired, first-out — closest expiry leaves first.
          query
          |> order_by([l], asc_nulls_last: l.expiry_at, asc: l.id)
      end

    lots = Repo.all(query)
    lot_ids = Enum.map(lots, & &1.id)

    # Batch the two availability sub-totals into a single round-trip
    # each (was O(L) extra queries per call — became visible when the
    # FEFO allocator ran across a BOM with many short-dated lots).
    {on_hand_by_lot, booked_by_lot} =
      case lot_ids do
        [] -> {%{}, %{}}
        _ -> {on_hand_sums(lot_ids), booked_sums(lot_ids, exclude_booking_id)}
      end

    lots
    |> Enum.map(fn lot ->
      on_hand = Map.get(on_hand_by_lot, lot.id, Decimal.new(0))
      booked = Map.get(booked_by_lot, lot.id, Decimal.new(0))
      available = Decimal.sub(on_hand, booked)
      {lot, available, primary_cell_for_lot(lot)}
    end)
    |> Enum.filter(fn {_lot, available, _cell} ->
      Decimal.compare(available, Decimal.new("0")) == :gt
    end)
  end

  defp on_hand_sums(lot_ids) when is_list(lot_ids) do
    from(p in StockPlacementAlias,
      where: p.stock_lot_id in ^lot_ids,
      group_by: p.stock_lot_id,
      select: {p.stock_lot_id, coalesce(sum(p.qty), 0)}
    )
    |> Repo.all()
    |> Map.new()
  end

  defp booked_sums(lot_ids, nil) when is_list(lot_ids) do
    from(b in ManufacturingOrderBooking,
      where: b.stock_lot_id in ^lot_ids and b.status == "requested",
      group_by: b.stock_lot_id,
      select: {b.stock_lot_id, coalesce(sum(b.quantity), 0)}
    )
    |> Repo.all()
    |> Map.new()
  end

  defp booked_sums(lot_ids, exclude_booking_id) when is_list(lot_ids) and is_integer(exclude_booking_id) do
    from(b in ManufacturingOrderBooking,
      where:
        b.stock_lot_id in ^lot_ids and
          b.status == "requested" and
          b.id != ^exclude_booking_id,
      group_by: b.stock_lot_id,
      select: {b.stock_lot_id, coalesce(sum(b.quantity), 0)}
    )
    |> Repo.all()
    |> Map.new()
  end

  defp normalise_strategy(s) when s in [:fefo, :fifo], do: s
  defp normalise_strategy("fifo"), do: :fifo
  defp normalise_strategy("fefo"), do: :fefo
  defp normalise_strategy(_), do: :fefo

  defp primary_cell_for_lot(%StockLot{placements: placements})
       when is_list(placements) and placements != [] do
    placements
    |> Enum.sort_by(&Decimal.to_float(&1.qty || Decimal.new(0)), :desc)
    |> List.first()
    |> Map.get(:storage_cell)
  end

  defp primary_cell_for_lot(_), do: nil

  @doc """
  List bookings for an MO with the lookups the FE renders. Sorted
  by item then insertion order so the master rows on the parts
  table group cleanly.
  """
  def list_mo_bookings(%ManufacturingOrder{id: mo_id, company_id: cid}) do
    from(b in ManufacturingOrderBooking,
      where: b.manufacturing_order_id == ^mo_id and b.company_id == ^cid,
      order_by: [asc: b.item_id, asc: b.id],
      preload: [
        :item,
        :storage_cell,
        stock_lot: [placements: :storage_cell]
      ]
    )
    |> Repo.all()
  end

  @doc """
  Create a booking. Validates capacity against the lot's available
  qty so two operators can't over-reserve the same lot.
  """
  def create_booking(%User{} = actor, %ManufacturingOrder{} = mo, attrs) do
    attrs = stringify_keys(attrs)

    attrs =
      attrs
      |> Map.put("company_id", mo.company_id)
      |> Map.put("manufacturing_order_id", mo.id)
      |> Map.put("created_by_id", actor.id)
      |> Map.put("updated_by_id", actor.id)
      |> Map.put_new("status", "requested")
      |> snapshot_storage_cell_from_lot()

    with :ok <- ensure_lot_belongs_to_company(actor, attrs["stock_lot_id"]),
         :ok <- ensure_item_matches_lot(attrs["item_id"], attrs["stock_lot_id"]),
         :ok <-
           ensure_capacity(
             attrs["stock_lot_id"],
             attrs["quantity"],
             nil
           ) do
      %ManufacturingOrderBooking{}
      |> ManufacturingOrderBooking.changeset(attrs)
      |> Repo.insert()
      |> case do
        {:ok, booking} ->
          Audit.record_created(
            actor,
            "manufacturing_order_booking",
            booking,
            booking_snapshot(booking)
          )

          _ = demote_root_if_signed(actor, mo)
          {:ok, reload_booking(booking)}

        err ->
          err
      end
    end
  end

  @doc """
  Update booking qty (partial release). Re-validates capacity so
  raising a qty can't overflow the lot.
  """
  def update_booking(
        %User{} = actor,
        %ManufacturingOrderBooking{} = booking,
        attrs
      ) do
    attrs = stringify_keys(attrs)
    before = booking_snapshot(booking)

    attrs =
      attrs
      |> Map.delete("company_id")
      |> Map.delete("manufacturing_order_id")
      |> Map.delete("item_id")
      |> Map.delete("stock_lot_id")
      |> Map.delete("status")
      |> Map.put("updated_by_id", actor.id)

    new_qty = attrs["quantity"] || booking.quantity

    with :ok <- ensure_capacity(booking.stock_lot_id, new_qty, booking.id) do
      booking
      |> ManufacturingOrderBooking.changeset(attrs)
      |> Repo.update()
      |> case do
        {:ok, updated} ->
          Audit.record_updated(
            actor,
            "manufacturing_order_booking",
            updated,
            before,
            booking_snapshot(updated)
          )

          maybe_demote_via_booking(actor, updated)
          {:ok, reload_booking(updated)}

        err ->
          err
      end
    end
  end

  @doc """
  Release a booking — hard-delete so the lot's available qty
  recomputes cleanly. Audit captures the deletion event with the
  pre-release snapshot.
  """
  def delete_booking(%User{} = actor, %ManufacturingOrderBooking{} = booking) do
    before = booking_snapshot(booking)

    case Repo.delete(booking) do
      {:ok, deleted} ->
        Audit.record_deleted(
          actor,
          "manufacturing_order_booking",
          deleted,
          before
        )

        maybe_demote_via_booking(actor, booking)
        {:ok, deleted}

      err ->
        err
    end
  end

  defp maybe_demote_via_booking(%User{} = actor, %ManufacturingOrderBooking{manufacturing_order_id: mo_id}) do
    case Repo.get(ManufacturingOrder, mo_id) do
      %ManufacturingOrder{} = mo -> demote_root_if_signed(actor, mo)
      _ -> :ok
    end
  end

  @doc """
  Auto-book everything still outstanding on the MO's BOM, picking
  oldest-expiry lots first. Per-line behaviour:

    * needed = bom_line.quantity × mo.quantity − already booked
    * iterate eligible lots in FEFO order, booking up to the smaller
      of (lot available, line still needed)
    * stop when the line is covered or no more lots remain

  Returns `{:ok, created_bookings}` always — partial fulfilment is
  the expected case when stock is short.
  """
  def book_all_for_mo(%User{} = actor, %ManufacturingOrder{} = mo, opts \\ []) do
    strategy = normalise_strategy(Keyword.get(opts, :strategy, :fefo))

    mo =
      Repo.preload(mo, [
        :bookings,
        bom: [lines: :part]
      ])

    bom_lines =
      case mo.bom do
        %BOM{lines: lines} when is_list(lines) -> lines
        _ -> []
      end

    Repo.transaction(fn ->
      Enum.flat_map(bom_lines, fn line ->
        already =
          mo.bookings
          |> Enum.filter(fn b ->
            b.item_id == line.part_id and b.status == "requested"
          end)
          |> Enum.reduce(Decimal.new(0), fn b, acc ->
            Decimal.add(acc, b.quantity || Decimal.new(0))
          end)

        # is_fixed lines stay at the BOM-line qty regardless of MO
        # qty (e.g. "use exactly 1 packet"). Everything else scales.
        per_output_qty = line.qty || Decimal.new(0)

        line_total =
          if line.is_fixed do
            per_output_qty
          else
            Decimal.mult(per_output_qty, mo.quantity || Decimal.new(0))
          end

        needed = Decimal.sub(line_total, already)

        if Decimal.compare(needed, Decimal.new("0")) != :gt do
          []
        else
          allocate_for_item(actor, mo, line.part_id, needed, strategy)
        end
      end)
      |> case do
        bookings -> bookings
      end
    end)
    |> case do
      {:ok, bookings} -> {:ok, bookings}
      err -> err
    end
  end

  @doc """
  Release every active booking on the MO AND cascade-cancel its
  draft/approved descendants (recursively, because transition_mo
  itself releases bookings + cancels children on every cancel).
  In-progress / completed children stay put — those are physically
  running or already produced stock and shouldn't be torn down by
  a single button.

  Returns `{:ok, %{bookings: top_level_released, children: top_level_cancelled}}`.
  Deeper-tree releases happen but aren't counted here; the audit
  trail captures the per-MO detail.
  """
  def release_all_for_mo(%User{} = actor, %ManufacturingOrder{} = mo) do
    Repo.transaction(fn ->
      released_bookings = release_mo_bookings_count(actor, mo)
      cancelled_children = cancel_open_children_count(actor, mo)
      %{bookings: released_bookings, children: cancelled_children}
    end)
  end

  # Counting variants of the helpers — used by the controller response
  # so the toast can show how many top-level releases happened. The
  # internal cascade variants don't bother counting since they're
  # already inside another transaction.
  defp release_mo_bookings_count(%User{} = actor, %ManufacturingOrder{} = mo) do
    bookings =
      from(b in ManufacturingOrderBooking,
        where:
          b.manufacturing_order_id == ^mo.id and
            b.status == "requested"
      )
      |> Repo.all()

    Enum.each(bookings, &delete_booking(actor, &1))
    length(bookings)
  end

  defp cancel_open_children_count(%User{} = actor, %ManufacturingOrder{} = mo) do
    children =
      from(c in ManufacturingOrder,
        where:
          c.parent_mo_id == ^mo.id and
            c.status in ["draft", "approved"]
      )
      |> Repo.all()

    Enum.reduce(children, 0, fn child, acc ->
      case transition_mo(actor, child, "cancelled") do
        {:ok, _} -> acc + 1
        _ -> acc
      end
    end)
  end

  defp allocate_for_item(
         %User{} = actor,
         %ManufacturingOrder{} = mo,
         item_id,
         needed,
         strategy \\ :fefo
       ) do
    lots = list_bookable_lots(actor, item_id, strategy: strategy)

    {bookings, _remaining} =
      Enum.reduce_while(lots, {[], needed}, fn {lot, available, cell}, {acc, left} ->
        if Decimal.compare(left, Decimal.new("0")) != :gt do
          {:halt, {acc, left}}
        else
          take =
            if Decimal.compare(available, left) == :lt do
              available
            else
              left
            end

          attrs = %{
            "company_id" => mo.company_id,
            "manufacturing_order_id" => mo.id,
            "item_id" => item_id,
            "stock_lot_id" => lot.id,
            "storage_cell_id" => cell && cell.id,
            "quantity" => take,
            "status" => "requested",
            "created_by_id" => actor.id,
            "updated_by_id" => actor.id
          }

          case %ManufacturingOrderBooking{}
               |> ManufacturingOrderBooking.changeset(attrs)
               |> Repo.insert() do
            {:ok, booking} ->
              Audit.record_created(
                actor,
                "manufacturing_order_booking",
                booking,
                booking_snapshot(booking)
              )

              {:cont, {[reload_booking(booking) | acc], Decimal.sub(left, take)}}

            {:error, _cs} ->
              {:cont, {acc, left}}
          end
        end
      end)

    Enum.reverse(bookings)
  end

  defp ensure_capacity(_lot_id, nil, _exclude), do: {:error, :quantity_required}

  defp ensure_capacity(lot_id, quantity, exclude_booking_id) when is_integer(lot_id) do
    desired = decimal_or_zero(quantity)

    if Decimal.compare(desired, Decimal.new("0")) != :gt do
      {:error, :quantity_required}
    else
      available = lot_available_qty(lot_id, exclude_booking_id)

      if Decimal.compare(desired, available) == :gt do
        {:error, {:insufficient_stock, available}}
      else
        :ok
      end
    end
  end

  defp ensure_capacity(_, _, _), do: {:error, :lot_required}

  defp ensure_lot_belongs_to_company(_actor, nil), do: {:error, :lot_required}

  defp ensure_lot_belongs_to_company(%User{} = actor, lot_id) do
    case Repo.get(StockLot, coerce_int(lot_id)) do
      %StockLot{company_id: cid} when cid == actor.company_id -> :ok
      _ -> {:error, :lot_not_found}
    end
  end

  defp ensure_item_matches_lot(item_id, lot_id) do
    iid = coerce_int(item_id)
    lid = coerce_int(lot_id)

    case lid && Repo.get(StockLot, lid) do
      %StockLot{item_id: lot_item} when lot_item == iid -> :ok
      %StockLot{} -> {:error, :item_lot_mismatch}
      _ -> {:error, :lot_not_found}
    end
  end

  defp snapshot_storage_cell_from_lot(attrs) do
    case {attrs["storage_cell_id"], coerce_int(attrs["stock_lot_id"])} do
      {nil, lot_id} when is_integer(lot_id) ->
        lot = Repo.get(StockLot, lot_id) |> Repo.preload(placements: :storage_cell)

        case primary_cell_for_lot(lot) do
          nil -> attrs
          cell -> Map.put(attrs, "storage_cell_id", cell.id)
        end

      _ ->
        attrs
    end
  end

  defp reload_booking(%ManufacturingOrderBooking{} = b) do
    Repo.preload(
      b,
      [:item, :storage_cell, :created_by, :updated_by, stock_lot: [placements: :storage_cell]],
      force: true
    )
  end

  defp booking_snapshot(%ManufacturingOrderBooking{} = b) do
    %{
      manufacturing_order_id: b.manufacturing_order_id,
      item_id: b.item_id,
      stock_lot_id: b.stock_lot_id,
      storage_cell_id: b.storage_cell_id,
      quantity: b.quantity,
      consumed_quantity: b.consumed_quantity,
      status: b.status,
      note: b.note,
      picked_at: b.picked_at,
      picked_by_id: b.picked_by_id
    }
  end

  defp decimal_or_zero(nil), do: Decimal.new(0)
  defp decimal_or_zero(%Decimal{} = d), do: d
  defp decimal_or_zero(n) when is_integer(n), do: Decimal.new(n)
  defp decimal_or_zero(n) when is_float(n), do: Decimal.from_float(n)

  defp decimal_or_zero(s) when is_binary(s) do
    case Decimal.parse(s) do
      {d, _} -> d
      :error -> Decimal.new(0)
    end
  end

  defp decimal_or_zero(_), do: Decimal.new(0)

  def get_booking(company_id, uuid)
      when is_integer(company_id) and is_binary(uuid) do
    ManufacturingOrderBooking
    |> where([b], b.company_id == ^company_id and b.uuid == ^uuid)
    |> preload([
      :item,
      :storage_cell,
      :manufacturing_order,
      stock_lot: [placements: :storage_cell]
    ])
    |> Repo.one()
  end

  @doc """
  Shift an MO chain (root + every descendant via parent_mo_id) by
  `delta_seconds`. One transaction so the calendar never shows a
  half-shifted project. Used by the project-view drag handler.

  Timing lives on the steps — there's nothing on the MO row to
  update — so this is purely "shift every step's planned_start +
  planned_finish across every node in the chain".
  """
  def shift_mo_chain(%User{} = actor, %ManufacturingOrder{} = root, delta_seconds)
      when is_integer(delta_seconds) do
    if delta_seconds == 0 do
      {:ok, reload_manufacturing_order(root)}
    else
      # Pure delta shift — add delta_seconds to every step's
      # planned_start / planned_finish across the whole chain. No
      # rescheduler re-walk: the user dragged by exactly delta and
      # expects every step to move by exactly delta. Re-running the
      # walker off `chain_earliest_start` is hostile when a hidden
      # descendant step lives weeks in the past (drag would teleport
      # the whole chain back to that ancient earliest).
      chain_mos = mo_chain(root)
      chain_ids = Enum.map(chain_mos, & &1.id)

      case do_shift_steps_by_delta(actor, chain_ids, delta_seconds) do
        {:ok, _count} -> {:ok, reload_manufacturing_order(root)}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp do_shift_steps_by_delta(%User{} = actor, mo_ids, delta_seconds) do
    Repo.transaction(fn ->
      steps =
        from(s in ManufacturingOrderStep,
          where:
            s.manufacturing_order_id in ^mo_ids and
              not is_nil(s.planned_start) and
              not is_nil(s.planned_finish)
        )
        |> Repo.all()

      Enum.each(steps, fn step ->
        before = mo_step_snapshot(step)
        new_start = DateTime.add(step.planned_start, delta_seconds, :second)
        new_finish = DateTime.add(step.planned_finish, delta_seconds, :second)

        cs =
          ManufacturingOrderStep.changeset(step, %{
            "planned_start" => new_start,
            "planned_finish" => new_finish,
            "updated_by_id" => actor.id
          })

        case Repo.update(cs) do
          {:ok, updated} ->
            Audit.record_updated(
              actor,
              "manufacturing_order_step",
              updated,
              before,
              mo_step_snapshot(updated)
            )

          {:error, changeset} ->
            Repo.rollback(changeset)
        end
      end)

      length(steps)
    end)
    |> case do
      {:ok, count} -> {:ok, count}
      {:error, reason} -> {:error, reason}
    end
  end

  defp chain_earliest_start(%ManufacturingOrder{} = root) do
    chain = mo_chain(root)
    ids = Enum.map(chain, & &1.id)

    from(s in ManufacturingOrderStep,
      where:
        s.manufacturing_order_id in ^ids and
          not is_nil(s.planned_start),
      select: min(s.planned_start)
    )
    |> Repo.one()
  end

  @doc """
  Shift one MO's schedule by `delta_seconds`. Walks every step and
  rewrites planned_start + planned_finish in one transaction.

  Reschedule does NOT touch status — a scheduled MO stays scheduled.
  The drag handler is "move where on the calendar", not "unscheduling".
  """
  def shift_mo_schedule(%User{} = actor, %ManufacturingOrder{} = mo, delta_seconds)
      when is_integer(delta_seconds) do
    if delta_seconds == 0 do
      {:ok, reload_manufacturing_order(mo)}
    else
      # Pure delta shift — every step moves by exactly delta_seconds.
      # No walker re-run: the user dragged by exactly delta and expects
      # an exact delta, not a re-snap that can teleport the block to
      # an unrelated earliest if any step happens to be in the past.
      case do_shift_steps_by_delta(actor, [mo.id], delta_seconds) do
        {:ok, _count} -> {:ok, reload_manufacturing_order(mo)}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp mo_first_step_start(%ManufacturingOrder{id: id}) do
    from(s in ManufacturingOrderStep,
      where:
        s.manufacturing_order_id == ^id and
          not is_nil(s.planned_start),
      select: min(s.planned_start)
    )
    |> Repo.one()
  end

  # Old delta-only helpers (check_shift_not_past, check_shift_chain_order,
  # shift_mo_steps) were removed when shifts started delegating to the
  # walker-aware schedule_mo / schedule_mo_chain. The schedulers
  # handle past-time + chain-order checks AND ensure each step lands
  # in working hours — no more blocks ending in closed time.

  @doc """
  Place an approved MO on the calendar at `start_dt`. Walks the
  steps in `sort_order` and assigns each one a planned_start +
  planned_finish using the working-hour-aware schedule walker —
  so a 10-hour op dropped at Mon 14:00 with hours 06:00-16:00
  spills cleanly into Tue morning instead of running through the
  closed evening.

  Optional `workstation_group_id` overrides the first step's WSG —
  used when the planner drops a backlog item onto a specific
  station row in the workstation view. The override only applies
  to the first step; later steps keep their routing-defined WSGs
  unless reassigned individually.

  Returns `{:ok, mo, %{outside_hours_seconds: N}}`. Non-zero
  `outside_hours_seconds` means the requested duration couldn't
  fit inside available working windows over the next 90 days; the
  FE surfaces this as a warning toast.
  """
  def schedule_mo(actor, mo, start_dt, opts \\ [])

  def schedule_mo(%User{} = actor, %ManufacturingOrder{} = mo, %DateTime{} = start_dt, opts) do
    wsg_override = Keyword.get(opts, :workstation_group_id)

    cond do
      mo.status not in ["approved", "scheduled"] ->
        {:error, :wrong_status}

      DateTime.compare(start_dt, now()) == :lt ->
        {:error, :past_time}

      true ->
        do_schedule_mo(actor, mo, start_dt, wsg_override)
    end
  end

  defp do_schedule_mo(actor, mo, start_dt, wsg_override) do
    intervals = working_intervals_for_mo(mo, start_dt)

    Repo.transaction(fn ->
      steps =
        from(s in ManufacturingOrderStep,
          where: s.manufacturing_order_id == ^mo.id,
          order_by: [asc: s.sort_order, asc: s.id]
        )
        |> Repo.all()

      {_cursor, outside_total, _index, first_start, last_finish} =
        Enum.reduce(steps, {start_dt, 0, 0, nil, nil}, fn step, {cursor, off_acc, idx, first, _last} ->
          duration = step.planned_duration_seconds || 0

          {:ok, %{start_at: s_start, finish_at: s_finish, outside_hours_seconds: off}} =
            ScheduleWalker.walk_forward(intervals, cursor, duration)

          before = mo_step_snapshot(step)

          attrs = %{
            "planned_start" => s_start,
            "planned_finish" => s_finish,
            "updated_by_id" => actor.id
          }

          # First step gets the WSG override if the planner dropped
          # the MO on a specific station row in workstation view.
          attrs =
            if idx == 0 and is_integer(wsg_override) do
              Map.put(attrs, "workstation_group_id", wsg_override)
            else
              attrs
            end

          case step
               |> ManufacturingOrderStep.changeset(attrs)
               |> Repo.update() do
            {:ok, updated} ->
              Audit.record_updated(
                actor,
                "manufacturing_order_step",
                updated,
                before,
                mo_step_snapshot(updated)
              )

              {s_finish, off_acc + off, idx + 1, first || s_start, s_finish}

            {:error, reason} ->
              Repo.rollback(reason)
          end
        end)

      # Chain-order guard. Must finish before parent's first step
      # starts; must start after every scheduled child's last finish.
      case check_chain_order(mo, first_start, last_finish) do
        :ok -> :ok
        {:error, reason} -> Repo.rollback(reason)
      end

      # Calendar placement no longer auto-flips status to "scheduled".
      # The Release-to-warehouse button is the only path from "approved"
      # to "scheduled" — dropping on the calendar just records
      # planned_start/finish on the steps, status stays put.
      updated_mo = reload_manufacturing_order(mo)

      {updated_mo, outside_total}
    end)
    |> case do
      {:ok, {updated, outside}} ->
        {:ok, reload_manufacturing_order(updated),
         %{outside_hours_seconds: outside}}

      err ->
        err
    end
  end

  @doc """
  Schedule an entire MO chain (root + every approved descendant)
  from a single drop time.

  Root goes forward from `start_dt`. Each child walks BACKWARD
  from the root's first step's start so the child finishes before
  the parent begins — honouring the parent-needs-child dependency
  the chain was set up for. All inside one transaction so a
  partial chain never reaches the calendar.

  Returns the same shape as `schedule_mo/3` plus the chain-wide
  `outside_hours_seconds` total.
  """
  def schedule_mo_chain(%User{} = actor, %ManufacturingOrder{} = root, %DateTime{} = start_dt) do
    if DateTime.compare(start_dt, now()) == :lt do
      {:error, :past_time}
    else
      do_schedule_mo_chain(actor, root, start_dt)
    end
  end

  defp do_schedule_mo_chain(actor, root, start_dt) do
    Repo.transaction(fn ->
      intervals = working_intervals_for_mo(root, start_dt)

      # FORWARD topological scheduling. Drop_dt = the EARLIEST start
      # of the whole chain. Leaves (deepest descendants) start at
      # drop_dt; each parent starts when ALL its children have
      # finished. So the chain extends RIGHT of the cursor, not
      # backward into the past, and "drop here" matches the planner's
      # mental model of "this is when work on the project begins".
      chain =
        mo_chain(root)
        |> Enum.filter(&(&1.status in ["approved", "scheduled"]))

      ordered = chain_in_topo_order_leaves_first(chain)

      {_finish_by_mo, total_outside} =
        Enum.reduce(ordered, {%{}, 0}, fn mo, {finishes, off_total} ->
          children_finishes =
            chain
            |> Enum.filter(fn c -> c.parent_mo_id == mo.id end)
            |> Enum.map(fn c -> Map.get(finishes, c.id) end)
            |> Enum.filter(&(&1 != nil))

          earliest =
            case children_finishes do
              [] -> start_dt
              list -> [start_dt | list] |> Enum.max(DateTime)
            end

          case do_schedule_one_forward(actor, mo, earliest, intervals) do
            {:ok, _mo, off, _first, last} ->
              {Map.put(finishes, mo.id, last), off_total + off}

            {:error, :wrong_status} ->
              Repo.rollback(:wrong_status)

            {:error, reason} ->
              Repo.rollback(reason)
          end
        end)

      {Repo.get!(ManufacturingOrder, root.id), total_outside}
    end)
    |> case do
      {:ok, {updated, outside}} ->
        {:ok, reload_manufacturing_order(updated),
         %{outside_hours_seconds: outside}}

      err ->
        err
    end
  end

  # Post-order traversal of the chain so every parent comes after
  # all of its descendants. Lets the forward scheduler chain finish
  # times up the tree (parent.earliest = max(children.finish)).
  defp chain_in_topo_order_leaves_first(mos) do
    by_id = Map.new(mos, &{&1.id, &1})

    root =
      Enum.find(mos, fn m ->
        is_nil(m.parent_mo_id) or not Map.has_key?(by_id, m.parent_mo_id)
      end)

    case root do
      nil -> mos
      r -> post_order_walk(r, by_id, MapSet.new(), []) |> elem(0)
    end
  end

  defp post_order_walk(mo, by_id, seen, acc) do
    if MapSet.member?(seen, mo.id) do
      {acc, seen}
    else
      seen = MapSet.put(seen, mo.id)
      children = Enum.filter(Map.values(by_id), &(&1.parent_mo_id == mo.id))

      {acc, seen} =
        Enum.reduce(children, {acc, seen}, fn c, {a, s} ->
          post_order_walk(c, by_id, s, a)
        end)

      {acc ++ [mo], seen}
    end
  end

  # ----- Internal scheduling helpers ------------------------------

  # Resolve working intervals over a 90-day window starting from
  # `from_dt`. We resolve at WAREHOUSE level (not per-WSG) so all
  # of an MO's steps share one calendar — matches operators' mental
  # model of "the factory's hours". WSG-specific overrides land in
  # a future pass.
  defp working_intervals_for_mo(%ManufacturingOrder{} = mo, %DateTime{} = from_dt) do
    company = Repo.get!(Company, mo.company_id)
    warehouse = Repo.get!(Warehouse, mo.warehouse_id)
    groups = list_workstation_groups_for_schedule_company(mo.company_id)

    from_date = DateTime.to_date(from_dt)
    to_date = Date.add(from_date, 90)

    resolved =
      resolve_working_windows(groups, warehouse, company, from_date, to_date)

    ScheduleWalker.flatten_windows(resolved, nil)
  end

  defp list_workstation_groups_for_schedule_company(company_id)
       when is_integer(company_id) do
    from(g in WorkstationGroup,
      where: g.company_id == ^company_id and g.is_active == true
    )
    |> Repo.all()
  end

  defp do_schedule_one_forward(actor, %ManufacturingOrder{} = mo, %DateTime{} = start_dt, intervals) do
    if mo.status not in ["approved", "scheduled"] do
      {:error, :wrong_status}
    else
      steps =
        from(s in ManufacturingOrderStep,
          where: s.manufacturing_order_id == ^mo.id,
          order_by: [asc: s.sort_order, asc: s.id]
        )
        |> Repo.all()

      {last_finish, first_start, off_total} =
        Enum.reduce(steps, {start_dt, nil, 0}, fn step, {cursor, first, off_acc} ->
          duration = step.planned_duration_seconds || 0

          {:ok, %{start_at: s_start, finish_at: s_finish, outside_hours_seconds: off}} =
            ScheduleWalker.walk_forward(intervals, cursor, duration)

          write_step_times!(actor, step, s_start, s_finish)
          {s_finish, first || s_start, off_acc + off}
        end)

      # Calendar placement is now status-neutral (see do_schedule_mo
      # comment) — only Release-to-warehouse flips to "scheduled".
      updated = reload_manufacturing_order(mo)

      # Tuple grew a 5th element (last_finish) so the chain walker
      # can chain MOs forward — parent's earliest_start =
      # max(child.last_finish) across direct children.
      {:ok, updated, off_total, first_start || start_dt, last_finish}
    end
  end

  defp do_schedule_one_backward(actor, %ManufacturingOrder{} = mo, %DateTime{} = finish_dt, intervals) do
    if mo.status not in ["approved", "scheduled"] do
      {:error, :wrong_status}
    else
      # Place steps RIGHT-to-LEFT: last step finishes at finish_dt,
      # step before that ends where the last one started, etc.
      steps =
        from(s in ManufacturingOrderStep,
          where: s.manufacturing_order_id == ^mo.id,
          order_by: [desc: s.sort_order, desc: s.id]
        )
        |> Repo.all()

      # `cursor` ends up holding the EARLIEST start_at — that's
      # what grandchildren need to finish before. (We were
      # previously returning `last_finish` which is actually the
      # MO's finish time, so grandchildren got scheduled on top of
      # their parent.)
      {earliest_start, off_total} =
        Enum.reduce(steps, {finish_dt, 0}, fn step, {cursor, off_acc} ->
          duration = step.planned_duration_seconds || 0

          {:ok, %{start_at: s_start, finish_at: s_finish, outside_hours_seconds: off}} =
            ScheduleWalker.walk_backward(intervals, cursor, duration)

          write_step_times!(actor, step, s_start, s_finish)
          {s_start, off_acc + off}
        end)

      # Calendar placement is now status-neutral (see do_schedule_mo
      # comment) — only Release-to-warehouse flips to "scheduled".
      updated = reload_manufacturing_order(mo)

      {:ok, updated, off_total, earliest_start}
    end
  end

  # Validate that placing `mo` with steps spanning [first_start,
  # last_finish] doesn't break the parent/child invariant of the
  # MO chain. Returns :ok or {:error, reason} suitable for
  # Repo.rollback. Children that aren't scheduled (no step times)
  # are ignored — they'll be checked when they're scheduled later.
  defp check_chain_order(%ManufacturingOrder{} = mo, %DateTime{} = first_start, %DateTime{} = last_finish) do
    with :ok <- check_parent_starts_after(mo, last_finish),
         :ok <- check_children_finish_before(mo, first_start) do
      :ok
    end
  end

  defp check_chain_order(_, _, _), do: :ok

  defp check_parent_starts_after(%ManufacturingOrder{parent_mo_id: nil}, _last_finish), do: :ok

  defp check_parent_starts_after(%ManufacturingOrder{parent_mo_id: parent_id}, last_finish) do
    parent_first_start =
      from(s in ManufacturingOrderStep,
        where: s.manufacturing_order_id == ^parent_id and not is_nil(s.planned_start),
        select: min(s.planned_start)
      )
      |> Repo.one()

    cond do
      is_nil(parent_first_start) -> :ok
      DateTime.compare(last_finish, parent_first_start) != :gt -> :ok
      true -> {:error, :must_finish_before_parent}
    end
  end

  defp check_children_finish_before(%ManufacturingOrder{id: id}, first_start) do
    children_last_finish =
      from(s in ManufacturingOrderStep,
        join: mo in ManufacturingOrder,
        on: mo.id == s.manufacturing_order_id,
        where:
          mo.parent_mo_id == ^id and
            mo.status in ["scheduled", "in_progress"] and
            not is_nil(s.planned_finish),
        select: max(s.planned_finish)
      )
      |> Repo.one()

    cond do
      is_nil(children_last_finish) -> :ok
      DateTime.compare(children_last_finish, first_start) != :gt -> :ok
      true -> {:error, :must_start_after_children}
    end
  end

  defp write_step_times!(actor, %ManufacturingOrderStep{} = step, start_dt, finish_dt) do
    before = mo_step_snapshot(step)

    attrs = %{
      "planned_start" => start_dt,
      "planned_finish" => finish_dt,
      "updated_by_id" => actor.id
    }

    case step
         |> ManufacturingOrderStep.changeset(attrs)
         |> Repo.update() do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "manufacturing_order_step",
          updated,
          before,
          mo_step_snapshot(updated)
        )

        updated

      {:error, reason} ->
        Repo.rollback(reason)
    end
  end

  @doc """
  Unschedule an entire MO chain (root + every descendant via
  parent_mo_id). Nodes that aren't currently scheduled are
  skipped; everything that IS scheduled goes back to the backlog.
  One transaction so a half-unscheduled project never reaches the
  calendar.
  """
  def unschedule_mo_chain(%User{} = actor, %ManufacturingOrder{} = root) do
    Repo.transaction(fn ->
      chain_nodes = mo_chain(root)

      Enum.each(chain_nodes, fn node ->
        # Calendar-placed MOs are now "approved" (status only flips to
        # "scheduled" via Release-to-warehouse), so we unschedule any
        # node that has planned step times — status alone is no longer
        # enough to know whether an MO sits on the calendar.
        if node.status in ["approved", "scheduled"] do
          case unschedule_mo(actor, node) do
            {:ok, _} -> :ok
            {:error, :not_on_calendar} -> :ok
            {:error, reason} -> Repo.rollback(reason)
          end
        end
      end)

      Repo.get!(ManufacturingOrder, root.id)
    end)
    |> case do
      {:ok, mo} -> {:ok, reload_manufacturing_order(mo)}
      err -> err
    end
  end

  @doc """
  Send a scheduled MO back to the backlog. Clears every step's
  planned_start + planned_finish (durations stay intact) and
  reverts status to `approved`.
  """
  def unschedule_mo(%User{} = actor, %ManufacturingOrder{} = mo) do
    cond do
      mo.status not in ["approved", "scheduled"] ->
        {:error, :wrong_status}

      not has_planned_steps?(mo) ->
        {:error, :not_on_calendar}

      true ->
        Repo.transaction(fn ->
          steps =
            from(s in ManufacturingOrderStep,
              where: s.manufacturing_order_id == ^mo.id
            )
            |> Repo.all()

          Enum.each(steps, fn step ->
            before = mo_step_snapshot(step)

            attrs = %{
              "planned_start" => nil,
              "planned_finish" => nil,
              "updated_by_id" => actor.id
            }

            case step
                 |> ManufacturingOrderStep.changeset(attrs)
                 |> Repo.update() do
              {:ok, updated} ->
                Audit.record_updated(
                  actor,
                  "manufacturing_order_step",
                  updated,
                  before,
                  mo_step_snapshot(updated)
                )

              {:error, reason} ->
                Repo.rollback(reason)
            end
          end)

          # If the MO is "scheduled" (released path — shouldn't really
          # happen for unschedule since release locks it, but stays
          # idempotent), flip back to "approved". Otherwise it's
          # already approved — just reload.
          if mo.status == "scheduled" do
            case do_transition(actor, mo, "approved") do
              {:ok, updated} -> updated
              {:error, reason} -> Repo.rollback(reason)
            end
          else
            reload_manufacturing_order(mo)
          end
        end)
        |> case do
          {:ok, updated} -> {:ok, reload_manufacturing_order(updated)}
          err -> err
        end
    end
  end

  defp has_planned_steps?(%ManufacturingOrder{id: id}) do
    from(s in ManufacturingOrderStep,
      where: s.manufacturing_order_id == ^id and not is_nil(s.planned_start),
      select: count(s.id)
    )
    |> Repo.one()
    |> Kernel.>(0)
  end

  # ----- Production schedule ---------------------------------------

  @doc """
  Operations to render on the production schedule for `warehouse`
  between `from_date` and `to_date` (inclusive). Returns the MO
  steps from any scheduled or in_progress MO whose
  planned_start/planned_finish intersects the window.

  `approved` MOs without a schedule sit in the backlog instead —
  see `list_backlog_manufacturing_orders/2`.
  """
  def list_schedule_operations(%User{} = actor, %Warehouse{} = warehouse, from_date, to_date) do
    from_dt = DateTime.new!(from_date, ~T[00:00:00], "Etc/UTC")
    to_dt = DateTime.new!(to_date, ~T[23:59:59], "Etc/UTC")

    ops =
      from(s in ManufacturingOrderStep,
        join: mo in ManufacturingOrder,
        on: mo.id == s.manufacturing_order_id,
        where:
          s.company_id == ^actor.company_id and
            mo.warehouse_id == ^warehouse.id and
            mo.status in ["approved", "scheduled", "in_progress"] and
            not is_nil(s.planned_start) and
            not is_nil(s.planned_finish) and
            s.planned_finish >= ^from_dt and
            s.planned_start <= ^to_dt,
        preload: [:workstation_group, manufacturing_order: [:item, :warehouse]],
        order_by: [asc: s.planned_start, asc: s.id]
      )
      |> Repo.all()

    # Stamp each operation's preloaded MO with qc_pending_count so the
    # planner sees QC progress on the calendar block without an extra
    # per-MO query.
    mo_ids = ops |> Enum.map(& &1.manufacturing_order_id) |> Enum.uniq()
    counts = qc_pending_counts_for(mo_ids)

    Enum.map(ops, fn op ->
      mo = op.manufacturing_order
      count = Map.get(counts, mo.id, 0)
      %{op | manufacturing_order: %{mo | qc_pending_count: count}}
    end)
  end

  @doc """
  Count of bookings whose lot is not yet `available`, keyed by MO id.
  Only counts raw_material / packaging bookings (semi-finished come
  from child MOs, not stock QC). Used by the schedule view + edit
  dialog to surface QC status before the planner clicks Release.
  """
  def qc_pending_counts_for([]), do: %{}

  def qc_pending_counts_for(mo_ids) when is_list(mo_ids) do
    from(b in ManufacturingOrderBooking,
      join: l in StockLot,
      on: l.id == b.stock_lot_id,
      join: it in Item,
      on: it.id == b.item_id,
      where:
        b.manufacturing_order_id in ^mo_ids and
          b.status == "requested" and
          it.item_type in ["raw_material", "packaging"] and
          l.status != "available",
      group_by: b.manufacturing_order_id,
      select: {b.manufacturing_order_id, count(b.id)}
    )
    |> Repo.all()
    |> Map.new()
  end

  @doc """
  Same as `qc_pending_counts_for/1` but for a single MO. Used by the
  release section + the manufacturing_order payload.
  """
  def qc_pending_count_for(%ManufacturingOrder{id: id}) do
    Map.get(qc_pending_counts_for([id]), id, 0)
  end

  @doc """
  Approved-but-unscheduled MOs for `warehouse`, sorted by due_date
  ascending (nulls last) — the planner's backlog feed. An MO counts as
  backlog only when **no step has a planned_start** (i.e. it hasn't
  been placed on the calendar yet). Once any step is scheduled, the MO
  belongs on the calendar even if its status is still "approved" (the
  status only flips to "scheduled" via the Release-to-warehouse
  button).
  """
  def list_backlog_manufacturing_orders(%User{} = actor, %Warehouse{} = warehouse) do
    scheduled_mo_ids =
      from(s in ManufacturingOrderStep,
        where:
          s.company_id == ^actor.company_id and
            not is_nil(s.planned_start),
        select: s.manufacturing_order_id,
        distinct: true
      )

    from(mo in ManufacturingOrder,
      where:
        mo.company_id == ^actor.company_id and
          mo.warehouse_id == ^warehouse.id and
          mo.status == "approved" and
          mo.id not in subquery(scheduled_mo_ids),
      preload: [:item, :warehouse, :bom, :assigned_to, steps: :workstation_group],
      order_by: [
        asc_nulls_last: mo.due_date,
        asc: mo.inserted_at
      ]
    )
    |> Repo.all()
  end

  @doc """
  Working-hour windows for each workstation group on each date in
  the range. Precedence (per group, per day):

      WSG override → warehouse override → company default

  Holidays follow the same chain. A holiday returns an empty
  `intervals` list for that day plus the `holiday_label` so the FE
  can render the red strip on the day header.

  Returns a list of `%{group_id, days: [%{date, intervals, holiday_label}]}`.
  """
  def resolve_working_windows(groups, %Warehouse{} = warehouse, %Company{} = company, from_date, to_date) do
    dates = Date.range(from_date, to_date) |> Enum.to_list()

    company_hours = normalise_working_hours(Map.get(company, :working_hours))
    company_holidays = normalise_holidays_map(Map.get(company, :holidays))

    warehouse_hours = normalise_working_hours(Map.get(warehouse, :working_hours))
    warehouse_holidays = normalise_holidays_map(Map.get(warehouse, :holidays))

    Enum.map(groups, fn g ->
      hours_config =
        cond do
          g.custom_working_hours -> normalise_working_hours(g.working_hours)
          warehouse_hours != %{} -> warehouse_hours
          true -> company_hours
        end

      holidays_set =
        cond do
          g.custom_holidays -> g.holidays |> Enum.map(&Date.to_iso8601/1) |> MapSet.new()
          warehouse_holidays != %{} -> warehouse_holidays |> Map.keys() |> MapSet.new()
          true -> company_holidays |> Map.keys() |> MapSet.new()
        end

      holidays_lookup =
        if g.custom_holidays do
          %{}
        else
          if warehouse_holidays != %{}, do: warehouse_holidays, else: company_holidays
        end

      days =
        Enum.map(dates, fn date ->
          weekday = weekday_key(Date.day_of_week(date))

          holiday_label = Map.get(holidays_lookup, Date.to_iso8601(date))

          intervals =
            cond do
              MapSet.member?(holidays_set, Date.to_iso8601(date)) -> []
              true -> intervals_for(hours_config, weekday, date)
            end

          %{date: date, intervals: intervals, holiday_label: holiday_label}
        end)

      %{group_id: g.id, days: days}
    end)
  end

  defp normalise_working_hours(nil), do: %{}
  defp normalise_working_hours(map) when is_map(map), do: map
  defp normalise_working_hours(_), do: %{}

  # Turn `%{"items" => [%{"date" => "2026-12-25", "label" => "Xmas"}]}`
  # into `%{"2026-12-25" => "Xmas"}` for fast lookup. WSG holidays
  # come through as `[~D[...]]` and are handled separately upstream.
  defp normalise_holidays_map(nil), do: %{}

  defp normalise_holidays_map(%{"items" => items}) when is_list(items) do
    Enum.into(items, %{}, fn item ->
      {Map.get(item, "date", ""), Map.get(item, "label", "")}
    end)
    |> Map.delete("")
  end

  defp normalise_holidays_map(%{} = m), do: m

  defp normalise_holidays_map(_), do: %{}

  defp intervals_for(hours_config, weekday, date) do
    case Map.get(hours_config, weekday) do
      %{"opens_at" => open, "closes_at" => close}
      when is_binary(open) and is_binary(close) and open != "" and close != "" ->
        [%{open: to_dt(date, open), close: to_dt(date, close)}]

      _ ->
        []
    end
  end

  defp to_dt(date, "HH:MM" <> _ = _) do
    # Fallback if a malformed string slipped through.
    DateTime.new!(date, ~T[00:00:00], "Etc/UTC")
  end

  defp to_dt(date, time_str) when is_binary(time_str) do
    case Time.from_iso8601(time_str <> ":00") do
      {:ok, time} -> DateTime.new!(date, time, "Etc/UTC")
      _ -> DateTime.new!(date, ~T[00:00:00], "Etc/UTC")
    end
  end

  defp weekday_key(1), do: "monday"
  defp weekday_key(2), do: "tuesday"
  defp weekday_key(3), do: "wednesday"
  defp weekday_key(4), do: "thursday"
  defp weekday_key(5), do: "friday"
  defp weekday_key(6), do: "saturday"
  defp weekday_key(7), do: "sunday"

  @doc """
  Workstation groups for the company — schedule rows. Active only,
  sorted by name. WSGs aren't per-warehouse in our model so the
  same groups appear on every site's schedule (filtering happens
  via the operation rows themselves).
  """
  def list_workstation_groups_for_schedule(%User{} = actor) do
    from(g in WorkstationGroup,
      where: g.company_id == ^actor.company_id and g.is_active == true,
      order_by: [asc: g.name]
    )
    |> Repo.all()
  end

  # ----- Shared-batch consumer links -------------------------------

  @doc """
  Open sub-MOs (draft or approved) producing the same item as
  `source`, excluding the source itself. Used by the FE picker to
  surface candidate batches to merge into.
  """
  def list_merge_candidates(%User{} = actor, %ManufacturingOrder{} = source) do
    from(m in ManufacturingOrder,
      where:
        m.company_id == ^actor.company_id and
          m.id != ^source.id and
          m.item_id == ^source.item_id and
          m.status in ["draft", "approved"] and
          not is_nil(m.parent_mo_id),
      preload: [:item, :parent_mo],
      order_by: [asc: m.start_at, asc: m.id]
    )
    |> Repo.all()
  end

  @doc """
  Merge a `source` sub-MO into an existing batch `target`. Bumps the
  target's quantity by `source.quantity`, cancels the source (which
  releases its bookings + cancels its own draft/approved children
  via the existing recursive cancel), and records a consumer link
  from the target to the source's parent.

  Validations:

    * Both MOs must be in `draft` or `approved` — physical production
      already started can't be merged.
    * Both must build the same item (no apples-into-oranges).
    * The source must have a parent (it has to be a sub-MO; you can't
      merge an FG run into another FG).
    * The target's parent can't be the source (no cycles).

  Returns `{:ok, reloaded_target}`.
  """
  def merge_mo_into_batch(
        %User{} = actor,
        %ManufacturingOrder{} = source,
        %ManufacturingOrder{} = target
      ) do
    with :ok <- ensure_pre_execution(source),
         :ok <- ensure_pre_execution(target),
         :ok <- ensure_same_item(source, target),
         :ok <- ensure_source_has_parent(source),
         :ok <- ensure_not_self(source, target),
         :ok <- ensure_not_cycle(source, target) do
      Repo.transaction(fn ->
        new_qty = Decimal.add(target.quantity || Decimal.new(0), source.quantity || Decimal.new(0))

        with {:ok, bumped} <-
               update_manufacturing_order(actor, target, %{"quantity" => new_qty}),
             {:ok, _} <- transition_mo(actor, source, "cancelled"),
             {:ok, _link} <-
               %MOConsumerLink{}
               |> MOConsumerLink.changeset(%{
                 "company_id" => actor.company_id,
                 "batch_mo_id" => target.id,
                 "consumer_mo_id" => source.parent_mo_id,
                 "shared_qty" => source.quantity,
                 "created_by_id" => actor.id
               })
               |> Repo.insert() do
          bumped
        else
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
      |> case do
        {:ok, mo} -> {:ok, reload_manufacturing_order(mo)}
        err -> err
      end
    end
  end

  defp ensure_pre_execution(%ManufacturingOrder{status: s})
       when s in ["draft", "approved"],
       do: :ok

  defp ensure_pre_execution(%ManufacturingOrder{status: s}),
    do: {:error, {:not_pre_execution, s}}

  defp ensure_same_item(%ManufacturingOrder{item_id: a}, %ManufacturingOrder{item_id: b})
       when a == b,
       do: :ok

  defp ensure_same_item(_, _), do: {:error, :item_mismatch}

  defp ensure_source_has_parent(%ManufacturingOrder{parent_mo_id: nil}),
    do: {:error, :source_must_be_sub_mo}

  defp ensure_source_has_parent(_), do: :ok

  defp ensure_not_self(%ManufacturingOrder{id: a}, %ManufacturingOrder{id: b}) when a == b,
    do: {:error, :same_mo}

  defp ensure_not_self(_, _), do: :ok

  # Walk the target's parent chain — if we ever hit the source, the
  # merge would create a cycle.
  defp ensure_not_cycle(%ManufacturingOrder{} = source, %ManufacturingOrder{} = target) do
    if has_ancestor?(target, source.id), do: {:error, :would_cycle}, else: :ok
  end

  defp has_ancestor?(%ManufacturingOrder{parent_mo_id: nil}, _ancestor_id), do: false

  defp has_ancestor?(%ManufacturingOrder{parent_mo_id: pid}, ancestor_id) do
    if pid == ancestor_id do
      true
    else
      case Repo.get(ManufacturingOrder, pid) do
        nil -> false
        parent -> has_ancestor?(parent, ancestor_id)
      end
    end
  end

  ## ===== Warehouse pickup workflow ================================
  #
  # Lifecycle, all stamps on the MO row (column-derived state):
  #
  #     scheduled ── release ──► released_to_warehouse_at
  #         │
  #         │  picker queue picks it up once
  #         │  now() >= max(released_at, planned_start - window)
  #         │
  #         └── start ────────► pickup_started_at + by  (head-of-picker lock)
  #             │
  #             │  per-booking scan loop:
  #             │    mark_booking_picked → booking.picked_at
  #             │
  #             ├── abort ────► clear pickup_started_* + picked_*
  #             │
  #             └── confirm ──► pickup_completed_at + by + production_cell_id
  #                              + one Stock.Movement per booking
  #                              (move from origin cell → production cell)
  #
  # All checks server-side; the picker never sees the gate logic.

  @doc """
  Effective pickup window for an MO — the MO's own override if set,
  otherwise the company default. Used by the picker queue to compute
  visibility and by the Release confirm modal to prefill the field.
  """
  def effective_pickup_window_hours(%ManufacturingOrder{} = mo) do
    case mo.pickup_window_hours do
      n when is_integer(n) and n > 0 ->
        n

      _ ->
        case Repo.get(Company, mo.company_id) do
          %Company{default_pickup_window_hours: n} when is_integer(n) and n > 0 -> n
          _ -> 24
        end
    end
  end

  @doc """
  True when this lot is reserved by a manufacturing order whose
  pickup is already in flight (`pickup_started_at IS NOT NULL AND
  pickup_completed_at IS NULL`). Used by `Stock.Lifecycle.record_event`
  to refuse `qc_failed / held / disposed` events on lots that the
  picker is mid-way through — once pickup starts, QC must already
  be done. See the Release gate (`release_mo_to_warehouse/2`) which
  refuses to release an MO with any non-`available` booked lots.
  """
  def lot_locked_by_pickup?(lot_id) when is_integer(lot_id) do
    from(b in ManufacturingOrderBooking,
      join: mo in ManufacturingOrder,
      on: mo.id == b.manufacturing_order_id,
      where:
        b.stock_lot_id == ^lot_id and
          b.status == "requested" and
          not is_nil(mo.pickup_started_at) and
          is_nil(mo.pickup_completed_at),
      select: 1,
      limit: 1
    )
    |> Repo.one()
    |> case do
      nil -> false
      _ -> true
    end
  end

  def lot_locked_by_pickup?(_), do: false

  @doc """
  True when this MO has its pickup in flight — used by step move /
  set-segments to refuse rescheduling while the picker is on the
  floor. Once pickup starts, the planner can't move the calendar
  block out from under the warehouse.
  """
  def mo_pickup_in_progress?(%ManufacturingOrder{} = mo) do
    not is_nil(mo.pickup_started_at) and is_nil(mo.pickup_completed_at)
  end

  def mo_pickup_in_progress?(_), do: false

  @doc """
  Planner action — release a scheduled MO to the warehouse. Refuses
  if any of the MO's bookings point at a lot whose status isn't
  `available` (stale-booking guard: QC must happen before release).

  Optional `:pickup_window_hours` override; nil leaves the per-MO
  field NULL and the picker falls back to the company default.
  """
  def release_mo_to_warehouse(%User{} = actor, %ManufacturingOrder{} = mo, opts \\ []) do
    window = Keyword.get(opts, :pickup_window_hours)

    # Release is the ONLY path from "approved" → "scheduled". Calendar
    # placement no longer auto-flips status. We also accept "scheduled"
    # as a no-op re-release (e.g. legacy MOs already in "scheduled"
    # from the old semantic) so the planner isn't blocked.
    with :ok <- ensure_status_in(mo, ["approved", "scheduled"]),
         :ok <- ensure_has_planned_start(mo),
         :ok <- ensure_all_booked_lots_available(mo),
         :ok <- ensure_no_booked_lots_on_trolley(mo) do
      attrs = %{
        "status" => "scheduled",
        "released_to_warehouse_at" => now(),
        "released_to_warehouse_by_id" => actor.id,
        "updated_by_id" => actor.id
      }

      attrs =
        if is_integer(window) and window > 0 do
          Map.put(attrs, "pickup_window_hours", window)
        else
          attrs
        end

      apply_pickup_changeset(actor, mo, attrs)
    end
  end

  defp ensure_has_planned_start(%ManufacturingOrder{id: id}) do
    has_any? =
      from(s in ManufacturingOrderStep,
        where: s.manufacturing_order_id == ^id and not is_nil(s.planned_start),
        select: count(s.id)
      )
      |> Repo.one()
      |> Kernel.>(0)

    if has_any?, do: :ok, else: {:error, :not_on_calendar}
  end

  # Cross-MO trolley guard. If any booked lot is currently sitting on
  # ANOTHER MO's trolley (different MO with pickup_started_at set,
  # not completed), refuse to release / start_pickup on this MO. The
  # ALL-`available` lot-status check upstream doesn't catch this
  # because picking doesn't change lot.status — only consume does.
  defp ensure_no_booked_lots_on_trolley(%ManufacturingOrder{id: id}) do
    busy =
      from(b in ManufacturingOrderBooking,
        join: other_b in ManufacturingOrderBooking,
        on: other_b.stock_lot_id == b.stock_lot_id and other_b.id != b.id,
        join: other_mo in ManufacturingOrder,
        on: other_mo.id == other_b.manufacturing_order_id,
        where:
          b.manufacturing_order_id == ^id and
            b.status == "requested" and
            other_b.status == "requested" and
            not is_nil(other_mo.pickup_started_at) and
            is_nil(other_mo.pickup_completed_at),
        select: %{
          booking_uuid: b.uuid,
          lot_uuid: b.stock_lot_id,
          other_mo_uuid: other_mo.uuid
        },
        limit: 25
      )
      |> Repo.all()

    case busy do
      [] -> :ok
      list -> {:error, :lots_on_trolley, list}
    end
  end

  @doc """
  Planner action — undo a release. Only valid before pickup starts;
  once `pickup_started_at` is set, the planner must wait or have the
  picker abort first.
  """
  def unrelease_mo_from_warehouse(%User{} = actor, %ManufacturingOrder{} = mo) do
    cond do
      is_nil(mo.released_to_warehouse_at) ->
        {:error, :not_released}

      not is_nil(mo.pickup_started_at) ->
        {:error, :pickup_in_progress}

      true ->
        # Reverse release: drop the timestamp + actor and flip status
        # back to "approved" so the MO is no longer in the picker queue
        # and the planner can re-edit the schedule freely.
        apply_pickup_changeset(actor, mo, %{
          "status" => "approved",
          "released_to_warehouse_at" => nil,
          "released_to_warehouse_by_id" => nil,
          "updated_by_id" => actor.id
        })
    end
  end

  @doc """
  Picker action — claim the head-of-picker lock and stamp the start
  of pickup. From this point QC verdicts on the booked lots are
  locked (see `lot_locked_by_pickup?/1`) and the planner can no
  longer reschedule the steps.
  """
  def start_mo_pickup(%User{} = actor, %ManufacturingOrder{} = mo) do
    cond do
      is_nil(mo.released_to_warehouse_at) ->
        {:error, :not_released}

      not is_nil(mo.pickup_started_at) and is_nil(mo.pickup_completed_at) ->
        {:error, :pickup_already_started}

      not is_nil(mo.pickup_completed_at) ->
        {:error, :pickup_already_completed}

      true ->
        # Cross-MO trolley guard at start time too — another picker
        # may have grabbed a shared lot AFTER this MO was released.
        case ensure_no_booked_lots_on_trolley(mo) do
          :ok ->
            apply_pickup_changeset(actor, mo, %{
              "pickup_started_at" => now(),
              "pickup_started_by_id" => actor.id,
              "updated_by_id" => actor.id
            })

          {:error, :lots_on_trolley, list} ->
            {:error, :lots_on_trolley, list}
        end
    end
  end

  @doc """
  Picker action — mark one booking as physically scanned. Verifies
  the scanned lot + cell UUIDs match the booking. Lot stays logically
  at its original cell; no `Stock.Movement` emitted yet (that happens
  on confirm-transfer).

  Idempotent: re-marking an already-picked booking succeeds without
  re-stamping `picked_at` so a re-scan after a network hiccup doesn't
  cause an error.
  """
  def mark_booking_picked(
        %User{} = actor,
        %ManufacturingOrderBooking{} = booking,
        scanned_lot_uuid,
        scanned_cell_uuid
      )
      when is_binary(scanned_lot_uuid) and is_binary(scanned_cell_uuid) do
    mo = Repo.get!(ManufacturingOrder, booking.manufacturing_order_id)
    lot = Repo.get!(StockLot, booking.stock_lot_id)

    cell =
      case booking.storage_cell_id do
        nil -> nil
        id -> Repo.get(Backend.Warehouses.StorageCell, id)
      end

    cond do
      not mo_pickup_in_progress?(mo) ->
        {:error, :pickup_not_in_progress}

      booking.status != "requested" ->
        {:error, :booking_not_pickable}

      scanned_lot_uuid != lot.uuid ->
        {:error, :wrong_lot}

      not is_nil(cell) and scanned_cell_uuid != cell.uuid ->
        {:error, :wrong_cell}

      not is_nil(booking.picked_at) ->
        {:ok, booking}

      true ->
        before = booking_snapshot(booking)

        attrs = %{
          "picked_at" => now(),
          "picked_by_id" => actor.id,
          "updated_by_id" => actor.id
        }

        case booking
             |> ManufacturingOrderBooking.changeset(attrs)
             |> Repo.update() do
          {:ok, updated} ->
            Audit.record_updated(
              actor,
              "manufacturing_order_booking",
              updated,
              before,
              booking_snapshot(updated)
            )

            {:ok, updated}

          err ->
            err
        end
    end
  end

  @doc """
  Picker action — abandon the in-flight pickup. Clears every booking's
  `picked_at` and the MO's pickup_started_* stamps in one transaction.
  Lots stay put (no movements were ever emitted). MO returns to
  released-ready state; another picker can start fresh.
  """
  def abort_mo_pickup(%User{} = actor, %ManufacturingOrder{} = mo) do
    cond do
      not mo_pickup_in_progress?(mo) ->
        {:error, :pickup_not_in_progress}

      true ->
        Repo.transaction(fn ->
          # Clear picked_at on every booking. Plain Repo.update_all
          # bypasses audit — fine here because the abort is itself
          # the audited event (via apply_pickup_changeset below).
          {_, _} =
            from(b in ManufacturingOrderBooking,
              where:
                b.manufacturing_order_id == ^mo.id and
                  not is_nil(b.picked_at)
            )
            |> Repo.update_all(
              set: [
                picked_at: nil,
                picked_by_id: nil,
                updated_at: now()
              ]
            )

          case apply_pickup_changeset(actor, mo, %{
                 "pickup_started_at" => nil,
                 "pickup_started_by_id" => nil,
                 "updated_by_id" => actor.id
               }) do
            {:ok, updated} -> updated
            {:error, reason} -> Repo.rollback(reason)
          end
        end)
    end
  end

  @doc """
  Picker action — final transfer. Validates that every booking is
  picked, the target cell is an empty `production_feed` cell, then
  emits one `Stock.Movement` per booking (`kind: "move"`, `from =
  booking origin cell`, `to = production cell`, photo_url per
  booking) and stamps `pickup_completed_at` + `production_cell_id`
  on the MO. All-or-nothing — any validation failure rolls back.

  `photo_urls_by_booking_uuid` is a map of booking UUID → uploaded
  photo URL (from /api/m/movement-photos). Per CLAUDE.md compliance
  rule #5 these are file refs, not user-typed URLs.

  NB: the cell-fit calculation lives in the Phase 5 controller — by
  the time this call lands, the FE has already confirmed (via the
  same recommendation system used by the mobile move flow) that the
  load fits. This function trusts the target_cell_uuid.
  """
  def confirm_pickup_transfer(
        %User{} = actor,
        %ManufacturingOrder{} = mo,
        target_cell_uuid,
        photo_urls_by_booking_uuid
      )
      when is_binary(target_cell_uuid) and is_map(photo_urls_by_booking_uuid) do
    bookings = list_pickup_bookings(mo)

    cond do
      not mo_pickup_in_progress?(mo) ->
        {:error, :pickup_not_in_progress}

      Enum.any?(bookings, &is_nil(&1.picked_at)) ->
        {:error, :bookings_not_all_picked}

      Enum.empty?(bookings) ->
        {:error, :no_bookings_to_transfer}

      true ->
        case fetch_production_feed_cell(mo.company_id, target_cell_uuid) do
          {:error, reason} ->
            {:error, reason}

          {:ok, target_cell} ->
            do_confirm_pickup_transfer(actor, mo, bookings, target_cell, photo_urls_by_booking_uuid)
        end
    end
  end

  defp do_confirm_pickup_transfer(actor, mo, bookings, target_cell, photo_urls) do
    Repo.transaction(fn ->
      now_dt = now()

      Enum.each(bookings, fn booking ->
        case transfer_booking_to_production(actor, booking, target_cell, photo_urls, now_dt) do
          {:ok, _movement} -> :ok
          {:error, reason} -> Repo.rollback(reason)
        end
      end)

      case apply_pickup_changeset(actor, mo, %{
             "pickup_completed_at" => now_dt,
             "pickup_completed_by_id" => actor.id,
             "production_cell_id" => target_cell.id,
             "updated_by_id" => actor.id
           }) do
        {:ok, updated} -> updated
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  # Emits one Stock.Movement per booked lot — moves the booking's qty
  # from its origin cell to the production-feed cell. Mirrors
  # Backend.Stock.insert_move_movement/7 but inline here so the whole
  # pickup transfer lives in one transaction.
  defp transfer_booking_to_production(actor, booking, target_cell, photo_urls, now_dt) do
    photo_url = Map.get(photo_urls, booking.uuid)

    %Backend.Stock.Movement{}
    |> Backend.Stock.Movement.changeset(%{
      "company_id" => booking.company_id,
      "stock_lot_id" => booking.stock_lot_id,
      "from_cell_id" => booking.storage_cell_id,
      "to_cell_id" => target_cell.id,
      "delta_qty" => booking.quantity,
      "kind" => "move",
      "actor_id" => actor.id,
      "occurred_at" => now_dt,
      "photo_url" => photo_url,
      "reference_kind" => "manufacturing_order",
      "reference_ref" => mo_uuid_for_booking(booking)
    })
    |> Repo.insert()
    |> case do
      {:ok, movement} ->
        # Decrement origin placement, upsert destination placement
        # so the on-floor inventory stays accurate.
        with {:ok, _from_placement} <- decrement_lot_placement(booking),
             {:ok, _to_placement} <- upsert_lot_placement(booking, target_cell) do
          Audit.record_created(actor, "stock_movement", movement, %{
            kind: movement.kind,
            delta_qty: movement.delta_qty,
            from_cell_id: movement.from_cell_id,
            to_cell_id: movement.to_cell_id,
            reference_kind: movement.reference_kind,
            reference_ref: movement.reference_ref
          })

          {:ok, movement}
        end

      err ->
        err
    end
  end

  defp mo_uuid_for_booking(%ManufacturingOrderBooking{} = b) do
    case Repo.get(ManufacturingOrder, b.manufacturing_order_id) do
      %ManufacturingOrder{uuid: uuid} -> uuid
      _ -> nil
    end
  end

  defp decrement_lot_placement(%ManufacturingOrderBooking{} = b) do
    case Repo.get_by(Backend.Stock.Placement,
           stock_lot_id: b.stock_lot_id,
           storage_cell_id: b.storage_cell_id
         ) do
      nil ->
        {:error, :placement_not_found}

      %Backend.Stock.Placement{} = p ->
        new_qty = Decimal.sub(p.qty, b.quantity)

        if Decimal.compare(new_qty, Decimal.new(0)) == :lt do
          {:error, :insufficient_qty}
        else
          p
          |> Backend.Stock.Placement.changeset(%{"qty" => new_qty})
          |> Repo.update()
        end
    end
  end

  defp upsert_lot_placement(%ManufacturingOrderBooking{} = b, target_cell) do
    case Repo.get_by(Backend.Stock.Placement,
           stock_lot_id: b.stock_lot_id,
           storage_cell_id: target_cell.id
         ) do
      %Backend.Stock.Placement{} = existing ->
        existing
        |> Backend.Stock.Placement.changeset(%{
          "qty" => Decimal.add(existing.qty, b.quantity)
        })
        |> Repo.update()

      nil ->
        %Backend.Stock.Placement{}
        |> Backend.Stock.Placement.changeset(%{
          "company_id" => b.company_id,
          "stock_lot_id" => b.stock_lot_id,
          "storage_cell_id" => target_cell.id,
          "qty" => b.quantity
        })
        |> Repo.insert()
    end
  end

  # ----- pickup queue + per-MO helpers ----------------------------

  @doc """
  Bookings the picker walks for this MO. Filtered to raw materials +
  packaging because BOM-output (semi-finished) lots are produced by
  child MOs and don't enter the warehouse picking flow until the
  child completes (deferred to a later phase).
  """
  def list_pickup_bookings(%ManufacturingOrder{} = mo) do
    from(b in ManufacturingOrderBooking,
      join: it in Item,
      on: it.id == b.item_id,
      where:
        b.manufacturing_order_id == ^mo.id and
          b.status == "requested" and
          it.item_type in ["raw_material", "packaging"],
      order_by: [asc: it.name, asc: b.id],
      preload: [
        :item,
        :picked_by,
        storage_cell: [storage_location: [floor: [:warehouse]]],
        stock_lot: [:item, :unit_of_measurement]
      ]
    )
    |> Repo.all()
  end

  @doc """
  Picker-page queue for a company. Returns released MOs whose
  visibility window has opened and whose pickup isn't yet complete.
  Sorted by `pickup_by` (earliest first).

  Visibility window:
    open  = max(released_to_warehouse_at, planned_start - window)
    close = pickup_completed_at IS NULL
  """
  def list_pickup_queue(company_id) when is_integer(company_id) do
    now_dt = now()

    company_default =
      case Repo.get(Company, company_id) do
        %Company{default_pickup_window_hours: n} when is_integer(n) and n > 0 -> n
        _ -> 24
      end

    # Pull released + scheduled MOs first; compute visibility in
    # Elixir so the per-MO window override + the company default fall
    # through cleanly without a CASE expression on every row.
    mos =
      from(m in ManufacturingOrder,
        where:
          m.company_id == ^company_id and
            m.status == "scheduled" and
            not is_nil(m.released_to_warehouse_at) and
            is_nil(m.pickup_completed_at),
        preload: [:item, :warehouse, :pickup_started_by, steps: []]
      )
      |> Repo.all()

    mos
    |> Enum.map(fn mo ->
      window_hours =
        case mo.pickup_window_hours do
          n when is_integer(n) and n > 0 -> n
          _ -> company_default
        end

      planned_start = earliest_step_start(mo)
      pickup_by = planned_start && DateTime.add(planned_start, -window_hours * 3600, :second)

      visible_from =
        cond do
          is_nil(pickup_by) -> mo.released_to_warehouse_at
          DateTime.compare(mo.released_to_warehouse_at, pickup_by) == :gt -> mo.released_to_warehouse_at
          true -> pickup_by
        end

      %{
        mo: mo,
        pickup_by: pickup_by,
        visible_from: visible_from,
        window_hours: window_hours
      }
    end)
    |> Enum.filter(fn %{visible_from: vf} ->
      not is_nil(vf) and DateTime.compare(now_dt, vf) != :lt
    end)
    |> Enum.sort_by(fn %{pickup_by: pb} -> pb || ~U[2099-01-01 00:00:00Z] end, DateTime)
  end

  defp earliest_step_start(%ManufacturingOrder{steps: steps}) when is_list(steps) do
    steps
    |> Enum.map(& &1.planned_start)
    |> Enum.reject(&is_nil/1)
    |> case do
      [] -> nil
      list -> Enum.min(list, DateTime)
    end
  end

  defp earliest_step_start(_), do: nil

  @doc """
  Empty production-feed cells for confirm-transfer auto-pick. A cell
  counts as empty when no placement on it has positive qty. Returns
  newest-first so a planner who just provisioned a fresh cell sees
  it surface immediately.
  """
  def list_empty_production_feed_cells(company_id) when is_integer(company_id) do
    occupied_subq =
      from(p in Backend.Stock.Placement,
        join: c in Backend.Warehouses.StorageCell,
        on: c.id == p.storage_cell_id,
        where:
          c.company_id == ^company_id and
            c.purpose == "production_feed" and
            p.qty > 0,
        select: c.id,
        distinct: true
      )

    from(c in Backend.Warehouses.StorageCell,
      where:
        c.company_id == ^company_id and
          c.purpose == "production_feed" and
          c.id not in subquery(occupied_subq),
      preload: [storage_location: [floor: [:warehouse]]],
      order_by: [desc: c.inserted_at, desc: c.id]
    )
    |> Repo.all()
  end

  # ----- pickup helpers ------------------------------------------

  defp apply_pickup_changeset(%User{} = actor, %ManufacturingOrder{} = mo, attrs) do
    before = mo_snapshot(mo)

    mo
    |> ManufacturingOrder.pickup_changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "manufacturing_order",
          updated,
          before,
          mo_snapshot(updated)
        )

        {:ok, reload_manufacturing_order(updated)}

      err ->
        err
    end
  end

  defp ensure_all_booked_lots_available(%ManufacturingOrder{} = mo) do
    stale =
      from(b in ManufacturingOrderBooking,
        join: l in StockLot,
        on: l.id == b.stock_lot_id,
        join: it in Item,
        on: it.id == b.item_id,
        where:
          b.manufacturing_order_id == ^mo.id and
            b.status == "requested" and
            it.item_type in ["raw_material", "packaging"] and
            l.status != "available",
        select: %{booking_uuid: b.uuid, lot_uuid: l.uuid, lot_status: l.status}
      )
      |> Repo.all()

    case stale do
      [] -> :ok
      list -> {:error, :stale_bookings, list}
    end
  end

  defp fetch_production_feed_cell(company_id, uuid) do
    case Repo.get_by(Backend.Warehouses.StorageCell, uuid: uuid, company_id: company_id) do
      nil ->
        {:error, :production_cell_not_found}

      %Backend.Warehouses.StorageCell{purpose: "production_feed"} = cell ->
        {:ok, cell}

      %Backend.Warehouses.StorageCell{} ->
        {:error, :production_cell_wrong_purpose}
    end
  end

end
