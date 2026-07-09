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
    Machine,
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
  @bom_sortable [:inserted_at, :updated_at, :name, :is_primary, :is_active, :item_id]
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

    {item_needle, column_filter} =
      ListQueries.pop_joined_text_filter(opts[:column_filter], "item")

    base =
      BOM
      |> where([b], b.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @bom_search)
      |> maybe_item_filter(opts[:item_id])
      |> maybe_active_filter(opts[:is_active])
      |> maybe_bom_item_name_filter(item_needle)
      |> ListQueries.apply_column_filters(column_filter, @bom_sortable)
      |> ListQueries.apply_sort(sort, @bom_sortable, @bom_default_sort)
      |> preload([:item, :created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp maybe_bom_item_name_filter(query, nil), do: query

  defp maybe_bom_item_name_filter(query, needle) when is_binary(needle) do
    like = "%" <> ListQueries.escape_like(needle) <> "%"

    from b in query,
      join: i in Item,
      on: i.id == b.item_id,
      where: ilike(i.name, ^like) or ilike(i.external_sku, ^like)
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
        {:ok, {bom, _lines}} ->
          Backend.Broadcasts.entity_changed("bom", bom.uuid, bom.company_id, "created")
          {:ok, reload(bom)}

        other ->
          other
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
      {:ok, {bom, _lines}} ->
        Backend.Broadcasts.entity_changed("bom", bom.uuid, bom.company_id, "updated")
        {:ok, reload(bom)}

      other ->
        other
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
    |> tap(fn
      {:ok, %BOM{} = bom} ->
        Backend.Broadcasts.entity_changed("bom", bom.uuid, bom.company_id, "primary_set")

      _ ->
        :ok
    end)
  end

  @doc """
  Delete a BOM and cascade its lines.
  """
  def delete_bom(%User{} = actor, %BOM{} = bom) do
    case Repo.delete(bom) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "bom", deleted, snapshot(deleted))
        Backend.Broadcasts.entity_changed("bom", bom.uuid, bom.company_id, "deleted")
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
  @wg_sortable [:inserted_at, :updated_at, :name, :kind, :is_active]
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
      |> ListQueries.apply_column_filters(opts[:column_filter], @wg_sortable)
      |> ListQueries.apply_sort(sort, @wg_sortable, @wg_default_sort)
      |> preload([:created_by, :updated_by])

    {items, next_cursor} =
      ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])

    {populate_workstation_counts(items), next_cursor}
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
    |> case do
      nil -> nil
      g -> populate_workstation_count(g)
    end
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
        Backend.Broadcasts.entity_changed("workstation-group", group.uuid, group.company_id, "created")
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
        Backend.Broadcasts.entity_changed("workstation-group", updated.uuid, updated.company_id, "updated")
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
        Backend.Broadcasts.entity_changed("workstation-group", group.uuid, group.company_id, "deleted")
        {:ok, deleted}

      err ->
        err
    end
  end

  defp reload_workstation_group(%WorkstationGroup{} = g) do
    g
    |> Repo.preload([:created_by, :updated_by], force: true)
    |> populate_workstation_count()
  end

  # Stuff the virtual `workstation_count` field with the count of
  # active Workstation rows. Capacity = this number. Called on every
  # read path so the FE always sees the current number; we don't
  # cache it because adding/removing stations is rare and the count
  # query is a single indexed lookup.
  defp populate_workstation_count(%WorkstationGroup{} = g) do
    count =
      from(w in Workstation,
        where: w.workstation_group_id == ^g.id and w.is_active == true,
        select: count(w.id)
      )
      |> Repo.one() || 0

    %{g | workstation_count: count}
  end

  # Bulk variant for list pages — one query for the whole page.
  defp populate_workstation_counts(groups) when is_list(groups) do
    case Enum.map(groups, & &1.id) do
      [] ->
        groups

      ids ->
        counts =
          from(w in Workstation,
            where: w.workstation_group_id in ^ids and w.is_active == true,
            group_by: w.workstation_group_id,
            select: {w.workstation_group_id, count(w.id)}
          )
          |> Repo.all()
          |> Map.new()

        Enum.map(groups, fn g ->
          %{g | workstation_count: Map.get(counts, g.id, 0)}
        end)
    end
  end

  # Audit snapshot — every column the operator can change at form time.
  defp wg_snapshot(%WorkstationGroup{} = g) do
    %{
      name: g.name,
      notes: g.notes,
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
  @ws_sortable [:inserted_at, :updated_at, :name, :is_active, :workstation_group_id, :warehouse_id]
  @ws_default_sort {:inserted_at, :desc}

  def list_workstations_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = Keyword.get(opts, :sort, @ws_default_sort)

    {group_needle, column_filter} =
      ListQueries.pop_joined_text_filter(opts[:column_filter], "group")

    base =
      Workstation
      |> where([w], w.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @ws_search)
      |> maybe_ws_group_filter(opts[:workstation_group_id])
      |> maybe_ws_warehouse_filter(opts[:warehouse_id])
      |> maybe_active_filter(opts[:is_active])
      |> maybe_ws_group_name_filter(group_needle)
      |> ListQueries.apply_column_filters(column_filter, @ws_sortable)
      |> ListQueries.apply_sort(sort, @ws_sortable, @ws_default_sort)
      |> preload([:workstation_group, :warehouse, :created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp maybe_ws_group_name_filter(query, nil), do: query

  defp maybe_ws_group_name_filter(query, needle) when is_binary(needle) do
    like = "%" <> ListQueries.escape_like(needle) <> "%"

    from w in query,
      join: g in WorkstationGroup,
      on: g.id == w.workstation_group_id,
      where: ilike(g.name, ^like)
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
        {:ok, ws} ->
          Backend.Broadcasts.entity_changed("workstation", ws.uuid, ws.company_id, "created")
          {:ok, reload_workstation(ws)}

        other ->
          other
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
        {:ok, ws} ->
          Backend.Broadcasts.entity_changed("workstation", ws.uuid, ws.company_id, "updated")
          {:ok, reload_workstation(ws)}

        other ->
          other
      end
    end
  end

  def delete_workstation(%User{} = actor, %Workstation{} = ws) do
    before = ws_snapshot(ws)

    case Repo.delete(ws) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "workstation", deleted, before)
        Backend.Broadcasts.entity_changed("workstation", ws.uuid, ws.company_id, "deleted")
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
  # Machines
  # ============================================================
  #
  # Physical assets attached to a Workstation. Cost cascade lives in
  # Backend.Production.Costing — sum of active machines' hourly rates
  # falls back to the station's own override, then the group's rate.

  @machine_search [:name, :notes, :asset_tag, :serial_number, :manufacturer, :model]
  @machine_sortable [
    :inserted_at,
    :updated_at,
    :name,
    :is_active,
    :hourly_rate,
    :workstation_id,
    :next_calibration_due_at
  ]
  @machine_default_sort {:inserted_at, :desc}

  def list_machines_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = Keyword.get(opts, :sort, @machine_default_sort)

    {station_needle, column_filter} =
      ListQueries.pop_joined_text_filter(opts[:column_filter], "workstation")

    base =
      Machine
      |> where([m], m.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @machine_search)
      |> maybe_machine_workstation_filter(opts[:workstation_id])
      |> maybe_active_filter(opts[:is_active])
      |> maybe_machine_workstation_name_filter(station_needle)
      |> ListQueries.apply_column_filters(column_filter, @machine_sortable)
      |> ListQueries.apply_sort(sort, @machine_sortable, @machine_default_sort)
      |> preload([:workstation, :created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp maybe_machine_workstation_filter(query, nil), do: query

  defp maybe_machine_workstation_filter(query, id) when is_integer(id),
    do: where(query, [m], m.workstation_id == ^id)

  defp maybe_machine_workstation_filter(query, raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} -> where(query, [m], m.workstation_id == ^n)
      _ -> query
    end
  end

  defp maybe_machine_workstation_filter(query, _), do: query

  defp maybe_machine_workstation_name_filter(query, nil), do: query

  defp maybe_machine_workstation_name_filter(query, needle) when is_binary(needle) do
    like = "%" <> ListQueries.escape_like(needle) <> "%"

    from m in query,
      join: w in Workstation,
      on: w.id == m.workstation_id,
      where: ilike(w.name, ^like)
  end

  def get_machine(company_id, uuid)
      when is_integer(company_id) and is_binary(uuid) do
    Machine
    |> where([m], m.company_id == ^company_id and m.uuid == ^uuid)
    |> preload([:workstation, :created_by, :updated_by])
    |> Repo.one()
  end

  def list_machines_for_workstation(company_id, workstation_id)
      when is_integer(company_id) and is_integer(workstation_id) do
    Machine
    |> where(
      [m],
      m.company_id == ^company_id and m.workstation_id == ^workstation_id
    )
    |> order_by([m], asc: m.name)
    |> Repo.all()
  end

  def create_machine(%User{} = actor, attrs) do
    attrs = stringify_keys(attrs)

    attrs =
      attrs
      |> Map.put("company_id", actor.company_id)
      |> Map.put("created_by_id", actor.id)
      |> Map.put("updated_by_id", actor.id)

    with :ok <- ensure_workstation_in_company(actor, attrs["workstation_id"]) do
      %Machine{}
      |> Machine.changeset(attrs)
      |> Repo.insert()
      |> case do
        {:ok, machine} ->
          Audit.record_created(actor, "machine", machine, machine_snapshot(machine))
          Backend.Broadcasts.entity_changed("machine", machine.uuid, machine.company_id, "created")
          {:ok, reload_machine(machine)}

        other ->
          other
      end
    end
  end

  def update_machine(%User{} = actor, %Machine{} = machine, attrs) do
    attrs = stringify_keys(attrs)
    before = machine_snapshot(machine)

    attrs =
      attrs
      |> Map.delete("company_id")
      |> Map.delete("created_by_id")
      |> Map.put("updated_by_id", actor.id)

    with :ok <-
           (if Map.has_key?(attrs, "workstation_id"),
              do: ensure_workstation_in_company(actor, attrs["workstation_id"]),
              else: :ok) do
      machine
      |> Machine.changeset(attrs)
      |> Repo.update()
      |> case do
        {:ok, updated} ->
          Audit.record_updated(
            actor,
            "machine",
            updated,
            before,
            machine_snapshot(updated)
          )

          Backend.Broadcasts.entity_changed("machine", updated.uuid, updated.company_id, "updated")
          {:ok, reload_machine(updated)}

        other ->
          other
      end
    end
  end

  @doc """
  Recalibration action — stamps `last_calibrated_at` to today (or the
  provided date), and if `calibration_frequency_months` is set, auto-
  computes the next due date. The event is captured in the audit trail
  as an "updated" record so peers see the change on the Activity card
  without a bespoke event type.
  """
  def recalibrate_machine(%User{} = actor, %Machine{} = machine, attrs \\ %{}) do
    today = Map.get(attrs, "calibrated_at") || Map.get(attrs, :calibrated_at) || Date.utc_today()

    freq =
      Map.get(attrs, "frequency_months") || Map.get(attrs, :frequency_months) ||
        machine.calibration_frequency_months

    next_due =
      case freq do
        n when is_integer(n) and n > 0 ->
          Date.add(today, round(n * 30.4375))

        _ ->
          nil
      end

    update_attrs = %{
      "last_calibrated_at" => today,
      "next_calibration_due_at" => next_due
    }

    update_attrs =
      if freq && freq != machine.calibration_frequency_months do
        Map.put(update_attrs, "calibration_frequency_months", freq)
      else
        update_attrs
      end

    update_machine(actor, machine, update_attrs)
  end

  def archive_machine(%User{} = actor, %Machine{} = machine) do
    update_machine(actor, machine, %{"is_active" => false})
  end

  def delete_machine(%User{} = actor, %Machine{} = machine) do
    before = machine_snapshot(machine)

    case Repo.delete(machine) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "machine", deleted, before)
        Backend.Broadcasts.entity_changed("machine", machine.uuid, machine.company_id, "deleted")
        {:ok, deleted}

      err ->
        err
    end
  end

  defp reload_machine(%Machine{} = machine) do
    Repo.preload(machine, [:workstation, :created_by, :updated_by], force: true)
  end

  defp ensure_workstation_in_company(_actor, nil), do: {:error, :workstation_required}

  defp ensure_workstation_in_company(%User{} = actor, id) do
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

    case int_id && Repo.get(Workstation, int_id) do
      %Workstation{company_id: cid} when cid == actor.company_id -> :ok
      _ -> {:error, :workstation_not_found}
    end
  end

  defp machine_snapshot(%Machine{} = m) do
    %{
      name: m.name,
      notes: m.notes,
      workstation_id: m.workstation_id,
      hourly_rate_enabled: m.hourly_rate_enabled,
      hourly_rate: m.hourly_rate,
      asset_tag: m.asset_tag,
      serial_number: m.serial_number,
      manufacturer: m.manufacturer,
      model: m.model,
      commissioned_at: m.commissioned_at,
      last_calibrated_at: m.last_calibrated_at,
      next_calibration_due_at: m.next_calibration_due_at,
      calibration_frequency_months: m.calibration_frequency_months,
      is_active: m.is_active
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
  @routing_sortable [:inserted_at, :updated_at, :name, :is_active, :item_id, :bom_id]
  @routing_default_sort {:inserted_at, :desc}

  def list_routings_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = Keyword.get(opts, :sort, @routing_default_sort)

    column_filter = opts[:column_filter]
    {item_needle, column_filter} = ListQueries.pop_joined_text_filter(column_filter, "item")
    {bom_needle, column_filter} = ListQueries.pop_joined_text_filter(column_filter, "bom")

    base =
      Routing
      |> where([r], r.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @routing_search)
      |> maybe_routing_item_filter(opts[:item_id])
      |> maybe_routing_bom_filter(opts[:bom_id])
      |> maybe_active_filter(opts[:is_active])
      |> maybe_routing_item_name_filter(item_needle)
      |> maybe_routing_bom_name_filter(bom_needle)
      |> ListQueries.apply_column_filters(column_filter, @routing_sortable)
      |> ListQueries.apply_sort(sort, @routing_sortable, @routing_default_sort)
      |> preload([:item, :bom, :created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp maybe_routing_item_name_filter(query, nil), do: query

  defp maybe_routing_item_name_filter(query, needle) when is_binary(needle) do
    like = "%" <> ListQueries.escape_like(needle) <> "%"

    from r in query,
      join: i in Item,
      on: i.id == r.item_id,
      where: ilike(i.name, ^like) or ilike(i.external_sku, ^like)
  end

  defp maybe_routing_bom_name_filter(query, nil), do: query

  defp maybe_routing_bom_name_filter(query, needle) when is_binary(needle) do
    like = "%" <> ListQueries.escape_like(needle) <> "%"

    from r in query,
      join: b in BOM,
      on: b.id == r.bom_id,
      where: ilike(b.name, ^like)
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
        {:ok, routing} ->
          Backend.Broadcasts.entity_changed("routing", routing.uuid, routing.company_id, "created")
          {:ok, reload_routing(routing)}

        other ->
          other
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
        {:ok, routing} ->
          Backend.Broadcasts.entity_changed("routing", routing.uuid, routing.company_id, "updated")
          {:ok, reload_routing(routing)}

        other ->
          other
      end
    end
  end

  def delete_routing(%User{} = actor, %Routing{} = routing) do
    before = routing_snapshot(routing)

    case Repo.delete(routing) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "routing", deleted, before)
        Backend.Broadcasts.entity_changed("routing", routing.uuid, routing.company_id, "deleted")
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
  @mo_sortable [
    :id,
    :status,
    :quantity,
    :quantity_produced,
    :due_date,
    :expiry_date,
    :revision,
    :needs_replan,
    :item_id,
    :bom_id,
    :warehouse_id,
    :assigned_to_id,
    :prepared_at,
    :approved_at,
    :purchasing_requested_at,
    :released_to_warehouse_at,
    :pickup_started_at,
    :pickup_completed_at,
    :actual_start,
    :actual_finish,
    :inserted_at,
    :updated_at
  ]
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

    column_filter = opts[:column_filter]
    {product_needle, column_filter} = ListQueries.pop_joined_text_filter(column_filter, "product")
    {site_needle, column_filter} = ListQueries.pop_joined_text_filter(column_filter, "site")
    {bom_needle, column_filter} = ListQueries.pop_joined_text_filter(column_filter, "bom")

    base =
      ManufacturingOrder
      |> where([m], m.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @mo_search)
      |> maybe_mo_status_filter(opts[:status])
      |> maybe_mo_item_filter(opts[:item_id])
      |> maybe_mo_warehouse_filter(opts[:warehouse_id])
      |> maybe_mo_product_name_filter(product_needle)
      |> maybe_mo_site_name_filter(site_needle)
      |> maybe_mo_bom_name_filter(bom_needle)
      |> ListQueries.apply_column_filters(column_filter, @mo_sortable)
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

  defp maybe_mo_product_name_filter(query, nil), do: query

  defp maybe_mo_product_name_filter(query, needle) when is_binary(needle) do
    like = "%" <> ListQueries.escape_like(needle) <> "%"

    from m in query,
      join: i in Item,
      on: i.id == m.item_id,
      where: ilike(i.name, ^like) or ilike(i.external_sku, ^like)
  end

  defp maybe_mo_site_name_filter(query, nil), do: query

  defp maybe_mo_site_name_filter(query, needle) when is_binary(needle) do
    like = "%" <> ListQueries.escape_like(needle) <> "%"

    from m in query,
      join: w in Warehouse,
      on: w.id == m.warehouse_id,
      where: ilike(w.name, ^like)
  end

  defp maybe_mo_bom_name_filter(query, nil), do: query

  defp maybe_mo_bom_name_filter(query, needle) when is_binary(needle) do
    like = "%" <> ListQueries.escape_like(needle) <> "%"

    from m in query,
      join: b in BOM,
      on: b.id == m.bom_id,
      where: ilike(b.name, ^like)
  end

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
      :warehouse,
      :assigned_to,
      :approved_by,
      :prepared_by,
      :created_by,
      :updated_by,
      :released_to_warehouse_by,
      :pickup_started_by,
      :pickup_completed_by,
      :purchasing_requested_by,
      :produced_lot,
      # The Finish dialog + parts table read item.stock_uom for the
      # "Produced quantity (kg)" label and UoM symbol — without this
      # preload the FE falls back to "ea" even for kg / pcs items.
      item: :stock_uom,
      production_cell: [storage_location: [floor: [:warehouse]]],
      steps: [:workstation_group, :routing_step, worker_assignments: :user],
      bookings: [
        :item,
        :picked_by,
        :received_by,
        :consumed_by,
        storage_cell: [storage_location: [floor: [:warehouse]]],
        stock_lot: [placements: :storage_cell],
        purchase_order_line: :purchase_order
      ],
      bom: [lines: [:part, :unit_of_measurement]],
      routing: [steps: [:workstation_group, worker_assignments: :user]],
      parent_mo: [item: :stock_uom],
      children: [item: :stock_uom],
      consumer_links: [consumer_mo: [item: :stock_uom]],
      supplier_links: [batch_mo: [item: :stock_uom]]
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

  @doc """
  Every WorkstationSession attributed to `mo_id`. Chronological
  descending (newest first). Preloads the workstation + step so the
  timeline can show which station a session ran on and which
  operation it covered.
  """
  def list_sessions_for_mo(company_id, mo_id)
      when is_integer(company_id) and is_integer(mo_id) do
    from(s in Backend.Production.WorkstationSession,
      join: step in assoc(s, :manufacturing_order_step),
      where: s.company_id == ^company_id and step.manufacturing_order_id == ^mo_id,
      order_by: [desc: s.started_at, desc: s.id],
      preload: [
        :workstation,
        manufacturing_order_step: [:workstation_group, :manufacturing_order]
      ]
    )
    |> Repo.all()
  end

  @doc """
  Every WorkstationSession an employee has ever run — MO-attached
  and off-MO, chronological desc. Sessions carry the attribution as
  a `Ecto.UUID[]` array (multiple operators can share a session),
  so we match with `?` = the ANY-of check.

  Accepts `:limit` (default 5, clamped [1, 100]) + `:cursor` for keyset
  pagination — same shape the HR reputation / wages timelines use.
  Returns `{items, next_cursor}` where `next_cursor` is `nil` when the
  tail has been served. The profile-page sidebar takes the top 5; the
  dedicated `/hr/employees/:uuid/sessions` page walks the cursor.
  """
  def list_sessions_for_employee(company_id, employee_uuid, opts \\ [])
      when is_integer(company_id) and is_binary(employee_uuid) do
    sort = {:started_at, :desc}

    base =
      from(s in Backend.Production.WorkstationSession,
        where: s.company_id == ^company_id and ^employee_uuid in s.employee_uuids,
        preload: [
          :workstation,
          manufacturing_order_step: [:workstation_group, :manufacturing_order]
        ]
      )

    base = ListQueries.apply_sort(base, sort, [:started_at, :id], sort)

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  @doc """
  Every WorkstationSession across the whole CO's MO tree. Includes
  sessions on child MOs (sub-assemblies) — only the top-level MO
  carries a `customer_order_line_id`, so we walk `parent_mo_id` in
  a recursive CTE to gather every descendant before joining sessions.
  """
  def list_sessions_for_customer_order(company_id, co_id)
      when is_integer(company_id) and is_integer(co_id) do
    # Recursive CTE: seed with every MO whose CO line points at this
    # CO, then grow the set by following parent_mo_id downward until
    # every descendant is included.
    tree_query = """
      WITH RECURSIVE mo_tree AS (
        SELECT mo.id
        FROM manufacturing_orders mo
        JOIN customer_order_lines col ON col.id = mo.customer_order_line_id
        WHERE col.customer_order_id = $1 AND mo.company_id = $2
        UNION ALL
        SELECT child.id
        FROM manufacturing_orders child
        JOIN mo_tree parent ON parent.id = child.parent_mo_id
        WHERE child.company_id = $2
      )
      SELECT id FROM mo_tree
    """

    %{rows: id_rows} = Repo.query!(tree_query, [co_id, company_id])
    mo_ids = Enum.map(id_rows, &List.first/1)

    if mo_ids == [] do
      []
    else
      from(s in Backend.Production.WorkstationSession,
        join: step in assoc(s, :manufacturing_order_step),
        where:
          s.company_id == ^company_id and
            step.manufacturing_order_id in ^mo_ids,
        order_by: [desc: s.started_at, desc: s.id],
        preload: [
          :workstation,
          manufacturing_order_step: [:workstation_group, :manufacturing_order]
        ]
      )
      |> Repo.all()
    end
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
          # Hook the wizard's realtime channel — the Project Control
          # Board for the parent CO should refresh.
          Backend.OrderWizard.notify_via_mo(mo)

          Backend.Broadcasts.entity_changed(
            "manufacturing-order",
            mo.uuid,
            mo.company_id,
            "created"
          )

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
    root = walk_to_root(mo)
    collect_descendants([root], MapSet.new([root.id]))
  end

  # Walk up to the tree root. Previously each level fired its own
  # `Repo.get` — a k-level chain = k round-trips. A Postgres
  # recursive CTE finds the top ancestor in one query regardless of
  # depth. Depth cap of 25 protects against a data-corruption cycle
  # (A → B → A); if the actual chain is deeper we treat the deepest
  # ancestor we reached as the root, matching the old cycle-break
  # behaviour.
  defp walk_to_root(%ManufacturingOrder{parent_mo_id: nil} = mo) do
    Repo.preload(mo, :item)
  end

  defp walk_to_root(%ManufacturingOrder{} = mo) do
    root_id = find_root_ancestor_id(mo.id)

    case Repo.get(ManufacturingOrder, root_id) do
      nil -> Repo.preload(mo, :item)
      root -> Repo.preload(root, :item)
    end
  end

  defp find_root_ancestor_id(mo_id) do
    {:ok, result} =
      Repo.query(
        """
        WITH RECURSIVE ancestry AS (
          SELECT id, parent_mo_id, 0 AS depth
          FROM manufacturing_orders WHERE id = $1
          UNION ALL
          SELECT m.id, m.parent_mo_id, a.depth + 1
          FROM manufacturing_orders m
          JOIN ancestry a ON m.id = a.parent_mo_id
          WHERE a.depth < 25
        )
        SELECT id FROM ancestry ORDER BY depth DESC LIMIT 1
        """,
        [mo_id]
      )

    case result.rows do
      [[id]] -> id
      _ -> mo_id
    end
  end

  defp collect_descendants(frontier, _seen) when frontier == [], do: []

  defp collect_descendants(frontier, seen) do
    # `frontier` always arrives with `:item` preloaded — either from
    # `walk_to_root/1` (single MO) or from the `children` query below
    # (which uses `preload: :item`). No further per-row `Repo.preload`
    # is needed.
    ids = Enum.map(frontier, & &1.id)

    children =
      from(c in ManufacturingOrder,
        where: c.parent_mo_id in ^ids and c.id not in ^MapSet.to_list(seen),
        preload: :item
      )
      |> Repo.all()

    next_seen = Enum.reduce(children, seen, &MapSet.put(&2, &1.id))
    frontier ++ collect_descendants(children, next_seen)
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
    # When the planner dropped onto a different station row the new
    # WSG owns the working-hours calc — otherwise reuse the step's
    # current WSG so the walker doesn't union every group's hours.
    target_wsg_id = Keyword.get(opts, :workstation_group_id) || step.workstation_group_id
    resolved = resolved_windows_for_mo(mo, new_start_dt)
    intervals = intervals_for_step(resolved, target_wsg_id)
    duration = step.planned_duration_seconds || 0

    # Capacity-aware placement: feed in any other steps already
    # scheduled on this WSG so the walker auto-walks past full slots.
    # We exclude this step's own id so dragging itself doesn't
    # conflict with its old position.
    capacity = wsg_capacity(target_wsg_id)
    reservations = wsg_reservations(target_wsg_id, step.id, new_start_dt)

    {:ok,
     %{
       start_at: walked_start,
       finish_at: walked_finish,
       outside_hours_seconds: outside
     }} =
      ScheduleWalker.walk_forward(intervals, new_start_dt, duration,
        reservations: reservations,
        capacity: capacity
      )

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
    with {:ok, parsed} <- parse_segment_list(segments),
         :ok <- ensure_segments_fit_capacity(step, parsed) do
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
    # `acc ++ [entry]` in a hot reduce is O(len(acc)) per iteration
    # → O(n²) total. Prepend and reverse once at the end.
    result =
      Enum.reduce_while(list, {:ok, []}, fn seg, {:ok, acc} ->
        start_raw = Map.get(seg, "start_at") || Map.get(seg, :start_at)
        finish_raw = Map.get(seg, "finish_at") || Map.get(seg, :finish_at)

        with start_raw when is_binary(start_raw) <- start_raw,
             finish_raw when is_binary(finish_raw) <- finish_raw,
             {:ok, s, _} <- DateTime.from_iso8601(start_raw),
             {:ok, f, _} <- DateTime.from_iso8601(finish_raw) do
          {:cont,
           {:ok,
            [{DateTime.shift_zone!(s, "Etc/UTC"), DateTime.shift_zone!(f, "Etc/UTC")} | acc]}}
        else
          _ -> {:halt, {:error, :invalid_segments}}
        end
      end)

    case result do
      {:ok, reversed} -> {:ok, Enum.reverse(reversed)}
      other -> other
    end
  end

  # Hard-reject typed segments that would push concurrent ops on the
  # WSG above its capacity. Unlike `move_mo_step` (drag-to-reschedule)
  # which auto-walks past full slots, the click-to-edit dialog lets
  # the planner pin LITERAL times — silently moving them would
  # contradict the values they just typed. So we surface the conflict
  # and let them pick a different time themselves.
  #
  # Steps without a WSG (rare, legacy) skip the check; there's no
  # machine to overbook against.
  defp ensure_segments_fit_capacity(_step, []), do: :ok

  defp ensure_segments_fit_capacity(%ManufacturingOrderStep{} = step, parsed) do
    case step.workstation_group_id do
      nil ->
        :ok

      wsg_id when is_integer(wsg_id) ->
        capacity = wsg_capacity(wsg_id)
        earliest = parsed |> Enum.map(fn {s, _} -> s end) |> Enum.min(DateTime)
        existing = wsg_reservations(wsg_id, step.id, earliest)

        Enum.find_value(parsed, :ok, fn {ns, nf} ->
          if segment_overbooks?(ns, nf, existing, capacity) do
            {:error, :wsg_capacity_exceeded}
          else
            false
          end
        end)
    end
  end

  # Sweep-line: does the new segment [ns, nf) push concurrent existing
  # ops + 1 above capacity at any moment? True when the EXISTING peak
  # (clipped to [ns, nf)) is already at or above capacity, because
  # the new op would tip count to capacity + 1.
  defp segment_overbooks?(ns, nf, existing, capacity) do
    overlapping =
      Enum.filter(existing, fn {es, ef} ->
        DateTime.compare(ns, ef) == :lt and DateTime.compare(es, nf) == :lt
      end)

    events =
      Enum.flat_map(overlapping, fn {es, ef} ->
        s = if DateTime.compare(es, ns) == :lt, do: ns, else: es
        f = if DateTime.compare(ef, nf) == :gt, do: nf, else: ef
        [{s, +1}, {f, -1}]
      end)
      |> Enum.sort_by(fn {t, delta} -> {DateTime.to_unix(t, :microsecond), -delta} end)

    {peak, _count} =
      Enum.reduce(events, {0, 0}, fn {_t, delta}, {peak, count} ->
        new_count = count + delta
        {max(peak, new_count), new_count}
      end)

    peak >= capacity
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
      {:ok, step} ->
        Backend.Broadcasts.entity_changed(
          "manufacturing-order-step",
          step.uuid,
          step.company_id,
          "updated"
        )

        {:ok, reload_mo_step(step)}

      err ->
        err
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

          Backend.Broadcasts.entity_changed(
            "manufacturing-order",
            updated.uuid,
            updated.company_id,
            "updated"
          )

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
        with :ok <- ensure_children_complete(mo, to),
             :ok <- ensure_preflight_complete_for_transition(mo, to) do
          transactional_transition(actor, mo, to)
          |> tap(fn
            {:ok, updated} -> Backend.OrderWizard.notify_via_mo(updated)
            _ -> :ok
          end)
        end
    end
  end

  # Pre-production receipt gate. `scheduled → in_progress` is only
  # legal once the production operator has signed off every raw
  # material / packaging booking (`received_at IS NOT NULL`). Mirrors
  # the existing children-complete gate above — both block the same
  # transition for compliance reasons, neither touches cancel/amend.
  defp ensure_preflight_complete_for_transition(%ManufacturingOrder{} = mo, "in_progress") do
    if mo_preflight_complete?(mo), do: :ok, else: {:error, :preflight_incomplete}
  end

  defp ensure_preflight_complete_for_transition(_mo, _to), do: :ok

  # Wraps the transition so cancel-side effects (releasing bookings,
  # cascade-cancelling open children) are atomic with the status flip
  # itself. A crash mid-way rolls everything back so we never leave
  # an MO half-cancelled.
  defp transactional_transition(%User{} = actor, %ManufacturingOrder{} = mo, to) do
    Repo.transaction(fn ->
      extra_attrs = transition_extra_attrs(mo, to)

      case do_transition(actor, mo, to, extra_attrs) do
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

  # Extra attrs the generic transition path needs to stamp alongside
  # status — currently `actual_start` on the scheduled → in_progress
  # hop. Keeps both the desktop "Start production" button (which
  # goes through transition_mo) and the run page's Start (which goes
  # through start_mo_production) writing the same timestamp so the
  # Finish dialog's prefill is consistent.
  defp transition_extra_attrs(%ManufacturingOrder{actual_start: nil}, "in_progress"),
    do: %{"actual_start" => now()}

  defp transition_extra_attrs(_, _), do: %{}

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

        Backend.Broadcasts.entity_changed(
          "manufacturing-order",
          updated.uuid,
          updated.company_id,
          to
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
    with :ok <- ensure_status_in(mo, ["draft"]),
         :ok <- ensure_planning_complete(mo) do
      # Per-MO signature — does not cascade to children. Planner
      # prepares each MO in the tree independently (typically leaves
      # first so sub-MOs are ready by the time the parent rolls
      # forward).
      #
      # Prepare is "I've decided how to source this", not "everything
      # is sourced." Allowed when every line is either fully booked
      # OR the MO has had Request purchases fired — at that point
      # the planner has handed shortfalls to procurement, which is
      # all they can do. The release-time gate
      # (ensure_all_lines_have_real_bookings) keeps the floor safe
      # by refusing pickup until actual lots exist.
      #
      # purchasing_requested_at is preserved through the transition
      # so the wizard can keep showing "Awaiting delivery" until the
      # POs land and the placeholders upgrade.
      do_transition(actor, mo, "prepared", %{
        "prepared_by_id" => actor.id,
        "prepared_at" => now(),
        "rejection_reason" => nil
      })
    end
  end

  # Prepare-time gate. Passes if the MO is fully covered by bookings
  # OR if the planner has already engaged procurement for the
  # shortfall. Either way, the planning decision is made.
  defp ensure_planning_complete(%ManufacturingOrder{} = mo) do
    case ensure_all_lines_fully_booked(mo) do
      :ok ->
        :ok

      {:error, :lines_under_booked, _list} = err ->
        if mo.purchasing_requested_at, do: :ok, else: err
    end
  end

  @doc """
  Preparer's amend — returns the tree to draft before the scientist
  has signed. Clears the preparer signature so the next prep cycle
  records a fresh timestamp.
  """
  def unprepare_mo(%User{} = actor, %ManufacturingOrder{} = mo) do
    with :ok <- ensure_status_in(mo, ["prepared"]) do
      do_transition(actor, mo, "draft", %{
        "prepared_by_id" => nil,
        "prepared_at" => nil
      })
    end
  end

  @doc """
  Scientist's amend — bounce an `approved` (but not yet released)
  MO back to `draft`, clearing both signatures so the team can edit
  bookings + re-sign. Refuses on MOs that are already released to
  the warehouse — those go through `unrelease_mo_from_warehouse`
  (which itself uses this regression internally when `needs_replan`
  is set).
  """
  def unapprove_mo(%User{} = actor, %ManufacturingOrder{} = mo) do
    with :ok <- ensure_status_in(mo, ["approved"]),
         :ok <- ensure_not_released(mo) do
      do_transition(actor, mo, "draft", %{
        "approved_by_id" => nil,
        "approved_at" => nil,
        "prepared_by_id" => nil,
        "prepared_at" => nil
      })
    end
  end

  defp ensure_not_released(%ManufacturingOrder{released_to_warehouse_at: nil}), do: :ok
  defp ensure_not_released(_), do: {:error, :already_released}

  @doc """
  Planner action — flag the MO as having unbooked items that need
  procurement. From this point:

    * Existing bookings on this MO are locked (no add/edit/delete)
    * The shortages page surfaces this MO's gaps to procurement
    * Status badge reads "Purchasing" instead of "Draft"

  Only valid on a draft MO with at least one under-booked line.
  Cleared automatically when the planner calls `prepare_mo/2`.
  """
  def request_purchases(%User{} = actor, %ManufacturingOrder{} = mo) do
    # Per-MO action (no root requirement). Each MO in the tree has
    # its own BOM that procurement may need to fulfil — flagging one
    # MO doesn't drag the rest along.
    with :ok <- ensure_status_in(mo, ["draft"]),
         :ok <- ensure_under_booked(mo) do
      mo
      |> ManufacturingOrder.transition_changeset(%{
        "purchasing_requested_at" => now(),
        "purchasing_requested_by_id" => actor.id,
        "updated_by_id" => actor.id
      })
      |> Repo.update()
      |> tap(fn
        {:ok, updated} ->
          Backend.Broadcasts.entity_changed(
            "manufacturing-order",
            updated.uuid,
            updated.company_id,
            "purchases_requested"
          )

        _ ->
          :ok
      end)
    end
  end

  @doc """
  Planner action — undo the procurement request while still in draft.
  Removes the lock + drops the MO from the shortages page.
  """
  def cancel_purchase_request(%User{} = actor, %ManufacturingOrder{} = mo) do
    with :ok <- ensure_status_in(mo, ["draft"]) do
      mo
      |> ManufacturingOrder.transition_changeset(%{
        "purchasing_requested_at" => nil,
        "purchasing_requested_by_id" => nil,
        "updated_by_id" => actor.id
      })
      |> Repo.update()
      |> tap(fn
        {:ok, updated} ->
          Backend.Broadcasts.entity_changed(
            "manufacturing-order",
            updated.uuid,
            updated.company_id,
            "purchase_request_cancelled"
          )

        _ ->
          :ok
      end)
    end
  end

  defp ensure_under_booked(%ManufacturingOrder{} = mo) do
    case ensure_all_lines_fully_booked(mo) do
      {:error, :lines_under_booked, _} -> :ok
      :ok -> {:error, :nothing_to_request}
    end
  end

  defp ensure_bookings_not_locked(%ManufacturingOrder{purchasing_requested_at: nil}), do: :ok

  defp ensure_bookings_not_locked(_),
    do: {:error, :bookings_locked_for_purchasing}

  @doc """
  2nd signature — scientist approves the prepared root + every
  descendant. Enforces the 4-eyes rule (approver != preparer).
  """
  def approve_mo(%User{} = actor, %ManufacturingOrder{} = mo) do
    with :ok <- ensure_status_in(mo, ["prepared"]),
         :ok <- ensure_different_signer(mo, actor),
         # Approval gate uses the SAME coverage rule as prepare —
         # `ensure_planning_complete`. An ingredient counts as
         # covered when it has real bookings (placeholder or real
         # lot-backed) OR when the planner has already handed the
         # shortfall to procurement (`purchasing_requested_at` set).
         # In a shop where the planner and the purchases team are
         # different people, blocking approve at this stage would
         # trap the planner on an MO whose next real move is on
         # someone else's queue. The RELEASE gate is the load-bearing
         # physical gate — no MO reaches the warehouse without real
         # `available` lots.
         :ok <- ensure_planning_complete(mo) do
      # Per-MO approval (no cascade). Each MO in the tree is signed
      # individually — leaves first so children are ready by the time
      # the planner approves their parents. The user picks the order;
      # the only enforced gate is 4-eyes (approver != preparer).
      # Re-approval closes a replan cycle — once the planner has
      # walked the MO back through prepare + approve, the
      # `needs_replan` flag clears automatically.
      do_transition(actor, mo, "approved", %{
        "approved_by_id" => actor.id,
        "approved_at" => now(),
        "needs_replan" => false,
        "needs_replan_reason" => nil,
        "needs_replan_at" => nil
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
    root = walk_to_root(mo)

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

        Backend.Broadcasts.entity_changed(
          "manufacturing-order",
          mo.uuid,
          mo.company_id,
          "deleted"
        )

        {:ok, deleted}

      err ->
        err
    end
  end

  defp reload_manufacturing_order(%ManufacturingOrder{} = mo) do
    # Every MO action (start / finish / release / mark-picked / etc.)
    # returns via this reload so the FE gets a full MO struct back.
    # Preloads MUST include `item: :stock_uom` — without it the payload
    # serialises `item.stock_uom` as nil and the run-page's "Produced
    # quantity (kg)" label falls back to (ea) after any action fires.
    # Chain preloads (parent_mo / children / links) carry the same
    # item: :stock_uom pattern so the MO chain roadmap gets the right
    # UoM everywhere it's rendered.
    Repo.preload(
      mo,
      [
        [item: :stock_uom],
        :warehouse,
        :assigned_to,
        :approved_by,
        :prepared_by,
        :created_by,
        :updated_by,
        :released_to_warehouse_by,
        :pickup_started_by,
        :pickup_completed_by,
        :purchasing_requested_by,
        :produced_lot,
        production_cell: [storage_location: [floor: [:warehouse]]],
        steps: [:workstation_group, :routing_step, worker_assignments: :user],
        bom: [lines: [:part, :unit_of_measurement]],
        routing: [steps: [:workstation_group, worker_assignments: :user]],
        parent_mo: [item: :stock_uom],
        children: [item: :stock_uom],
        consumer_links: [consumer_mo: [item: :stock_uom]],
        supplier_links: [batch_mo: [item: :stock_uom]]
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
      production_cell_id: mo.production_cell_id,
      actual_start: mo.actual_start,
      actual_finish: mo.actual_finish,
      quantity_produced: mo.quantity_produced,
      produced_lot_id: mo.produced_lot_id
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

    with :ok <- ensure_bookings_not_locked(mo),
         :ok <- ensure_lot_belongs_to_company(actor, attrs["stock_lot_id"]),
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
  Create a placeholder booking — a reservation against an open PO
  line for which no `stock_lot` exists yet (goods haven't landed).
  Mutually exclusive with the lot-side `create_booking/3` —
  placeholders carry `purchase_order_line_id` instead of
  `stock_lot_id`.

  Capacity rule: sum of all open placeholder bookings against the
  same PO line ≤ remaining qty on the line (qty_ordered - qty_received).
  This stops procurement from over-promising an inbound delivery.

  On QC pass of the lot produced by this PO line's receipt, the
  placeholder auto-upgrades — see
  `upgrade_placeholder_bookings_for_lot/2`.

  Error tuples: `:bookings_locked_for_purchasing | :po_line_not_found
  | :po_line_already_received | :item_mismatch | :over_reservation |
  :quantity_required | %Ecto.Changeset{}`.
  """
  def create_placeholder_booking(%User{} = actor, %ManufacturingOrder{} = mo, attrs) do
    attrs = stringify_keys(attrs)

    # Placeholders are how procurement FULFILS the purchasing request,
    # so we deliberately skip `ensure_bookings_not_locked/1` (which
    # only guards against the planner editing the same MO while a
    # request is open). The lock keeps stock_lot bookings stable
    # while procurement is sourcing; reserving against an in-flight
    # PO is exactly what unblocks the request.
    with {:ok, po_line} <-
           fetch_po_line_for_company(actor.company_id, attrs["purchase_order_line_id"]),
         :ok <- ensure_po_line_open(po_line),
         :ok <- ensure_item_matches_po_line(attrs["item_id"], po_line),
         {:ok, qty} <-
           (case parse_positive_decimal(attrs["quantity"]) do
              {:ok, d} -> {:ok, d}
              :error -> {:error, :quantity_required}
            end),
         :ok <- ensure_po_line_capacity(po_line, qty, nil) do
      booking_attrs = %{
        "company_id" => mo.company_id,
        "manufacturing_order_id" => mo.id,
        "item_id" => po_line.item_id,
        "purchase_order_line_id" => po_line.id,
        "quantity" => qty,
        "status" => "requested",
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id,
        "note" => attrs["note"]
      }

      %ManufacturingOrderBooking{}
      |> ManufacturingOrderBooking.changeset(booking_attrs)
      |> Repo.insert()
      |> case do
        {:ok, booking} ->
          Audit.record_created(
            actor,
            "manufacturing_order_booking",
            booking,
            booking_snapshot(booking)
          )

          # Placeholder bookings are procurement FULFILLING a request
          # the planner already signed off on (the MO was approved with
          # purchasing_requested_at set under the new Prepare gate, or
          # the planner manually booked from an open PO). Either way
          # they're expected coverage, not a structural edit — so we
          # skip demote_root_if_signed here. The cascade still fires
          # for real stock_lot bookings (see create_booking above)
          # because those DO change the run plan.
          {:ok, reload_booking(booking)}

        err ->
          err
      end
    end
  end

  defp fetch_po_line_for_company(company_id, uuid_or_id) do
    cond do
      is_nil(uuid_or_id) ->
        {:error, :po_line_not_found}

      is_binary(uuid_or_id) and byte_size(uuid_or_id) >= 32 ->
        case Repo.get_by(Backend.Purchasing.PurchaseOrderLine,
               uuid: uuid_or_id,
               company_id: company_id
             ) do
          nil -> {:error, :po_line_not_found}
          line -> {:ok, Repo.preload(line, :purchase_order)}
        end

      true ->
        id = if is_binary(uuid_or_id), do: String.to_integer(uuid_or_id), else: uuid_or_id

        case Repo.get(Backend.Purchasing.PurchaseOrderLine, id) do
          nil ->
            {:error, :po_line_not_found}

          line ->
            if line.company_id == company_id do
              {:ok, Repo.preload(line, :purchase_order)}
            else
              {:error, :po_line_not_found}
            end
        end
    end
  end

  defp ensure_po_line_open(%Backend.Purchasing.PurchaseOrderLine{} = line) do
    cond do
      is_nil(line.purchase_order) ->
        {:error, :po_line_not_found}

      line.purchase_order.status == "cancelled" ->
        {:error, :po_line_already_received}

      true ->
        remaining = Decimal.sub(line.qty_ordered || Decimal.new(0), line.qty_received || Decimal.new(0))

        if Decimal.compare(remaining, Decimal.new(0)) == :gt do
          :ok
        else
          {:error, :po_line_already_received}
        end
    end
  end

  defp ensure_item_matches_po_line(nil, _line), do: :ok

  defp ensure_item_matches_po_line(item_id, %Backend.Purchasing.PurchaseOrderLine{item_id: po_item_id}) do
    case coerce_int(item_id) do
      ^po_item_id -> :ok
      _ -> {:error, :item_mismatch}
    end
  end

  defp ensure_po_line_capacity(
         %Backend.Purchasing.PurchaseOrderLine{} = line,
         %Decimal{} = qty,
         exclude_booking_id
       ) do
    remaining = Decimal.sub(line.qty_ordered || Decimal.new(0), line.qty_received || Decimal.new(0))

    booked_subquery =
      from(b in ManufacturingOrderBooking,
        where:
          b.purchase_order_line_id == ^line.id and
            b.status == "requested"
      )

    booked_subquery =
      if exclude_booking_id do
        from(b in booked_subquery, where: b.id != ^exclude_booking_id)
      else
        booked_subquery
      end

    already_reserved =
      booked_subquery
      |> Repo.aggregate(:sum, :quantity)
      |> case do
        nil -> Decimal.new(0)
        %Decimal{} = d -> d
      end

    free = Decimal.sub(remaining, already_reserved)

    if Decimal.compare(qty, free) in [:eq, :lt] do
      :ok
    else
      {:error, {:over_reservation, Decimal.to_string(free)}}
    end
  end

  # parse_positive_decimal/1 already exists later in this module
  # (handles %Decimal{}, integer, float, binary inputs). The
  # placeholder-booking flow reuses it.
  defp coerce_int(n) when is_integer(n), do: n
  defp coerce_int(s) when is_binary(s), do: String.to_integer(s)
  defp coerce_int(_), do: nil

  @doc """
  Auto-upgrade placeholder bookings → real bookings for a freshly
  available lot. Called from the Goods-In Inspection approver
  sign-off after the lifecycle event flips the lot to `available`.

  Walks placeholder bookings against the same PO line (the one this
  lot was received against) FIFO by inserted_at and applies the
  lot's available qty until either the lot is exhausted or every
  placeholder has been upgraded.

  Split behaviour: if a placeholder asks for more than the lot can
  provide, the placeholder is shrunk to the lot's qty and a new
  remainder-placeholder is left on the same PO line for the next
  receipt to upgrade.

  Returns `{:ok, %{upgraded: n, lot_qty_used: dec}}`. Idempotent —
  re-running on the same lot is a no-op once every placeholder
  against that PO line is satisfied.
  """
  def upgrade_placeholder_bookings_for_lot(%User{} = actor, %StockLot{} = lot) do
    case lot_po_line_id(lot) do
      nil ->
        {:ok, %{upgraded: 0, lot_qty_used: Decimal.new(0)}}

      po_line_id ->
        # Capture which MOs had placeholders against this PO line
        # BEFORE the upgrade so we can re-check their procurement
        # state after the upgrade lands. The upgrade flips
        # purchase_order_line_id → null so we can't query for them
        # afterwards.
        affected_mo_ids =
          from(b in ManufacturingOrderBooking,
            where:
              b.purchase_order_line_id == ^po_line_id and
                is_nil(b.stock_lot_id) and
                b.status == "requested",
            select: b.manufacturing_order_id,
            distinct: true
          )
          |> Repo.all()

        with {:ok, summary} <- do_upgrade_for_po_line(actor, lot, po_line_id) do
          # Auto-clear `purchasing_requested_at` on any affected MO
          # that no longer has open placeholder bookings. The
          # planner doesn't have to click "Cancel purchase request"
          # — once procurement has delivered everything they
          # promised, the MO comes off the procurement queue
          # automatically.
          Enum.each(affected_mo_ids, &maybe_clear_purchasing_requested(actor, &1))

          {:ok, summary}
        end
    end
  end

  # If the MO has no open placeholder bookings left (everything
  # procurement promised has landed + been QC-passed), clear the
  # `purchasing_requested_at` flag so the MO drops off the
  # procurement queue and the FE no longer shows the "Purchasing"
  # chip. Real lot-backed bookings are unaffected — only the
  # "Expecting" state ends.
  defp maybe_clear_purchasing_requested(%User{} = actor, mo_id) do
    mo = Repo.get(ManufacturingOrder, mo_id)

    cond do
      is_nil(mo) ->
        :ok

      is_nil(mo.purchasing_requested_at) ->
        :ok

      true ->
        outstanding =
          Repo.aggregate(
            from(b in ManufacturingOrderBooking,
              where:
                b.manufacturing_order_id == ^mo.id and
                  not is_nil(b.purchase_order_line_id) and
                  is_nil(b.stock_lot_id) and
                  b.status == "requested"
            ),
            :count,
            :id
          )

        if outstanding == 0 do
          mo
          |> ManufacturingOrder.transition_changeset(%{
            "purchasing_requested_at" => nil,
            "purchasing_requested_by_id" => nil,
            "updated_by_id" => actor.id
          })
          |> Repo.update()
        else
          :ok
        end
    end
  end

  # Look up the PO line a lot was received against. Two pathways:
  #
  #   1. The lot has a `goods_in_inspection_id` set (PO-receive flow);
  #      walk inspection items → purchase_order_line_id → match against
  #      the lot's item_id (one inspection can cover multiple lines).
  #
  #   2. The lot's source_kind is "purchase_order" with a source_ref
  #      pointing at a PO code; resolve to a PO and find a line for
  #      the same item.
  defp lot_po_line_id(%StockLot{goods_in_inspection_id: gid, item_id: item_id})
       when is_integer(gid) do
    case Repo.get(Backend.GoodsIn.Inspection, gid) do
      nil ->
        nil

      inspection ->
        items =
          inspection
          |> Repo.preload(items: :purchase_order_line)
          |> Map.get(:items, [])

        items
        |> Enum.find(fn it ->
          case it.purchase_order_line do
            nil -> false
            line -> line.item_id == item_id
          end
        end)
        |> case do
          nil -> nil
          %{purchase_order_line: line} -> line.id
        end
    end
  end

  defp lot_po_line_id(_), do: nil

  defp do_upgrade_for_po_line(%User{} = actor, %StockLot{} = lot, po_line_id) do
    placeholders =
      from(b in ManufacturingOrderBooking,
        where:
          b.purchase_order_line_id == ^po_line_id and
            is_nil(b.stock_lot_id) and
            b.status == "requested",
        order_by: [asc: b.inserted_at, asc: b.id]
      )
      |> Repo.all()

    lot_free = lot_free_qty(lot)

    {result, _remaining} =
      Enum.reduce(placeholders, {{:ok, %{upgraded: 0, lot_qty_used: Decimal.new(0)}}, lot_free}, fn
        _placeholder, {{:error, _} = err, remaining} ->
          {err, remaining}

        placeholder,
        {{:ok, %{upgraded: count, lot_qty_used: used}}, remaining} ->
          if Decimal.compare(remaining, Decimal.new(0)) != :gt do
            {{:ok, %{upgraded: count, lot_qty_used: used}}, remaining}
          else
            qty = placeholder.quantity

            cond do
              Decimal.compare(qty, remaining) in [:eq, :lt] ->
                # Lot can fully cover this placeholder — flip
                # purchase_order_line_id → stock_lot_id atomically.
                case upgrade_placeholder(actor, placeholder, lot, qty) do
                  {:ok, _} ->
                    {
                      {:ok,
                       %{
                         upgraded: count + 1,
                         lot_qty_used: Decimal.add(used, qty)
                       }},
                      Decimal.sub(remaining, qty)
                    }

                  {:error, reason} ->
                    {{:error, reason}, remaining}
                end

              true ->
                # Partial: shrink placeholder + insert remainder.
                case split_and_upgrade(actor, placeholder, lot, remaining) do
                  {:ok, _} ->
                    {
                      {:ok,
                       %{
                         upgraded: count + 1,
                         lot_qty_used: Decimal.add(used, remaining)
                       }},
                      Decimal.new(0)
                    }

                  {:error, reason} ->
                    {{:error, reason}, remaining}
                end
            end
          end
      end)

    result
  end

  # Live free qty on a lot — qty_received minus what's already booked
  # via real bookings on it. Placeholders don't count (they're against
  # the PO line, not the lot).
  defp lot_free_qty(%StockLot{} = lot) do
    on_hand = lot.qty_received || Decimal.new(0)

    booked =
      from(b in ManufacturingOrderBooking,
        where:
          b.stock_lot_id == ^lot.id and
            b.status == "requested"
      )
      |> Repo.aggregate(:sum, :quantity)
      |> case do
        nil -> Decimal.new(0)
        %Decimal{} = d -> d
      end

    Decimal.sub(on_hand, booked)
  end

  defp upgrade_placeholder(%User{} = actor, %ManufacturingOrderBooking{} = b, %StockLot{} = lot, _qty) do
    before = booking_snapshot(b)

    attrs = %{
      "stock_lot_id" => lot.id,
      "purchase_order_line_id" => nil,
      "storage_cell_id" => primary_storage_cell_id(lot),
      "updated_by_id" => actor.id
    }

    b
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

        {:ok, updated}

      err ->
        err
    end
  end

  defp split_and_upgrade(%User{} = actor, %ManufacturingOrderBooking{} = b, %StockLot{} = lot, lot_qty) do
    remainder = Decimal.sub(b.quantity, lot_qty)
    before = booking_snapshot(b)

    Repo.transaction(fn ->
      # Shrink the placeholder to the lot qty + upgrade to real lot booking.
      shrunk_attrs = %{
        "stock_lot_id" => lot.id,
        "purchase_order_line_id" => nil,
        "storage_cell_id" => primary_storage_cell_id(lot),
        "quantity" => lot_qty,
        "updated_by_id" => actor.id
      }

      with {:ok, upgraded} <-
             b
             |> ManufacturingOrderBooking.changeset(shrunk_attrs)
             |> Repo.update(),
           {:ok, _remainder} <-
             %ManufacturingOrderBooking{}
             |> ManufacturingOrderBooking.changeset(%{
               "company_id" => b.company_id,
               "manufacturing_order_id" => b.manufacturing_order_id,
               "item_id" => b.item_id,
               "purchase_order_line_id" => b.purchase_order_line_id,
               "quantity" => remainder,
               "status" => "requested",
               "created_by_id" => actor.id,
               "updated_by_id" => actor.id
             })
             |> Repo.insert() do
        Audit.record_updated(
          actor,
          "manufacturing_order_booking",
          upgraded,
          before,
          booking_snapshot(upgraded)
        )

        upgraded
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  @doc """
  Reserve a PO line for a specific list of MOs at caller-supplied
  quantities. Used when procurement picks reservations manually on
  the PO form, or when the wizard / shortages page deep-links a PO
  that should land entirely on a specific CO's MOs.

  `reservations` shape: `[%{"mo_uuid" => "...", "qty" => "12.5"}, ...]`
  (string keys for direct passthrough from the controller). Total
  qty across reservations is clamped to the line's remaining qty —
  any overflow is silently dropped so a typo can't double-book the
  line. Failures on individual MOs are skipped, not raised, so a
  bad row doesn't lose every reservation.

  Returns `{:ok, %{placed: count, qty_used: dec, skipped: count}}`.
  """
  def reserve_po_line_for_mos(%User{} = actor, %Backend.Purchasing.PurchaseOrderLine{} = line, reservations)
      when is_list(reservations) do
    remaining = Decimal.sub(line.qty_ordered || Decimal.new(0), line.qty_received || Decimal.new(0))

    Enum.reduce(reservations, %{placed: 0, qty_used: Decimal.new(0), skipped: 0}, fn raw, acc ->
      mo_uuid = Map.get(raw, "mo_uuid") || Map.get(raw, :mo_uuid)

      raw_qty =
        Map.get(raw, "qty") || Map.get(raw, :qty) ||
          Map.get(raw, "quantity") || Map.get(raw, :quantity)

      with {:ok, qty} <- parse_reservation_qty(raw_qty),
           true <- Decimal.compare(qty, Decimal.new(0)) == :gt,
           %ManufacturingOrder{} = mo <- fetch_company_mo(actor.company_id, mo_uuid) do
        # Clamp to whatever's left on the line so the caller can't
        # over-reserve via the picker.
        line_left = Decimal.sub(remaining, acc.qty_used)
        slice = if Decimal.compare(qty, line_left) == :gt, do: line_left, else: qty

        if Decimal.compare(slice, Decimal.new(0)) != :gt do
          %{acc | skipped: acc.skipped + 1}
        else
          case create_placeholder_booking(actor, mo, %{
                 "purchase_order_line_id" => line.id,
                 "item_id" => line.item_id,
                 "quantity" => Decimal.to_string(slice)
               }) do
            {:ok, _} ->
              %{acc | placed: acc.placed + 1, qty_used: Decimal.add(acc.qty_used, slice)}

            {:error, _} ->
              %{acc | skipped: acc.skipped + 1}
          end
        end
      else
        _ -> %{acc | skipped: acc.skipped + 1}
      end
    end)
    |> then(&{:ok, &1})
  end

  defp parse_reservation_qty(nil), do: :error
  defp parse_reservation_qty(%Decimal{} = d), do: {:ok, d}

  defp parse_reservation_qty(value) when is_binary(value) do
    case Decimal.parse(value) do
      {d, _} -> {:ok, d}
      :error -> :error
    end
  end

  defp parse_reservation_qty(value) when is_number(value) do
    {:ok, Decimal.new(to_string(value))}
  end

  defp parse_reservation_qty(_), do: :error

  defp fetch_company_mo(_company_id, nil), do: nil
  defp fetch_company_mo(_company_id, ""), do: nil

  defp fetch_company_mo(company_id, uuid) when is_binary(uuid) do
    Repo.one(
      from mo in ManufacturingOrder,
        where: mo.uuid == ^uuid and mo.company_id == ^company_id,
        select: mo
    )
  end

  @doc """
  Allocate a fresh PO line's qty across MOs that have already raised
  a procurement request for the same item. FIFO by the earliest
  planned_start (then by MO id).

  Each interested MO gets ONE placeholder booking for
  `min(remaining_line_qty, mo_shortage)`. Unmet shortage on the MO
  rolls over to the next PO that procurement creates.

  Best-effort: errors creating individual placeholders are swallowed
  (logged via audit) so a partial allocation can still proceed —
  the planner sees what landed on their parts table and can
  manually book any gap.

  Returns `{:ok, %{placed: count, qty_used: dec}}`.
  """
  def allocate_po_line_to_requested_mos(%User{} = actor, %Backend.Purchasing.PurchaseOrderLine{} = line) do
    candidates = find_candidate_mos_for_item(actor.company_id, line.item_id)
    remaining = Decimal.sub(line.qty_ordered || Decimal.new(0), line.qty_received || Decimal.new(0))

    Enum.reduce_while(candidates, {:ok, %{placed: 0, qty_used: Decimal.new(0)}, remaining}, fn
      {_mo, _gap}, {:ok, summary, rem} when rem == %Decimal{coef: 0, exp: 0, sign: 1} ->
        {:halt, {:ok, summary, rem}}

      {mo, gap}, {:ok, %{placed: placed, qty_used: used}, rem} ->
        slice =
          if Decimal.compare(gap, rem) == :gt do
            rem
          else
            gap
          end

        if Decimal.compare(slice, Decimal.new(0)) != :gt do
          {:cont, {:ok, %{placed: placed, qty_used: used}, rem}}
        else
          case create_placeholder_booking(actor, mo, %{
                 "purchase_order_line_id" => line.id,
                 "item_id" => line.item_id,
                 "quantity" => Decimal.to_string(slice)
               }) do
            {:ok, _booking} ->
              {:cont,
               {:ok,
                %{placed: placed + 1, qty_used: Decimal.add(used, slice)},
                Decimal.sub(rem, slice)}}

            {:error, _reason} ->
              # Best-effort — keep going, planner can clean up.
              {:cont, {:ok, %{placed: placed, qty_used: used}, rem}}
          end
        end
    end)
    |> case do
      {:ok, summary, _rem} -> {:ok, summary}
      {:halt, {:ok, summary, _rem}} -> {:ok, summary}
      other -> other
    end
  end

  # Open MOs that are short on the given item AND have been flagged
  # for procurement (`purchasing_requested_at` set). FIFO by earliest
  # planned_start, then MO id (deterministic tiebreaker).
  defp find_candidate_mos_for_item(company_id, item_id) do
    from(mo in ManufacturingOrder,
      where:
        mo.company_id == ^company_id and
          mo.status in ["draft", "approved", "scheduled", "in_progress"] and
          not is_nil(mo.purchasing_requested_at),
      preload: [:bookings, bom: [lines: :part], steps: []]
    )
    |> Repo.all()
    |> Enum.flat_map(fn mo ->
      gap = mo_item_shortage(mo, item_id)

      if Decimal.compare(gap, Decimal.new(0)) == :gt do
        [{mo, gap, earliest_step_start(mo)}]
      else
        []
      end
    end)
    |> Enum.sort_by(fn {_mo, _gap, start} -> start || ~U[2099-01-01 00:00:00Z] end, DateTime)
    |> Enum.map(fn {mo, gap, _start} -> {mo, gap} end)
  end

  # Per-item shortage on a single MO: required_qty - booked_qty (incl.
  # any existing placeholders). Mirrors the shortages calc but at the
  # per-MO grain.
  defp mo_item_shortage(%ManufacturingOrder{} = mo, item_id) do
    line =
      case mo.bom do
        %BOM{lines: lines} when is_list(lines) ->
          Enum.find(lines, fn l -> l.part_id == item_id end)

        _ ->
          nil
      end

    required =
      case line do
        nil ->
          Decimal.new(0)

        %BOMLine{is_fixed: true, qty: q} ->
          q || Decimal.new(0)

        %BOMLine{qty: q} ->
          Decimal.mult(q || Decimal.new(0), mo.quantity || Decimal.new(0))
      end

    booked =
      mo.bookings
      |> Enum.filter(fn b -> b.item_id == item_id and b.status == "requested" end)
      |> Enum.reduce(Decimal.new(0), fn b, acc -> Decimal.add(acc, b.quantity || Decimal.new(0)) end)

    Decimal.sub(required, booked)
  end

  defp primary_storage_cell_id(%StockLot{} = lot) do
    case lot do
      %StockLot{placements: list} when is_list(list) ->
        Enum.find_value(list, fn p ->
          if Decimal.compare(p.qty || Decimal.new(0), Decimal.new(0)) == :gt do
            p.storage_cell_id
          end
        end)

      _ ->
        Repo.one(
          from(p in Backend.Stock.Placement,
            where: p.stock_lot_id == ^lot.id and p.qty > 0,
            select: p.storage_cell_id,
            limit: 1
          )
        )
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

    with :ok <- ensure_booking_mo_not_locked(booking),
         :ok <- ensure_capacity(booking.stock_lot_id, new_qty, booking.id) do
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

    with :ok <- ensure_booking_mo_not_locked(booking),
         :ok <- ensure_booking_not_picked(booking) do
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
  end

  # A picked booking has already had its qty moved to the production-
  # feed cell via `transfer_booking_to_production` (which emitted a
  # Movement). Deleting the booking row would orphan that placement
  # — the lot would sit at the feed cell with no upstream reference
  # and no audit row explaining the disappearance of the booking.
  # The operator should abort the pickup first, which unwinds
  # picked_at on every booking and lets `delete_booking` proceed
  # cleanly.
  defp ensure_booking_not_picked(%ManufacturingOrderBooking{picked_at: nil}), do: :ok

  defp ensure_booking_not_picked(%ManufacturingOrderBooking{}),
    do: {:error, :booking_already_picked}

  defp ensure_booking_mo_not_locked(%ManufacturingOrderBooking{manufacturing_order_id: mo_id}) do
    case Repo.get(ManufacturingOrder, mo_id) do
      %ManufacturingOrder{} = mo -> ensure_bookings_not_locked(mo)
      _ -> :ok
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
      [
        :item,
        :storage_cell,
        :created_by,
        :updated_by,
        stock_lot: [placements: :storage_cell],
        purchase_order_line: :purchase_order
      ],
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
      picked_by_id: b.picked_by_id,
      received_at: b.received_at,
      received_by_id: b.received_by_id,
      received_qty: b.received_qty,
      received_notes: b.received_notes
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
    cond do
      delta_seconds == 0 ->
        {:ok, reload_manufacturing_order(root)}

      true ->
        # Compute the new anchor — current chain earliest + delta —
        # then re-run the working-hour-aware chain walker from there.
        # A pure +delta shift bypasses the walker entirely and leaves
        # steps inside closed hours / on holidays / outside the step's
        # WSG window. The drag still feels like "move by delta" because
        # the anchor moves by exactly delta; only the per-step landing
        # changes when the naive position would have crossed a close.
        case chain_earliest_start(root) do
          nil ->
            # No steps scheduled yet — nothing to shift.
            {:ok, reload_manufacturing_order(root)}

          %DateTime{} = current_earliest ->
            new_earliest = DateTime.add(current_earliest, delta_seconds, :second)

            if DateTime.compare(new_earliest, now()) == :lt do
              {:error, :past_time}
            else
              case do_schedule_mo_chain(actor, root, new_earliest) do
                {:ok, _mo, _meta} -> {:ok, reload_manufacturing_order(root)}
                {:error, reason} -> {:error, reason}
              end
            end
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
    cond do
      delta_seconds == 0 ->
        {:ok, reload_manufacturing_order(mo)}

      true ->
        # Re-run the working-hour walker from the delta-shifted first
        # step start so the MO's steps stay inside open windows of
        # their own WSG instead of landing inside closed hours. The
        # anchor moves by exactly delta — only the per-step landing
        # changes when the naive position would have crossed a close.
        case mo_first_step_start(mo) do
          nil ->
            # No scheduled steps yet — nothing to shift.
            {:ok, reload_manufacturing_order(mo)}

          %DateTime{} = current_first ->
            new_first = DateTime.add(current_first, delta_seconds, :second)

            if DateTime.compare(new_first, now()) == :lt do
              {:error, :past_time}
            else
              Repo.transaction(fn ->
                case do_schedule_one_forward(actor, mo, new_first) do
                  {:ok, _mo, _off, _first_start, _last_finish} ->
                    reload_manufacturing_order(mo)

                  {:error, reason} ->
                    Repo.rollback(reason)
                end
              end)
              |> case do
                {:ok, updated} -> {:ok, updated}
                err -> err
              end
            end
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
    # Resolve windows once per MO; pick the per-step WSG slice inside
    # the loop so different stations within an MO honour their own
    # working hours (Blending vs Bottling). When the planner dropped
    # the MO on a specific station row we override step 1's WSG, so
    # we resolve the slice AFTER applying the override below.
    resolved = resolved_windows_for_mo(mo, start_dt)

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
          effective_wsg_id =
            if idx == 0 and is_integer(wsg_override) do
              wsg_override
            else
              step.workstation_group_id
            end

          intervals = intervals_for_step(resolved, effective_wsg_id)
          capacity = wsg_capacity(effective_wsg_id)
          reservations = wsg_reservations(effective_wsg_id, step.id, cursor)

          {:ok, %{start_at: s_start, finish_at: s_finish, outside_hours_seconds: off}} =
            ScheduleWalker.walk_forward(intervals, cursor, duration,
              reservations: reservations,
              capacity: capacity
            )

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
        reloaded = reload_manufacturing_order(updated)
        # Rebroadcast the wizard channel — scheduling changes the
        # calendar footprint the "Do this next" logic reads to
        # decide whether the MO can be released. Without this the
        # planner still sees the "not on calendar" state after a
        # successful drop.
        Backend.OrderWizard.notify_via_mo(reloaded)
        {:ok, reloaded, %{outside_hours_seconds: outside}}

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
      # FORWARD topological scheduling. Drop_dt = the EARLIEST start
      # of the whole chain. Leaves (deepest descendants) start at
      # drop_dt; each parent starts when ALL its children have
      # finished. So the chain extends RIGHT of the cursor, not
      # backward into the past, and "drop here" matches the planner's
      # mental model of "this is when work on the project begins".
      #
      # Intervals are no longer pre-computed for the root and reused —
      # each MO resolves its own warehouse + WSG hours inside
      # do_schedule_one_forward so multi-warehouse / multi-WSG chains
      # land in each station's actual working window.
      chain =
        mo_chain(root)
        |> Enum.filter(&(&1.status in ["approved", "scheduled"]))

      ordered = chain_in_topo_order_leaves_first(chain)

      # Precompute the parent → children index once. Filtering the
      # chain per-MO inside the reduce turned this loop into O(n²)
      # on the MO chain size; grouping once collapses it to O(n).
      children_by_parent = Enum.group_by(chain, & &1.parent_mo_id)

      {_finish_by_mo, total_outside} =
        Enum.reduce(ordered, {%{}, 0}, fn mo, {finishes, off_total} ->
          children_finishes =
            children_by_parent
            |> Map.get(mo.id, [])
            |> Enum.map(fn c -> Map.get(finishes, c.id) end)
            |> Enum.filter(&(&1 != nil))

          earliest =
            case children_finishes do
              [] -> start_dt
              list -> [start_dt | list] |> Enum.max(DateTime)
            end

          case do_schedule_one_forward(actor, mo, earliest) do
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
        reloaded = reload_manufacturing_order(updated)
        # Chain scheduling drops planned_start/finish across every
        # MO in the tree — notify the wizard so the whole graph
        # re-projects (Do this next + line-level roll-up rail).
        Backend.OrderWizard.notify_via_mo(reloaded)
        {:ok, reloaded, %{outside_hours_seconds: outside}}

      err ->
        err
    end
  end

  # Post-order traversal of the chain so every parent comes after
  # all of its descendants. Lets the forward scheduler chain finish
  # times up the tree (parent.earliest = max(children.finish)).
  #
  # Complexity: previously O(n²) — every recursive call rescanned
  # `Map.values(by_id)` to find children, AND accumulated results
  # via `acc ++ [mo]` which is O(len(acc)) per append. Now O(n):
  # a single group_by materialises the child index; results are
  # prepended and reversed once at the caller.
  defp chain_in_topo_order_leaves_first(mos) do
    by_id = Map.new(mos, &{&1.id, &1})
    children_by_parent = Enum.group_by(mos, & &1.parent_mo_id)

    root =
      Enum.find(mos, fn m ->
        is_nil(m.parent_mo_id) or not Map.has_key?(by_id, m.parent_mo_id)
      end)

    case root do
      nil ->
        mos

      r ->
        {reversed, _seen} = post_order_walk(r, children_by_parent, MapSet.new(), [])
        Enum.reverse(reversed)
    end
  end

  defp post_order_walk(mo, children_by_parent, seen, acc) do
    if MapSet.member?(seen, mo.id) do
      {acc, seen}
    else
      seen = MapSet.put(seen, mo.id)
      children = Map.get(children_by_parent, mo.id, [])

      {acc, seen} =
        Enum.reduce(children, {acc, seen}, fn c, {a, s} ->
          post_order_walk(c, children_by_parent, s, a)
        end)

      {[mo | acc], seen}
    end
  end

  # ----- Internal scheduling helpers ------------------------------

  # Capacity of a workstation group = number of active Workstation
  # rows pointed at it. Falls back to 1 when the WSG has no children
  # — empty groups still need to be schedulable (you'd otherwise
  # block scheduling entirely until the user populates Workstations).
  defp wsg_capacity(nil), do: 1

  defp wsg_capacity(wsg_id) when is_integer(wsg_id) do
    from(w in Workstation,
      where: w.workstation_group_id == ^wsg_id and w.is_active == true,
      select: count(w.id)
    )
    |> Repo.one()
    |> case do
      n when is_integer(n) and n > 0 -> n
      _ -> 1
    end
  end

  # Existing reservations on a WSG, expressed as `{start, finish}`
  # pairs for `ScheduleWalker`. Pulled from `manufacturing_order_steps`
  # with non-null planned_start/finish, excluding the step being moved
  # (so dragging a block to a new time doesn't conflict with itself).
  # Bounded forward — we only care about steps that overlap or come
  # after the placement cursor.
  defp wsg_reservations(nil, _exclude_step_id, _from_dt), do: []

  defp wsg_reservations(wsg_id, exclude_step_id, %DateTime{} = from_dt)
       when is_integer(wsg_id) do
    base =
      from(s in ManufacturingOrderStep,
        where:
          s.workstation_group_id == ^wsg_id and
            not is_nil(s.planned_start) and
            not is_nil(s.planned_finish) and
            s.planned_finish > ^from_dt,
        select: {s.planned_start, s.planned_finish}
      )

    query =
      if is_integer(exclude_step_id) do
        from(s in base, where: s.id != ^exclude_step_id)
      else
        base
      end

    Repo.all(query)
  end

  # Resolve working intervals over a 90-day window starting from
  # `from_dt`. We resolve at WAREHOUSE level (not per-WSG) so all
  # of an MO's steps share one calendar — matches operators' mental
  # model of "the factory's hours". WSG-specific overrides land in
  # a future pass.
  # Resolved windows (per-group, per-day) for an MO's warehouse. Run
  # ONCE per MO; per-step intervals are extracted by `intervals_for_step/2`
  # without re-hitting the DB. Multi-warehouse chain scheduling calls
  # this per-MO so each MO walks in its own site's hours.
  defp resolved_windows_for_mo(%ManufacturingOrder{} = mo, %DateTime{} = from_dt) do
    company = Repo.get!(Company, mo.company_id)
    warehouse = Repo.get!(Warehouse, mo.warehouse_id)
    groups = list_workstation_groups_for_schedule_company(mo.company_id)

    from_date = DateTime.to_date(from_dt)
    to_date = Date.add(from_date, 90)

    resolve_working_windows(groups, warehouse, company, from_date, to_date)
  end

  # Per-step intervals. `wsg_id` nil falls back to the union of every
  # group's hours — only used when the step has no assigned WSG (rare,
  # legacy data). When the step has a WSG, only that group's windows
  # apply so a 'Blending' step never lands inside 'Packaging' hours.
  defp intervals_for_step(resolved, wsg_id) do
    ScheduleWalker.flatten_windows(resolved, wsg_id)
  end

  # Convenience for callers that don't know the step yet (e.g. an MO
  # got dropped on the calendar without a station row). Resolves the
  # MO's windows and unions every group.
  defp working_intervals_for_mo(%ManufacturingOrder{} = mo, %DateTime{} = from_dt) do
    mo
    |> resolved_windows_for_mo(from_dt)
    |> intervals_for_step(nil)
  end

  defp list_workstation_groups_for_schedule_company(company_id)
       when is_integer(company_id) do
    from(g in WorkstationGroup,
      where: g.company_id == ^company_id and g.is_active == true
    )
    |> Repo.all()
    |> populate_workstation_counts()
  end

  defp do_schedule_one_forward(actor, %ManufacturingOrder{} = mo, %DateTime{} = start_dt) do
    if mo.status not in ["approved", "scheduled"] do
      {:error, :wrong_status}
    else
      # Resolve windows ONCE per MO (one company + warehouse + groups
      # query). Each step picks its own WSG slice cheaply from the
      # cached `resolved` structure so a Blending step never lands
      # inside Packaging hours.
      resolved = resolved_windows_for_mo(mo, start_dt)

      steps =
        from(s in ManufacturingOrderStep,
          where: s.manufacturing_order_id == ^mo.id,
          order_by: [asc: s.sort_order, asc: s.id]
        )
        |> Repo.all()

      {last_finish, first_start, off_total} =
        Enum.reduce(steps, {start_dt, nil, 0}, fn step, {cursor, first, off_acc} ->
          duration = step.planned_duration_seconds || 0
          intervals = intervals_for_step(resolved, step.workstation_group_id)
          capacity = wsg_capacity(step.workstation_group_id)
          reservations = wsg_reservations(step.workstation_group_id, step.id, cursor)

          {:ok, %{start_at: s_start, finish_at: s_finish, outside_hours_seconds: off}} =
            ScheduleWalker.walk_forward(intervals, cursor, duration,
              reservations: reservations,
              capacity: capacity
            )

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

  defp do_schedule_one_backward(actor, %ManufacturingOrder{} = mo, %DateTime{} = finish_dt) do
    if mo.status not in ["approved", "scheduled"] do
      {:error, :wrong_status}
    else
      # Per-step WSG intervals — see do_schedule_one_forward for the
      # rationale (Blending hours ≠ Packaging hours).
      resolved = resolved_windows_for_mo(mo, finish_dt)

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
          intervals = intervals_for_step(resolved, step.workstation_group_id)

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
    # Only an approved/scheduled/in-progress parent locks the child's
    # placement. A draft parent's planned_start is stale auto-prefill
    # data — not a committed schedule — so it shouldn't block the
    # child. Symmetrical to check_children_finish_before which filters
    # children by status too.
    parent_first_start =
      from(s in ManufacturingOrderStep,
        join: mo in ManufacturingOrder,
        on: mo.id == s.manufacturing_order_id,
        where:
          s.manufacturing_order_id == ^parent_id and
            mo.status in ["scheduled", "in_progress"] and
            not is_nil(s.planned_start),
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
          {:ok, updated} ->
            reloaded = reload_manufacturing_order(updated)
            Backend.OrderWizard.notify_via_mo(reloaded)
            {:ok, reloaded}

          err ->
            err
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

    # Live MOs in the visible window — planned-but-not-finished work
    # the planner actively manages.
    live_ops =
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

    # Most recently completed MOs (10) — kept on the calendar for
    # context so the planner can see what just ran on the lines.
    # Without this, a `completed` MO disappears the moment Finish is
    # tapped, leaving the calendar feeling amnesiac.
    recent_completed_mo_ids =
      from(mo in ManufacturingOrder,
        where:
          mo.company_id == ^actor.company_id and
            mo.warehouse_id == ^warehouse.id and
            mo.status == "completed",
        order_by: [
          desc_nulls_last: mo.actual_finish,
          desc: mo.updated_at,
          desc: mo.id
        ],
        limit: 10,
        select: mo.id
      )
      |> Repo.all()

    completed_ops =
      from(s in ManufacturingOrderStep,
        join: mo in ManufacturingOrder,
        on: mo.id == s.manufacturing_order_id,
        where:
          mo.id in ^recent_completed_mo_ids and
            not is_nil(s.planned_start) and
            not is_nil(s.planned_finish),
        preload: [:workstation_group, manufacturing_order: [:item, :warehouse]],
        order_by: [asc: s.planned_start, asc: s.id]
      )
      |> Repo.all()

    ops = live_ops ++ completed_ops

    # Stamp each operation's preloaded MO with qc_pending_count +
    # broken_bookings_count + under_booked_count so the planner sees
    # every issue category on the calendar block without an extra
    # per-MO query.
    mo_ids = ops |> Enum.map(& &1.manufacturing_order_id) |> Enum.uniq()
    qc_counts = qc_pending_counts_for(mo_ids)
    broken_counts = broken_booking_counts_for(mo_ids)
    under_counts = under_booked_line_counts_for(mo_ids)

    Enum.map(ops, fn op ->
      mo = op.manufacturing_order
      qc = Map.get(qc_counts, mo.id, 0)
      broken = Map.get(broken_counts, mo.id, 0)
      under = Map.get(under_counts, mo.id, 0)

      stamped =
        mo
        |> Map.put(:qc_pending_count, qc)
        |> Map.put(:broken_bookings_count, broken)
        |> Map.put(:under_booked_count, under)

      %{op | manufacturing_order: stamped}
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
          it.item_type in ["raw_material", "packaging", "semi_finished", "consumable"] and
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
  Broken-booking detection. A booking is "broken" when its lot can no
  longer satisfy it — either the lot fell out of `available` (QC
  rejected / quarantine / hold) OR the lot's on-hand qty is now less
  than the sum of all `requested` bookings against it (over-allocation
  — e.g. a peer MO consumed more than expected, or stock shrunk).

  Returns a list of maps `%{mo_id, booking_uuid, item_id, item_name,
  lot_uuid, lot_code, lot_status, booked_qty, available_qty, reason}`
  where reason is `:lot_unavailable | :over_allocated`.

  This is computed lazily at page-load time — there's no background
  job. The cost is one Repo query per call (MO list pages batch by
  passing the full id list).
  """
  def list_broken_bookings_for([]), do: []

  def list_broken_bookings_for(mo_ids) when is_list(mo_ids) do
    # Pull every requested booking on the requested MOs, alongside
    # the lot's current state and the TOTAL of all open bookings on
    # that lot (across all MOs, not just the ones we're inspecting).
    # The total tells us whether the lot is over-allocated; the lot
    # status tells us whether QC made it unusable.
    total_booked_subq =
      from(b2 in ManufacturingOrderBooking,
        where: b2.status == "requested",
        group_by: b2.stock_lot_id,
        select: %{stock_lot_id: b2.stock_lot_id, total: sum(b2.quantity)}
      )

    # Resolve the lot's producing MO (when source_kind = manufacturing_order)
    # in the same query so the FE can name "from MO00017" instead of a
    # raw uuid. source_ref holds the MO uuid for MO-output lots.
    from(b in ManufacturingOrderBooking,
      join: it in Item,
      on: it.id == b.item_id,
      join: l in StockLot,
      on: l.id == b.stock_lot_id,
      left_join: t in subquery(total_booked_subq),
      on: t.stock_lot_id == b.stock_lot_id,
      left_join: p in Backend.Stock.Placement,
      on: p.stock_lot_id == l.id,
      left_join: src_mo in ManufacturingOrder,
      on:
        l.source_kind == "manufacturing_order" and
          fragment("?::text", src_mo.uuid) == l.source_ref,
      where:
        b.manufacturing_order_id in ^mo_ids and
          b.status == "requested" and
          it.item_type in ["raw_material", "packaging", "semi_finished", "consumable"],
      group_by: [
        b.id,
        b.uuid,
        b.manufacturing_order_id,
        b.quantity,
        it.id,
        it.name,
        l.id,
        l.uuid,
        l.status,
        l.source_kind,
        l.source_ref,
        src_mo.id,
        src_mo.uuid,
        src_mo.status,
        t.total
      ],
      select: %{
        mo_id: b.manufacturing_order_id,
        booking_uuid: b.uuid,
        item_id: it.id,
        item_name: it.name,
        lot_id: l.id,
        lot_uuid: l.uuid,
        lot_status: l.status,
        lot_source_kind: l.source_kind,
        lot_source_ref: l.source_ref,
        producing_mo_id: src_mo.id,
        producing_mo_uuid: src_mo.uuid,
        producing_mo_status: src_mo.status,
        booked_qty: b.quantity,
        # Sum across all placements; empty placements default to 0.
        on_hand_qty: coalesce(sum(p.qty), 0),
        total_booked_qty: coalesce(t.total, 0)
      }
    )
    |> Repo.all()
    |> Enum.flat_map(fn row ->
      cond do
        row.lot_status != "available" ->
          [
            row
            |> Map.put(:reason, :lot_unavailable)
            |> Map.update!(:booked_qty, &Decimal.to_string/1)
            |> Map.update!(:on_hand_qty, &decimal_to_string/1)
            |> Map.update!(:total_booked_qty, &decimal_to_string/1)
          ]

        Decimal.compare(
          to_decimal(row.total_booked_qty),
          to_decimal(row.on_hand_qty)
        ) == :gt ->
          [
            row
            |> Map.put(:reason, :over_allocated)
            |> Map.update!(:booked_qty, &Decimal.to_string/1)
            |> Map.update!(:on_hand_qty, &decimal_to_string/1)
            |> Map.update!(:total_booked_qty, &decimal_to_string/1)
          ]

        true ->
          []
      end
    end)
  end

  @doc """
  Per-MO count of broken bookings, keyed by MO id. Shaped for the
  schedule grid / picker queue / MO list — same access pattern as
  `qc_pending_counts_for/1`.
  """
  def broken_booking_counts_for([]), do: %{}

  def broken_booking_counts_for(mo_ids) when is_list(mo_ids) do
    list_broken_bookings_for(mo_ids)
    |> Enum.group_by(& &1.mo_id)
    |> Map.new(fn {id, list} -> {id, length(list)} end)
  end

  @doc """
  Per-MO count of BOM lines that aren't fully covered by bookings
  (required > sum of requested bookings). Drives the same "MO has
  issues" calendar chip as `broken_booking_counts_for/1` — released
  MOs that slipped through before the line-coverage release gate
  existed still surface here so the planner can see the gap.
  """
  def under_booked_line_counts_for([]), do: %{}

  def under_booked_line_counts_for(mo_ids) when is_list(mo_ids) do
    list_under_booked_lines_for(mo_ids)
    |> Enum.group_by(& &1.mo_id)
    |> Map.new(fn {id, list} -> {id, length(list)} end)
  end

  @doc """
  Detailed list of under-booked BOM lines for the given MOs. Each
  row carries the item + required/booked qtys so the release banner
  can render specific guidance ("Vitamin C blend — short by 2 kg")
  instead of a generic count. Same coverage rule as
  `ensure_all_lines_fully_booked/1`: pending output from open child
  MOs counts as in-flight coverage.
  """
  def list_under_booked_lines_for([]), do: []

  def list_under_booked_lines_for(mo_ids) when is_list(mo_ids) do
    from(mo in ManufacturingOrder,
      where: mo.id in ^mo_ids,
      preload: [:bookings, :children, bom: [lines: :part]]
    )
    |> Repo.all()
    |> Enum.flat_map(fn mo ->
      case ensure_all_lines_fully_booked(mo) do
        :ok ->
          []

        {:error, :lines_under_booked, list} ->
          Enum.map(list, fn s -> Map.put(s, :mo_id, mo.id) end)
      end
    end)
  end

  @doc """
  Detailed list of BOM lines that have a child MO producing the gap
  but no real lot booking yet. These pass the prepare gate (because
  pending output covers the gap) but fail the release gate (picker
  needs real lots). Surfaced to the planner so they can wait for
  the child to finish + pass QC, then book the new lot here.
  """
  def list_lines_awaiting_child_output_for([]), do: []

  def list_lines_awaiting_child_output_for(mo_ids) when is_list(mo_ids) do
    from(mo in ManufacturingOrder,
      where: mo.id in ^mo_ids,
      preload: [:bookings, :children, bom: [lines: :part]]
    )
    |> Repo.all()
    |> Enum.flat_map(fn mo ->
      case ensure_all_lines_have_real_bookings(mo) do
        :ok ->
          []

        {:error, :lines_not_lot_booked, list} ->
          Enum.map(list, fn s -> Map.put(s, :mo_id, mo.id) end)
      end
    end)
  end

  @doc """
  Bookings whose lot isn't fully placed in a `regular` warehouse
  cell — typically because the lot is still sitting at a
  production_feed / dispatch cell from a previous run and hasn't
  been pulled back yet. Drives the same per-row release-blocked
  banner as broken bookings.
  """
  def list_bookings_with_lot_off_warehouse_for([]), do: []

  def list_bookings_with_lot_off_warehouse_for(mo_ids) when is_list(mo_ids) do
    mos =
      from(mo in ManufacturingOrder,
        where: mo.id in ^mo_ids
      )
      |> Repo.all()

    Enum.flat_map(mos, fn mo ->
      case ensure_all_booked_lots_in_warehouse(mo) do
        :ok ->
          []

        {:error, :lots_not_in_warehouse, list} ->
          Enum.map(list, fn s -> Map.put(s, :mo_id, mo.id) end)
      end
    end)
  end

  defp to_decimal(%Decimal{} = d), do: d
  defp to_decimal(n) when is_integer(n), do: Decimal.new(n)
  defp to_decimal(n) when is_float(n), do: Decimal.from_float(n)
  defp to_decimal(s) when is_binary(s), do: Decimal.new(s)
  defp to_decimal(_), do: Decimal.new(0)

  defp decimal_to_string(%Decimal{} = d), do: Decimal.to_string(d)
  defp decimal_to_string(n) when is_integer(n), do: Integer.to_string(n)
  defp decimal_to_string(n) when is_float(n), do: Float.to_string(n)
  defp decimal_to_string(s) when is_binary(s), do: s
  defp decimal_to_string(_), do: "0"

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
  Planner action — release a scheduled MO to the warehouse.

  Release is the load-bearing physical gate: after this fires, the
  picker starts walking the floor with a list of real lots. To keep
  that safe, every one of the following must hold:

    * MO is `approved` (or already `scheduled` for idempotent re-release).
    * MO doesn't have a pending replan request.
    * At least one step carries a planned_start.
    * `ensure_all_lines_fully_booked` — every BOM line has bookings
      covering required qty (placeholders count).
    * `ensure_all_lines_have_real_bookings` — every BOM line has REAL
      bookings covering required qty (placeholders don't count here).
    * `ensure_all_booked_lots_available` — every booked lot has
      `status = "available"`. `quarantine`, `on_hold`, `awaiting_release`,
      `received`, `expected`, `requested` — every non-`available`
      status blocks. QC + Final Product Release run BEFORE this gate.
    * `ensure_all_booked_lots_in_warehouse` — every booked lot has a
      placement in a warehouse cell (not on the trolley from a prior
      pickup, not solely tracked at a bailee 3PL address).
    * `ensure_no_booked_lots_on_trolley` — no lot is mid-pickup for
      another MO.

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
         :ok <- ensure_not_needing_replan(mo),
         :ok <- ensure_has_planned_start(mo),
         :ok <- ensure_all_lines_fully_booked(mo),
         :ok <- ensure_all_lines_have_real_bookings(mo),
         :ok <- ensure_all_booked_lots_available(mo),
         :ok <- ensure_all_booked_lots_in_warehouse(mo),
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

  defp ensure_not_needing_replan(%ManufacturingOrder{needs_replan: true, needs_replan_reason: reason}),
    do: {:error, :needs_replan, reason}

  defp ensure_not_needing_replan(_), do: :ok

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
  def unrelease_mo_from_warehouse(%User{} = actor, %ManufacturingOrder{} = mo, opts \\ []) do
    needs_replan = Keyword.get(opts, :needs_replan, false)
    reason = Keyword.get(opts, :reason)

    cond do
      is_nil(mo.released_to_warehouse_at) ->
        {:error, :not_released}

      not is_nil(mo.pickup_started_at) ->
        {:error, :pickup_in_progress}

      true ->
        # Clear the release stamps so the picker queue drops the row.
        # Status regression is two-stage: always step down to approved
        # (drops the MO out of the picker queue). When the caller
        # flags `needs_replan: true` — the "Pull back to fix" path —
        # we then cascade down to `draft` so the planner can edit
        # bookings again. Approved is a frozen state; editing
        # bookings is a draft-only action. Going all the way back
        # also clears both signatures so the planner re-prepares +
        # re-approves the corrected MO (4-eyes audit trail stays
        # intact via the audit log).
        base = %{
          "status" => "approved",
          "released_to_warehouse_at" => nil,
          "released_to_warehouse_by_id" => nil,
          "updated_by_id" => actor.id
        }

        with {:ok, approved} <- apply_pickup_changeset(actor, mo, base) do
          if needs_replan do
            with {:ok, demoted} <-
                   cascade_approval_transition(actor, approved, "draft", %{
                     "approved_by_id" => nil,
                     "approved_at" => nil,
                     "prepared_by_id" => nil,
                     "prepared_at" => nil
                   }) do
              mark_needs_replan(actor, demoted, reason)
            end
          else
            {:ok, approved}
          end
        end
    end
  end

  @doc """
  Mark an MO as needing replan. Sets the `needs_replan` flag with a
  reason + timestamp so the planner sees WHY on the detail page.
  Idempotent — overwrites the existing reason/timestamp. Used by:

    * Output QC fail (auto)
    * Planner pull-back with an explicit reason
    * `:broken_bookings_detected` regression once we wire it
  """
  def mark_needs_replan(%User{} = actor, %ManufacturingOrder{} = mo, reason) do
    attrs = %{
      "needs_replan" => true,
      "needs_replan_reason" => reason,
      "needs_replan_at" => now(),
      "updated_by_id" => actor.id
    }

    mo
    |> ManufacturingOrder.transition_changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} = ok ->
        Backend.Broadcasts.entity_changed(
          "manufacturing-order",
          updated.uuid,
          updated.company_id,
          "needs_replan"
        )

        ok

      err ->
        err
    end
  end

  @doc """
  Cascade helper called from Backend.Purchasing when a PO change
  orphans placeholder bookings (PO cancel, PO draft-delete, PO line
  delete, PO line qty shrink).

  For each MO id in the list:

    * `prepared` / `approved` — cascade back to `draft` (both
      signatures cleared) via `cascade_approval_transition`, then set
      `needs_replan` with the reason. Approval is now the load-bearing
      gate: PR 2's `ensure_all_lines_fully_booked` will refuse re-
      approval until the planner rebuilds coverage from another PO or
      real stock.
    * `draft` — nothing to un-sign, just mark `needs_replan` so the
      planner sees the flag on the detail page + the row surfaces
      in `/my-tasks`.
    * `scheduled` — placeholders shouldn't reach this stage (the
      release gate blocks them). If we're here an invariant broke —
      flag `needs_replan` with a marker in the reason so it's obvious
      on inspection.
    * `in_progress` / `completed` / `cancelled` — no action, physical
      work is immutable.

  Broadcasts fire per demoted MO via `cascade_approval_transition` +
  `mark_needs_replan`; planner sees the change land in real time.
  """
  def demote_mos_for_broken_bookings(%User{} = actor, mo_ids, reason)
      when is_list(mo_ids) and is_binary(reason) do
    Enum.each(mo_ids, fn id ->
      case Repo.get(ManufacturingOrder, id) do
        %ManufacturingOrder{} = mo -> demote_mo_for_broken_bookings(actor, mo, reason)
        _ -> :ok
      end
    end)

    :ok
  end

  defp demote_mo_for_broken_bookings(%User{} = actor, %ManufacturingOrder{} = mo, reason) do
    case mo.status do
      s when s in ["prepared", "approved"] ->
        case cascade_approval_transition(actor, mo, "draft", %{
               "approved_by_id" => nil,
               "approved_at" => nil,
               "prepared_by_id" => nil,
               "prepared_at" => nil
             }) do
          {:ok, demoted} -> mark_needs_replan(actor, demoted, reason)
          other -> other
        end

      "draft" ->
        mark_needs_replan(actor, mo, reason)

      "scheduled" ->
        mark_needs_replan(actor, mo, "#{reason} (unexpected: MO already scheduled)")

      _ ->
        # in_progress / completed / cancelled — no action.
        :ok
    end
  end

  @doc """
  Planner action — clear the `needs_replan` flag once they've
  re-confirmed the bookings cover what's required. Refuses if the
  MO is still under-booked (the existing
  `ensure_all_lines_fully_booked` invariant) so the planner can't
  accidentally unflag a still-broken MO.
  """
  def clear_replan(%User{} = actor, %ManufacturingOrder{} = mo) do
    with :ok <- ensure_all_lines_fully_booked(mo) do
      attrs = %{
        "needs_replan" => false,
        "needs_replan_reason" => nil,
        "needs_replan_at" => nil,
        "updated_by_id" => actor.id
      }

      mo
      |> ManufacturingOrder.transition_changeset(attrs)
      |> Repo.update()
      |> case do
        {:ok, updated} = ok ->
          Backend.Broadcasts.entity_changed(
            "manufacturing-order",
            updated.uuid,
            updated.company_id,
            "replan_cleared"
          )

          ok

        err ->
          err
      end
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
        photo_urls_by_booking_uuid,
        opts \\ []
      )
      when is_binary(target_cell_uuid) and is_map(photo_urls_by_booking_uuid) do
    bookings = list_pickup_bookings(mo)
    # `override_fit: true` opts the operator out of the dimensional
    # fit gate — only honoured when the target cell is EMPTY (no
    # committed placements). The FE offers this as a checkbox on the
    # transfer overview when the auto-picked cell is disqualified.
    override_fit? = Keyword.get(opts, :override_fit, false) == true

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
            do_confirm_pickup_transfer(
              actor,
              mo,
              bookings,
              target_cell,
              photo_urls_by_booking_uuid,
              override_fit?
            )
        end
    end
  end

  defp do_confirm_pickup_transfer(actor, mo, bookings, target_cell, photo_urls, override_fit?) do
    Repo.transaction(fn ->
      now_dt = now()

      Enum.each(bookings, fn booking ->
        case transfer_booking_to_production(
               actor,
               booking,
               target_cell,
               photo_urls,
               now_dt,
               override_fit?
             ) do
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
  #
  # Resolves the origin cell at confirm-transfer time rather than
  # trusting `booking.storage_cell_id` blindly: if the snapshot is
  # stale (e.g. a lot received into the quarantine cage was QC-
  # released to a regular shelf AFTER the picker stamped picked_at,
  # so the auto-sync skipped the booking) we fall back to the lot's
  # CURRENT primary placement. Without this, the picker hits
  # `placement_not_found` at the finish step and gets stuck having
  # physically picked the lot but unable to confirm.
  defp transfer_booking_to_production(actor, booking, target_cell, photo_urls, now_dt, override_fit? \\ false) do
    # Physical reality: pickers walk the ENTIRE lot to production
    # (a 500-pouch box, an 800-label roll, an 8kg drum of blend) —
    # you can't split a sealed container on the shelf and take a
    # partial qty. Booking quantity is what the recipe EXPECTS to
    # consume; actual usage lands via closeout. So the transfer
    # moves every non-target placement of this lot to the production
    # cell, not just booking.quantity. Any leftover after production
    # then gets picked up honestly by closeout + return-pickup.
    #
    # Idempotent per lot: if multiple bookings on the same MO share
    # a lot, the first booking drains everything to production and
    # subsequent bookings find no non-target placements to drain —
    # the emit path handles the empty list as an audit-only no-op.
    photo_url = Map.get(photo_urls, booking.uuid)

    with {:ok, drains} <-
           drain_whole_lot_to_production(
             booking.stock_lot_id,
             target_cell.id
           ),
         :ok <-
           ensure_pickup_fits(
             booking.stock_lot_id,
             target_cell,
             drains,
             override_fit?
           ) do
      emit_pickup_movements(
        actor,
        booking,
        drains,
        target_cell,
        photo_url,
        now_dt
      )
    end
  end

  # Dimensional fit gate. Under the whole-lot transfer model the
  # picker moves every non-target placement's qty INTO the production
  # cell — could be a full 500-pouch box + a partial roll on top.
  # Delegate to Backend.Stock.ensure_placement_fits/3 which does the
  # committed-vs-projected math using the lot's packaging dims. When
  # the lot has no dims configured (:unknown footprint) the check
  # falls through silently — same lenient policy as the ranking path.
  #
  # `override_fit?` short-circuits the gate ONLY when the target cell
  # is empty (no committed placements). Operator judgement can beat
  # the calculator on an empty cell — packages might stack better in
  # reality, weight ratings are often conservative. But it can't
  # beat physics on a cell that's already partially full.
  defp ensure_pickup_fits(_lot_id, _target_cell, [], _override?), do: :ok

  defp ensure_pickup_fits(lot_id, target_cell, drains, override?) do
    if override? and cell_is_empty?(target_cell.id) do
      :ok
    else
      total_qty =
        Enum.reduce(drains, Decimal.new(0), fn %{take: t}, acc -> Decimal.add(acc, t) end)

      case Repo.get(Backend.Stock.Lot, lot_id) do
        %Backend.Stock.Lot{} = lot ->
          Backend.Stock.ensure_placement_fits(lot, target_cell, total_qty)

        _ ->
          :ok
      end
    end
  end

  defp cell_is_empty?(cell_id) do
    count =
      from(p in Backend.Stock.Placement,
        where: p.storage_cell_id == ^cell_id and p.qty > 0,
        select: count(p.id)
      )
      |> Repo.one()

    (count || 0) == 0
  end

  # Every non-target placement of `lot_id` gets moved to the
  # target cell — whole-lot transfer per the physical picker flow.
  # Returns `{:ok, [%{placement: p, take: qty}, ...]}` with each
  # drain's full qty (no partial takes), or `{:ok, []}` when the
  # lot is already fully consolidated at the target cell.
  defp drain_whole_lot_to_production(lot_id, target_cell_id) do
    placements =
      from(p in Backend.Stock.Placement,
        where:
          p.stock_lot_id == ^lot_id and p.qty > 0 and
            p.storage_cell_id != ^target_cell_id
      )
      |> Repo.all()

    drains = Enum.map(placements, fn p -> %{placement: p, take: p.qty} end)
    {:ok, drains}
  end

  # Resolve all the placements we need to deplete to satisfy
  # `booking.quantity`, in this order:
  #   1. the booking's snapshot cell (the picker probably grabbed from
  #      it; honouring the snapshot keeps the audit trail tight)
  #   2. every other non-zero placement of the lot, FIFO by id
  # Returns `[%{placement: p, take: qty}, ...]` summing to
  # `booking.quantity`, or `{:error, :insufficient_qty}` if the lot
  # genuinely doesn't have enough on-hand anywhere. The `placement`
  # struct is re-read from the DB inside the same transaction so we
  # see any concurrent updates the warehouse picker just made.
  defp drain_lot_for_pickup(lot_id, snapshot_cell_id, target_qty) do
    snapshot =
      if snapshot_cell_id do
        Repo.get_by(Backend.Stock.Placement,
          stock_lot_id: lot_id,
          storage_cell_id: snapshot_cell_id
        )
      end

    others_base =
      from(p in Backend.Stock.Placement,
        join: sc in Backend.Warehouses.StorageCell,
        on: sc.id == p.storage_cell_id,
        where: p.stock_lot_id == ^lot_id and p.qty > 0,
        order_by: [
          asc: fragment("CASE WHEN ? = 'regular' THEN 0 ELSE 1 END", sc.purpose),
          asc: p.id
        ]
      )

    others_query =
      case snapshot_cell_id do
        nil -> others_base
        cell_id -> from(p in others_base, where: p.storage_cell_id != ^cell_id)
      end

    others = Repo.all(others_query)

    ordered =
      case snapshot do
        %Backend.Stock.Placement{qty: q} = p ->
          if Decimal.compare(q, Decimal.new(0)) == :gt, do: [p | others], else: others

        nil ->
          others
      end

    accumulate_drains(ordered, target_qty, [])
  end

  defp accumulate_drains(_placements, %Decimal{coef: 0}, acc), do: {:ok, Enum.reverse(acc)}
  defp accumulate_drains([], _remaining, _acc), do: {:error, :insufficient_qty}

  defp accumulate_drains([p | rest], remaining, acc) do
    take = decimal_min(remaining, p.qty)

    cond do
      Decimal.compare(take, Decimal.new(0)) == :eq ->
        accumulate_drains(rest, remaining, acc)

      true ->
        next = Decimal.sub(remaining, take)
        accumulate_drains(rest, next, [%{placement: p, take: take} | acc])
    end
  end

  defp emit_pickup_movements(_actor, _booking, [], _target_cell, _photo, _now), do: {:ok, nil}

  defp emit_pickup_movements(actor, booking, drains, target_cell, photo_url, now_dt) do
    # Per-drain step: emit a `move` Stock.Movement for the source
    # placement's full qty, decrement the source, and add the same
    # qty to the target cell placement. No final upsert with
    # `booking.quantity` — under the whole-lot transfer model each
    # drain's `take` IS the physical qty that moved, and the target
    # is the sum of every drain (which matches the lot's on-hand,
    # not booking.quantity).
    Enum.reduce_while(drains, {:ok, nil}, fn %{placement: placement, take: take},
                                             _acc ->
      result =
        %Backend.Stock.Movement{}
        |> Backend.Stock.Movement.changeset(%{
          "company_id" => booking.company_id,
          "stock_lot_id" => booking.stock_lot_id,
          "from_cell_id" => placement.storage_cell_id,
          "to_cell_id" => target_cell.id,
          "delta_qty" => take,
          "kind" => "move",
          "actor_id" => actor.id,
          "occurred_at" => now_dt,
          "photo_url" => photo_url,
          "reference_kind" => "manufacturing_order",
          "reference_ref" => mo_uuid_for_booking(booking)
        })
        |> Repo.insert()

      case result do
        {:ok, movement} ->
          with {:ok, _from_placement} <- decrement_placement_row(placement, take),
               {:ok, _to_placement} <-
                 upsert_target_placement(booking, target_cell, take) do
            Audit.record_created(actor, "stock_movement", movement, %{
              kind: movement.kind,
              delta_qty: movement.delta_qty,
              from_cell_id: movement.from_cell_id,
              to_cell_id: movement.to_cell_id,
              reference_kind: movement.reference_kind,
              reference_ref: movement.reference_ref
            })

            {:cont, {:ok, movement}}
          else
            err -> {:halt, err}
          end

        err ->
          {:halt, err}
      end
    end)
  end

  # Whole-lot variant of upsert_lot_placement/2 — takes an explicit
  # qty (the drain's physical `take`) instead of hard-wiring
  # booking.quantity. Adds to the existing placement or inserts a
  # new one at the target cell.
  defp upsert_target_placement(%ManufacturingOrderBooking{} = b, target_cell, qty) do
    case Repo.get_by(Backend.Stock.Placement,
           stock_lot_id: b.stock_lot_id,
           storage_cell_id: target_cell.id
         ) do
      %Backend.Stock.Placement{} = existing ->
        existing
        |> Backend.Stock.Placement.changeset(%{
          "qty" => Decimal.add(existing.qty, qty)
        })
        |> Repo.update()

      nil ->
        %Backend.Stock.Placement{}
        |> Backend.Stock.Placement.changeset(%{
          "company_id" => b.company_id,
          "stock_lot_id" => b.stock_lot_id,
          "storage_cell_id" => target_cell.id,
          "qty" => qty
        })
        |> Repo.insert()
    end
  end

  defp mo_uuid_for_booking(%ManufacturingOrderBooking{} = b) do
    case Repo.get(ManufacturingOrder, b.manufacturing_order_id) do
      %ManufacturingOrder{uuid: uuid} -> uuid
      _ -> nil
    end
  end

  # Find the placement the picker is actually fetching from. First try
  # the booking's snapshot cell (the happy path — picker scanned exactly
  # this cell). If the snapshot is stale, fall back to the lot's
  # current primary placement (regular cells beat system-purpose cells,
  # highest qty wins). Returns `:placement_not_found` only when the
  # lot has zero non-zero placements anywhere — at that point the
  # picker really can't fetch and we should surface the abort.
  defp resolve_origin_placement(%ManufacturingOrderBooking{} = b) do
    snapshot =
      if b.storage_cell_id do
        Repo.get_by(Backend.Stock.Placement,
          stock_lot_id: b.stock_lot_id,
          storage_cell_id: b.storage_cell_id
        )
      end

    case snapshot do
      %Backend.Stock.Placement{} = p ->
        {:ok, p}

      nil ->
        case primary_placement_for_lot(b.stock_lot_id) do
          nil -> {:error, :placement_not_found}
          %Backend.Stock.Placement{} = p -> {:ok, p}
        end
    end
  end

  defp primary_placement_for_lot(lot_id) when is_integer(lot_id) do
    from(p in Backend.Stock.Placement,
      join: sc in Backend.Warehouses.StorageCell,
      on: sc.id == p.storage_cell_id,
      where: p.stock_lot_id == ^lot_id and p.qty > 0,
      order_by: [
        asc: fragment("CASE WHEN ? = 'regular' THEN 0 ELSE 1 END", sc.purpose),
        desc: p.qty,
        asc: p.id
      ],
      limit: 1
    )
    |> Repo.one()
  end

  defp primary_placement_for_lot(_), do: nil

  defp decrement_placement_row(%Backend.Stock.Placement{} = p, qty) do
    new_qty = Decimal.sub(p.qty, qty)

    cond do
      Decimal.compare(new_qty, Decimal.new(0)) == :lt ->
        {:error, :insufficient_qty}

      # Empty the cell: delete the row instead of leaving a qty=0
      # ghost. Same rationale as Backend.Stock.write_adjusted_placement.
      Decimal.equal?(new_qty, Decimal.new(0)) ->
        case Repo.delete(p) do
          {:ok, _} -> {:ok, %Backend.Stock.Placement{p | qty: new_qty}}
          err -> err
        end

      true ->
        p
        |> Backend.Stock.Placement.changeset(%{"qty" => new_qty})
        |> Repo.update()
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
  @doc """
  After a lot moves cells, repoint every open MO booking referencing
  it at the lot's CURRENT primary placement. Open = `status =
  "requested"` and `picked_at IS NULL` — once a picker is on the
  trolley, the cell is locked to where they fetched from.

  Without this, a booking captures the cell snapshot at booking time
  and never updates. A lot received into the quarantine cage and
  later QC-released to a regular shelf will still tell the picker
  "go to the cage" — the symptom that prompted this helper.

  Primary placement = the placement with the most qty; regular cells
  beat system-purpose cells (quarantine / hold / dispatch / etc.) so
  the picker never gets sent to a non-pickable cell when a regular
  alternative exists.
  """
  def refresh_open_bookings_for_lot(lot_id) when is_integer(lot_id) do
    case primary_placement_for_lot(lot_id) do
      nil ->
        :ok

      %Backend.Stock.Placement{storage_cell_id: cell_id} ->
        from(b in ManufacturingOrderBooking,
          where:
            b.stock_lot_id == ^lot_id and
              b.status == "requested" and
              is_nil(b.picked_at)
        )
        |> Repo.update_all(set: [storage_cell_id: cell_id, updated_at: now()])

        :ok
    end
  end

  def refresh_open_bookings_for_lot(_), do: :ok

  @doc """
  Reality-vs-system check after a stock decrease on `lot_id`. Walks
  every open booking on the lot in FIFO order (booking id ASC, so the
  oldest claim wins), tracks cumulative demand against the lot's
  current on-hand, and cascades any MO whose bookings now exceed
  what's physically available back to a re-plannable state.

  Triggered after:

    * closeout drains (the path that legitimately exceeds the booked
      qty via spillage — the case that started this regression)
    * `Stock.move_placement` / `Stock.adjust_placement` (any manual
      stock write that could deplete an open booking's lot)

  Cascade per affected MO (depends on current status):

    * `released` to warehouse → `unrelease_mo_from_warehouse(needs_replan: true)`
      drops out of picker queue, cascades to `draft`, clears both
      signatures, stamps `needs_replan` with the reason.
    * `approved` (not yet released) → `unapprove_mo` + mark
      needs_replan. Same end state as above without the unrelease.
    * `draft` → just stamp needs_replan so the planner sees the
      "Request purchases" call-to-action on the wizard.
    * `scheduled` → unschedule the MO chain first, then cascade
      to draft via unrelease (handles the released+scheduled combo).
    * `in_progress` / `completed` / `cancelled` → too late to flip;
      audit the incident and move on. Manual cleanup required.

  Returns `:ok` regardless — best-effort cleanup; the caller already
  succeeded with the primary write and we don't want to roll it back
  just because a downstream MO couldn't be demoted (a completed MO
  can't be demoted at all, but we still recorded the consumption).
  """
  def revalidate_bookings_for_lot(%User{} = actor, lot_id, reason)
      when is_integer(lot_id) and is_binary(reason) do
    on_hand = lot_on_hand(lot_id)

    open_bookings =
      from(b in ManufacturingOrderBooking,
        where:
          b.stock_lot_id == ^lot_id and
            b.status == "requested" and
            is_nil(b.picked_at) and
            is_nil(b.consumed_at),
        order_by: [asc: b.id]
      )
      |> Repo.all()

    {_used, broken} =
      Enum.reduce(open_bookings, {Decimal.new(0), []}, fn b, {used, broken_acc} ->
        next_demand = Decimal.add(used, b.quantity || Decimal.new(0))

        if Decimal.compare(next_demand, on_hand) == :gt do
          {used, [b | broken_acc]}
        else
          {next_demand, broken_acc}
        end
      end)

    broken
    |> Enum.map(& &1.manufacturing_order_id)
    |> Enum.uniq()
    |> Enum.each(fn mo_id ->
      case Repo.get(ManufacturingOrder, mo_id) do
        %ManufacturingOrder{} = mo -> cascade_mo_to_planning(actor, mo, reason)
        _ -> :ok
      end
    end)

    :ok
  end

  def revalidate_bookings_for_lot(_actor, _lot_id, _reason), do: :ok

  # MO-status cascade for the over-allocation case. See the doc on
  # `revalidate_bookings_for_lot/3` for the decision table.
  defp cascade_mo_to_planning(actor, %ManufacturingOrder{} = mo, reason) do
    cond do
      mo.status in ["completed", "cancelled"] ->
        # Audit the incident so an auditor can spot a completed MO
        # whose ingredient lot retroactively went short — but there's
        # nothing to demote, the work happened.
        Audit.record_updated(
          actor,
          "manufacturing_order",
          mo,
          %{},
          %{
            broken_bookings_detected: true,
            broken_bookings_reason: reason,
            status_at_detection: mo.status
          }
        )

      mo.status == "in_progress" ->
        # Production already started — flipping back would invalidate
        # the audit chain. Flag for manual intervention.
        mark_needs_replan(actor, mo, reason)

      not is_nil(mo.released_to_warehouse_at) ->
        unrelease_mo_from_warehouse(actor, mo, needs_replan: true, reason: reason)

      mo.status == "scheduled" ->
        with {:ok, unscheduled} <- unschedule_mo(actor, mo) do
          cascade_mo_to_planning(actor, unscheduled, reason)
        end

      mo.status == "approved" ->
        with {:ok, draft_mo} <- unapprove_mo(actor, mo) do
          mark_needs_replan(actor, draft_mo, reason)
        end

      mo.status == "draft" ->
        mark_needs_replan(actor, mo, reason)

      true ->
        :ok
    end
  end

  def list_pickup_bookings(%ManufacturingOrder{} = mo) do
    from(b in ManufacturingOrderBooking,
      join: it in Item,
      on: it.id == b.item_id,
      where:
        b.manufacturing_order_id == ^mo.id and
          b.status == "requested" and
          it.item_type in ["raw_material", "packaging", "semi_finished", "consumable"],
      order_by: [asc: it.name, asc: b.id],
      preload: [
        :picked_by,
        :received_by,
        :consumed_by,
        # item.stock_uom needed so the closeout / pickup mobile pages
        # render "kg" / "pcs" instead of the "ea" fallback when
        # operators type a remaining quantity.
        item: :stock_uom,
        storage_cell: [storage_location: [floor: [:warehouse]]],
        # Placements feed `qty_on_hand` on the lot summary — without
        # this the closeout page's "on hand" info row stays blank.
        stock_lot: [:item, :unit_of_measurement, placements: :storage_cell]
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

    # Stamp broken_bookings_count + under_booked_count on each MO so
    # the picker queue card can show "bookings broken — planner is
    # fixing" instead of a green Pick CTA whenever the planner needs
    # to intervene.
    mo_ids = Enum.map(mos, & &1.id)
    broken_counts = broken_booking_counts_for(mo_ids)
    under_counts = under_booked_line_counts_for(mo_ids)

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

      mo_with_count =
        mo
        |> Map.put(:broken_bookings_count, Map.get(broken_counts, mo.id, 0))
        |> Map.put(:under_booked_count, Map.get(under_counts, mo.id, 0))

      %{
        mo: mo_with_count,
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

  @doc """
  Pre-flight fit check per production-feed cell for an MO's pickup.
  Returns each empty production-feed cell decorated with `fit` info
  — the same shape Backend.Stock.check_fit produces — so the picker
  UI can filter / gray-out cells that can't hold the whole load
  BEFORE they walk with the trolley + take photos and hit a hard
  refusal at confirm-transfer.

  When packaging dims aren't set on some lots (compute_lot_footprint
  returns :unknown), the check falls through as \"unknown_fit\" for
  the cell — treated as safe (matches the ranking path's lenient
  policy).
  """
  def list_empty_production_feed_cells_with_fit(company_id, %ManufacturingOrder{} = mo) do
    cells = list_empty_production_feed_cells(company_id)
    bookings = list_pickup_bookings(mo)

    # Whole-lot footprint sum — mirrors the picker's whole-lot
    # transfer semantics. For each booking's lot we take the lot's
    # TOTAL current on-hand (sum of every placement), not
    # booking.quantity, since the picker walks the whole container.
    lot_ids = bookings |> Enum.map(& &1.stock_lot_id) |> Enum.reject(&is_nil/1) |> Enum.uniq()

    on_hand_by_lot =
      if lot_ids == [] do
        %{}
      else
        from(p in Backend.Stock.Placement,
          where: p.stock_lot_id in ^lot_ids,
          group_by: p.stock_lot_id,
          select: {p.stock_lot_id, sum(p.qty)}
        )
        |> Repo.all()
        |> Map.new()
      end

    lots =
      if lot_ids == [] do
        []
      else
        from(l in StockLot, where: l.id in ^lot_ids) |> Repo.all()
      end

    footprints =
      Enum.map(lots, fn l ->
        qty = Map.get(on_hand_by_lot, l.id) || Decimal.new(0)
        Backend.Stock.compute_lot_footprint(%{l | qty_received: qty})
      end)

    # If any lot is :unknown we skip the check (mirror the current
    # policy). Otherwise sum footprints and check each cell.
    any_unknown? = Enum.any?(footprints, &(&1 == :unknown))

    total_needed =
      if any_unknown?, do: :unknown, else: Backend.Stock.sum_footprints(footprints)

    Enum.map(cells, fn cell ->
      fit =
        case total_needed do
          :unknown ->
            %{
              disqualified?: false,
              reason: "unknown_fit",
              current_percent_used: 0,
              projected_percent_used: 0,
              percent_used: 0,
              free_pct: 100
            }

          footprint ->
            capacity = Backend.Stock.compute_cell_capacity(cell, Backend.Stock.empty_footprint())
            Backend.Stock.check_fit(footprint, capacity)
        end

      %{cell: cell, fit: fit}
    end)
    |> Enum.sort_by(fn %{fit: fit} ->
      {if(fit.disqualified?, do: 1, else: 0), fit.percent_used}
    end)
  end

  # ----- Output QC (finished product quality sign-off) -----------

  @doc """
  Pending output-QC queue. Returns the manufactured `stock_lot`s that
  still have `status = "received"` — every Finish call inserts the
  output lots in that state, and they stay there until a production
  QC operator passes (`qc_passed` → `available`) or fails them
  (`qc_failed` → `qc_failed`).
  """
  def list_pending_output_qc(company_id) when is_integer(company_id) do
    from(l in StockLot,
      where:
        l.company_id == ^company_id and
          l.source_kind == "manufacturing_order" and
          l.status == "received",
      preload: [
        :item,
        :unit_of_measurement,
        placements: [storage_cell: [storage_location: [floor: [:warehouse]]]]
      ],
      order_by: [asc: l.inserted_at, asc: l.id]
    )
    |> Repo.all()
    |> Enum.map(fn lot ->
      mo =
        case Repo.get_by(ManufacturingOrder, uuid: lot.source_ref) do
          nil -> nil
          mo -> Repo.preload(mo, [:item, :pickup_completed_by])
        end

      %{lot: lot, mo: mo}
    end)
  end

  @doc """
  Production QC sign-off on a single output lot. Wraps
  `Backend.Stock.record_lot_event` so the lot's lifecycle ledger
  remains the single source of truth — but only accepts the two
  verdicts an output QC operator can render. Refuses any lot that
  isn't a manufacturing_order source (gates the new
  production.qc_output permission to the artifacts it's intended
  for; stock.qc still governs incoming PO lots).
  """
  def sign_off_output_qc(%User{} = actor, lot_uuid, "pass", attrs)
      when is_binary(lot_uuid) do
    # A "pass" verdict routes down one of two lifecycle paths
    # depending on whether the lot has a downstream consumer:
    #
    #   * Sub-MO output already booked as an ingredient by a live
    #     parent MO → `qc_passed` → `available`. The parent's
    #     closeout will consume it directly from the feed cell; no
    #     Final Product Release owed.
    #
    #   * Top-of-tree output (no downstream MO holding a booking) →
    #     `output_qc_passed` → `awaiting_release`. Auto-router parks
    #     it in a `finished_quarantine` cell; QA does Final Product
    #     Release (BRCGS Issue 9 § 5.6) before it becomes
    #     dispatchable.
    kind =
      case Backend.Stock.get_for_company(actor.company_id, lot_uuid) do
        %StockLot{id: lot_id, source_kind: "manufacturing_order"} ->
          if lot_committed_to_downstream_mo?(actor.company_id, lot_id) do
            "qc_passed"
          else
            "output_qc_passed"
          end

        _ ->
          "qc_passed"
      end

    do_full_qc(actor, lot_uuid, kind, attrs)
  end

  def sign_off_output_qc(%User{} = actor, lot_uuid, "fail", attrs)
      when is_binary(lot_uuid) do
    case Backend.Stock.get_for_company(actor.company_id, lot_uuid) do
      nil ->
        {:error, :lot_not_found}

      %StockLot{source_kind: "manufacturing_order"} = lot ->
        reject_qty_raw = attrs["reject_qty"] || attrs[:reject_qty]

        case classify_fail_qty(reject_qty_raw, lot.qty_received) do
          :full -> do_full_qc(actor, lot_uuid, "qc_failed", attrs)
          {:partial, reject_qty} -> do_partial_fail(actor, lot, reject_qty, attrs)
          {:error, reason} -> {:error, reason}
        end

      %StockLot{} ->
        {:error, :not_a_manufactured_lot}
    end
  end

  def sign_off_output_qc(_actor, _uuid, _verdict, _attrs), do: {:error, :bad_verdict}

  # No reject_qty (or matching the full lot) → full pass / fail via
  # the existing lifecycle event. Anything in between → partial split.
  defp classify_fail_qty(nil, _full), do: :full
  defp classify_fail_qty("", _full), do: :full

  defp classify_fail_qty(raw, full) do
    case parse_positive_decimal(raw) do
      {:ok, d} ->
        cond do
          Decimal.compare(d, full) == :gt -> {:error, :reject_qty_exceeds_lot}
          Decimal.compare(d, full) == :eq -> :full
          Decimal.compare(d, full) == :lt -> {:partial, d}
        end

      :error ->
        {:error, :bad_reject_qty}
    end
  end

  defp do_full_qc(%User{} = actor, lot_uuid, kind, attrs)
       when kind in ["qc_passed", "output_qc_passed", "qc_failed"] do
    with %StockLot{source_kind: "manufacturing_order"} = lot <-
           Backend.Stock.get_for_company(actor.company_id, lot_uuid) do
      Repo.transaction(fn ->
        # On pass, let the QC operator correct the production's
        # numbers before flipping the lot to `available` — measured
        # weight, real package dims, actual qty. Any qty delta emits
        # an adjust_up/adjust_down movement at the production-feed
        # placement so traceability holds; the lot row + placement
        # update atomically with the lifecycle event.
        with :ok <- maybe_apply_qc_adjustments(actor, lot, kind, attrs),
             reloaded <- Backend.Stock.get_for_company(actor.company_id, lot_uuid),
             {:ok, _result} <-
               Backend.Stock.Lifecycle.record_event(reloaded, kind, %{
                 actor: actor,
                 actor_kind: "user",
                 reason: attrs["reason"] || attrs[:reason],
                 metadata: %{}
               }) do
          if kind == "qc_failed" do
            # On QC fail, propagate the regression up the chain — any
            # MO that's booked this lot as an input can no longer
            # satisfy its plan. Flag them as needing replan so the
            # planner sees the downstream impact immediately.
            propagate_replan_to_consumers(actor, reloaded)
          end

          if kind == "qc_passed" do
            # On QC pass, auto-book the freshly-available output onto
            # the parent MO that was waiting for it.
            auto_book_output_to_parent_mo(actor, reloaded)
          end

          Repo.preload(
            Backend.Stock.get_for_company(actor.company_id, lot_uuid),
            [:item]
          )
        else
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    else
      nil -> {:error, :lot_not_found}
      %StockLot{} -> {:error, :not_a_manufactured_lot}
    end
  end

  # Apply any QC-time corrections to the lot before recording the
  # pass event. Skipped for fail / partial-fail (those paths own
  # their own qty math via split). Only runs when the attrs actually
  # carry an adjustment — bare {"pass", reason: nil} stays a no-op.
  defp maybe_apply_qc_adjustments(_actor, _lot, "qc_failed", _attrs), do: :ok

  defp maybe_apply_qc_adjustments(%User{} = actor, %StockLot{} = lot, kind, attrs)
       when kind in ["qc_passed", "output_qc_passed"] do
    cast_attrs = stock_lot_adjust_attrs(attrs)

    if cast_attrs == %{} do
      :ok
    else
      apply_qc_adjustments(actor, lot, cast_attrs, attrs)
    end
  end

  # Pluck the editable QC fields out of the request attrs. Returns
  # only the keys the operator actually sent so partial edits work
  # — e.g. correcting just the weight without resetting dims.
  defp stock_lot_adjust_attrs(attrs) do
    [
      "qty_received",
      "package_length_mm",
      "package_width_mm",
      "package_height_mm",
      "package_weight_kg",
      "units_per_package",
      "stack_factor"
    ]
    |> Enum.reduce(%{}, fn key, acc ->
      raw = Map.get(attrs, key) || Map.get(attrs, String.to_existing_atom(key))

      if raw in [nil, ""], do: acc, else: Map.put(acc, key, raw)
    end)
  end

  defp apply_qc_adjustments(%User{} = actor, %StockLot{} = lot, cast_attrs, raw_attrs) do
    before_lot = lot

    with {:ok, updated_lot} <-
           lot
           |> Backend.Stock.Lot.changeset(
             Map.put(cast_attrs, "updated_by_id", actor.id)
           )
           |> Repo.update(),
         :ok <-
           maybe_emit_qc_qty_movement(actor, before_lot, updated_lot, raw_attrs) do
      Audit.record_updated(
        actor,
        "stock_lot",
        updated_lot,
        %{
          qty_received: before_lot.qty_received,
          package_length_mm: before_lot.package_length_mm,
          package_width_mm: before_lot.package_width_mm,
          package_height_mm: before_lot.package_height_mm,
          package_weight_kg: before_lot.package_weight_kg,
          units_per_package: before_lot.units_per_package,
          stack_factor: before_lot.stack_factor
        },
        %{
          qty_received: updated_lot.qty_received,
          package_length_mm: updated_lot.package_length_mm,
          package_width_mm: updated_lot.package_width_mm,
          package_height_mm: updated_lot.package_height_mm,
          package_weight_kg: updated_lot.package_weight_kg,
          units_per_package: updated_lot.units_per_package,
          stack_factor: updated_lot.stack_factor
        }
      )

      :ok
    end
  end

  # If qty_received changed, the corresponding placement at the
  # production-feed cell needs the same delta — and an adjust_up /
  # adjust_down Movement records why. Without this, a QC operator
  # bumping a 60 kg estimate to a measured 65 kg would mean 5 kg of
  # phantom stock with no audit trail. Mirrors the preflight-variance
  # flow on the booking side.
  defp maybe_emit_qc_qty_movement(actor, %StockLot{} = before_lot, %StockLot{} = updated_lot, attrs) do
    old_qty = before_lot.qty_received || Decimal.new(0)
    new_qty = updated_lot.qty_received || Decimal.new(0)
    delta = Decimal.sub(new_qty, old_qty)

    if Decimal.equal?(delta, Decimal.new(0)) do
      :ok
    else
      placement =
        from(p in Backend.Stock.Placement,
          where: p.stock_lot_id == ^updated_lot.id and p.qty > 0,
          order_by: [asc: p.id],
          limit: 1
        )
        |> Repo.one()

      case placement do
        nil ->
          # Nothing on-floor to reconcile (rare; lot might have been
          # split or moved). The lot row update + audit trail still
          # captures the correction; just no movement to emit.
          :ok

        %Backend.Stock.Placement{} = p ->
          new_placement_qty = Decimal.add(p.qty, delta)

          cond do
            Decimal.compare(new_placement_qty, Decimal.new(0)) == :lt ->
              {:error, :qc_adjustment_below_zero}

            true ->
              now_dt = now()
              reason = build_qc_adjustment_reason(old_qty, new_qty, attrs)
              kind = if Decimal.negative?(delta), do: "adjust_down", else: "adjust_up"

              with {:ok, movement} <-
                     %Backend.Stock.Movement{}
                     |> Backend.Stock.Movement.changeset(%{
                       "company_id" => updated_lot.company_id,
                       "stock_lot_id" => updated_lot.id,
                       "from_cell_id" =>
                         if(Decimal.negative?(delta), do: p.storage_cell_id),
                       "to_cell_id" =>
                         if(Decimal.negative?(delta), do: nil, else: p.storage_cell_id),
                       "delta_qty" => Decimal.abs(delta),
                       "kind" => kind,
                       "reason" => reason,
                       "actor_id" => actor.id,
                       "occurred_at" => now_dt,
                       "reference_kind" => "lifecycle_event",
                       "reference_ref" => updated_lot.uuid
                     })
                     |> Repo.insert(),
                   {:ok, _placement} <- adjust_placement_to(p, new_placement_qty) do
                Audit.record_created(actor, "stock_movement", movement, %{
                  kind: movement.kind,
                  delta_qty: movement.delta_qty,
                  reason: movement.reason
                })

                :ok
              end
          end
      end
    end
  end

  defp build_qc_adjustment_reason(old_qty, new_qty, attrs) do
    notes =
      case Map.get(attrs, "reason") || Map.get(attrs, :reason) do
        s when is_binary(s) and s != "" -> " — " <> String.trim(s)
        _ -> ""
      end

    "Output QC adjustment: measured #{decimal_to_string(new_qty)} vs production-recorded #{decimal_to_string(old_qty)}" <>
      notes
  end

  @doc """
  Self-healing chain: when a child MO's output lot lands in
  `available`, find the parent MO's BOM line waiting on this item
  and create a real lot booking that closes the gap. The booking is
  sized to `min(lot_free_qty, parent_line_shortage)` so we never
  over-book the parent or the lot.

  Without this hook the parent's line stayed at "Not booked" even
  though the child had just delivered the missing qty — the planner
  had to spot the gap and manually book the new lot. Public so a
  one-off backfill can re-run it for lots that passed QC before the
  hook landed.
  """
  def auto_book_output_to_parent_mo(%User{} = actor, %StockLot{} = lot) do
    with %ManufacturingOrder{} = child_mo <-
           Repo.get_by(ManufacturingOrder,
             company_id: actor.company_id,
             uuid: lot.source_ref
           ),
         parent_id when is_integer(parent_id) <- child_mo.parent_mo_id,
         %ManufacturingOrder{} = parent_mo <-
           Repo.get(ManufacturingOrder, parent_id) do
      parent_mo =
        Repo.preload(parent_mo, [:bookings, bom: [lines: :part]])

      # The parent's shortage on this item, minus what's already
      # booked from real lots. If the planner already booked the
      # missing qty against another lot in the meantime, this is
      # zero and we no-op.
      shortage = parent_line_shortage(parent_mo, lot.item_id)
      free = lot_free_qty(lot)

      qty_to_book =
        cond do
          Decimal.compare(shortage, Decimal.new(0)) != :gt -> Decimal.new(0)
          Decimal.compare(free, Decimal.new(0)) != :gt -> Decimal.new(0)
          Decimal.compare(shortage, free) == :gt -> free
          true -> shortage
        end

      if Decimal.compare(qty_to_book, Decimal.new(0)) == :gt do
        create_auto_child_booking(actor, parent_mo, lot, qty_to_book)
      else
        :ok
      end
    else
      _ -> :ok
    end
  end

  defp parent_line_shortage(%ManufacturingOrder{} = parent_mo, item_id) do
    mo_qty = parent_mo.quantity || Decimal.new(0)

    line =
      case parent_mo.bom do
        %BOM{lines: lines} when is_list(lines) ->
          Enum.find(lines, fn l -> l.part_id == item_id end)

        _ ->
          nil
      end

    case line do
      nil ->
        Decimal.new(0)

      l ->
        required =
          if l.is_fixed do
            l.qty || Decimal.new(0)
          else
            Decimal.mult(l.qty || Decimal.new(0), mo_qty)
          end

        booked =
          parent_mo.bookings
          |> Enum.filter(fn b ->
            b.item_id == item_id and b.status == "requested" and
              not is_nil(b.stock_lot_id)
          end)
          |> Enum.reduce(Decimal.new(0), fn b, acc ->
            Decimal.add(acc, b.quantity || Decimal.new(0))
          end)

        Decimal.sub(required, booked)
    end
  end

  defp create_auto_child_booking(%User{} = actor, %ManufacturingOrder{} = parent_mo, %StockLot{} = lot, qty) do
    attrs = %{
      "company_id" => parent_mo.company_id,
      "manufacturing_order_id" => parent_mo.id,
      "item_id" => lot.item_id,
      "stock_lot_id" => lot.id,
      "quantity" => qty,
      "status" => "requested",
      "created_by_id" => actor.id,
      "updated_by_id" => actor.id
    }

    %ManufacturingOrderBooking{}
    |> ManufacturingOrderBooking.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, _booking} -> :ok
      # Don't bubble the failure — auto-booking is a best-effort
      # convenience. If it fails (e.g. integrity hiccup) the planner
      # can still manually book the lot; the "Awaiting child output"
      # banner will stay until they do.
      {:error, _cs} -> :ok
    end
  end

  # When a lot fails QC, every open MO that booked it as an input
  # gets `needs_replan = true` with a reason. Doesn't touch the MO's
  # status — the planner still owns the regression decision (unrelease
  # / amend / spawn another child). The flag is the signal that the
  # current plan no longer works.
  defp propagate_replan_to_consumers(%User{} = actor, %StockLot{} = failed_lot) do
    affected_mos =
      from(b in ManufacturingOrderBooking,
        join: m in ManufacturingOrder,
        on: m.id == b.manufacturing_order_id,
        where:
          b.stock_lot_id == ^failed_lot.id and
            b.status == "requested" and
            m.status not in ["completed", "cancelled"],
        select: m
      )
      |> Repo.all()

    reason =
      "Booked lot " <>
        (failed_lot.supplier_batch_no || "##{failed_lot.id}") <>
        " failed QC. Re-book a replacement lot or spawn another child MO."

    Enum.each(affected_mos, fn mo ->
      mark_needs_replan(actor, mo, reason)
    end)

    :ok
  end

  # Partial fail: split the lot into two. Child carries the rejected
  # qty + status=qc_failed; parent's qty drops by that amount and it
  # stays in `received` so the operator can pass / fail the remainder
  # separately. Repackaging is mandatory — both lots get new physical
  # dimensions captured at split time.
  #
  # Required attrs:
  #   * reject_qty (validated upstream — already a positive Decimal less than parent qty)
  #   * reason (free text)
  #   * parent_packaging — %{length_mm, width_mm, height_mm, weight_kg, stack_factor}
  #   * child_packaging  — same shape
  defp do_partial_fail(%User{} = actor, %StockLot{} = parent, reject_qty, attrs) do
    with {:ok, parent_pkg} <- parse_partial_pkg(attrs["parent_packaging"]),
         {:ok, child_pkg} <- parse_partial_pkg(attrs["child_packaging"]),
         {:ok, parent_placement} <- locate_parent_placement(parent) do
      reason = attrs["reason"] || attrs[:reason]
      remainder = Decimal.sub(parent.qty_received, reject_qty)

      Repo.transaction(fn ->
        with {:ok, parent_updated} <- shrink_parent_lot(actor, parent, remainder, parent_pkg),
             {:ok, _shrunk_placement} <-
               shrink_parent_placement(actor, parent_placement, remainder),
             {:ok, child_lot} <-
               insert_child_failed_lot(actor, parent, reject_qty, child_pkg),
             {:ok, _child_placement} <-
               insert_child_placement(actor, child_lot, parent_placement.storage_cell_id, reject_qty),
             # Every kg crossing a placement boundary needs a
             # Movement audit row. The parent shrinks → emit
             # adjust_down. The child appears at the same cell →
             # emit `receive` (rejected-lot genesis). Without these
             # the lot history view can't explain "where did 40 kg of
             # lot #123 go" / "where did lot #125 come from".
             {:ok, _parent_mvmt} <-
               emit_partial_fail_parent_movement(
                 actor,
                 parent,
                 parent_placement,
                 reject_qty,
                 child_lot,
                 reason
               ),
             {:ok, _child_mvmt} <-
               emit_partial_fail_child_movement(
                 actor,
                 child_lot,
                 parent,
                 parent_placement.storage_cell_id,
                 reject_qty,
                 reason
               ),
             {:ok, _event} <-
               record_partial_fail_event(actor, parent, child_lot, reject_qty, reason) do
          %{parent: parent_updated, child: child_lot}
        else
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
      |> case do
        {:ok, %{parent: parent_updated}} ->
          {:ok, Repo.preload(parent_updated, [:item])}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp parse_partial_pkg(input) when is_map(input) do
    int_fields = ~w(length_mm width_mm height_mm stack_factor)
    decimal_fields = ~w(weight_kg)

    with {:ok, ints} <-
           parse_pack_fields(input, int_fields, &parse_positive_integer/1),
         {:ok, decs} <-
           parse_pack_fields(input, decimal_fields, &parse_positive_decimal/1) do
      {:ok, Map.merge(ints, decs)}
    end
  end

  defp parse_partial_pkg(_), do: {:error, :missing_partial_packaging}

  defp locate_parent_placement(%StockLot{id: lot_id}) do
    case Repo.all(
           from p in Backend.Stock.Placement,
             where: p.stock_lot_id == ^lot_id and p.qty > 0,
             limit: 2
         ) do
      [placement] -> {:ok, placement}
      [] -> {:error, :no_active_placement}
      _ -> {:error, :ambiguous_placement}
    end
  end

  defp shrink_parent_lot(%User{} = actor, %StockLot{} = parent, new_qty, pkg) do
    before_attrs = %{
      qty_received: parent.qty_received,
      package_length_mm: parent.package_length_mm,
      package_width_mm: parent.package_width_mm,
      package_height_mm: parent.package_height_mm,
      package_weight_kg: parent.package_weight_kg,
      stack_factor: parent.stack_factor,
      units_per_package: parent.units_per_package
    }

    parent
    |> StockLot.changeset(%{
      "qty_received" => new_qty,
      "package_length_mm" => pkg["length_mm"],
      "package_width_mm" => pkg["width_mm"],
      "package_height_mm" => pkg["height_mm"],
      "package_weight_kg" => pkg["weight_kg"],
      "stack_factor" => pkg["stack_factor"],
      # Keep `units_per_package = qty` so the volume math stays at 1
      # package per lot — same invariant as the original Finish flow.
      "units_per_package" => new_qty,
      "updated_by_id" => actor.id
    })
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "stock_lot",
          updated,
          before_attrs,
          %{
            qty_received: updated.qty_received,
            package_length_mm: updated.package_length_mm,
            package_width_mm: updated.package_width_mm,
            package_height_mm: updated.package_height_mm,
            package_weight_kg: updated.package_weight_kg,
            stack_factor: updated.stack_factor,
            units_per_package: updated.units_per_package
          }
        )

        {:ok, updated}

      err ->
        err
    end
  end

  defp shrink_parent_placement(%User{} = _actor, %Backend.Stock.Placement{} = placement, new_qty) do
    placement
    |> Backend.Stock.Placement.changeset(%{"qty" => new_qty})
    |> Repo.update()
  end

  # Child inherits item / UoM / source from the parent so traceability
  # back to the MO is preserved. Inserts at `received` first because
  # the lifecycle's `qc_failed` event needs a transition source —
  # then the caller flips it via `record_partial_fail_event` so the
  # status projects to `rejected` through the same code path the full-
  # lot fail uses. (The schema's status enum has `rejected`, not
  # `qc_failed` — that's an event kind.)
  defp insert_child_failed_lot(%User{} = actor, %StockLot{} = parent, qty, pkg) do
    %StockLot{}
    |> StockLot.changeset(%{
      "company_id" => parent.company_id,
      "item_id" => parent.item_id,
      "unit_of_measurement_id" => parent.unit_of_measurement_id,
      "qty_received" => qty,
      "status" => "received",
      "source_kind" => parent.source_kind,
      "source_ref" => parent.source_ref,
      "received_at" => parent.received_at,
      "manufactured_at" => parent.manufactured_at,
      "expiry_at" => parent.expiry_at,
      "package_length_mm" => pkg["length_mm"],
      "package_width_mm" => pkg["width_mm"],
      "package_height_mm" => pkg["height_mm"],
      "package_weight_kg" => pkg["weight_kg"],
      "stack_factor" => pkg["stack_factor"],
      "units_per_package" => qty,
      "created_by_id" => actor.id,
      "updated_by_id" => actor.id
    })
    |> Repo.insert()
    |> case do
      {:ok, child} ->
        Audit.record_created(actor, "stock_lot", child, %{
          item_id: child.item_id,
          qty_received: child.qty_received,
          status: child.status,
          source_kind: child.source_kind,
          source_ref: child.source_ref,
          split_from_lot_id: parent.id
        })

        {:ok, child}

      err ->
        err
    end
  end

  defp insert_child_placement(_actor, %StockLot{} = child, cell_id, qty) do
    %Backend.Stock.Placement{}
    |> Backend.Stock.Placement.changeset(%{
      "company_id" => child.company_id,
      "stock_lot_id" => child.id,
      "storage_cell_id" => cell_id,
      "qty" => qty
    })
    |> Repo.insert()
  end

  # Partial QC fail emits two paired Movement rows so the lot history
  # for both parent and child explains the split:
  #
  #   - parent: `adjust_down` of `reject_qty` from the storage cell.
  #     Reason text references the child lot uuid so auditors can
  #     follow the split forward.
  #   - child:  `receive` of `reject_qty` at the same cell.
  #     Reason text references the parent lot uuid so the child's
  #     genesis is traceable backward.
  defp emit_partial_fail_parent_movement(
         actor,
         %StockLot{} = parent,
         %Backend.Stock.Placement{} = parent_placement,
         reject_qty,
         %StockLot{} = child,
         reason_input
       ) do
    now_dt = now()
    reason = build_partial_fail_reason(:parent, reject_qty, child, reason_input)

    %Backend.Stock.Movement{}
    |> Backend.Stock.Movement.changeset(%{
      "company_id" => parent.company_id,
      "stock_lot_id" => parent.id,
      "from_cell_id" => parent_placement.storage_cell_id,
      "to_cell_id" => nil,
      "delta_qty" => reject_qty,
      "kind" => "adjust_down",
      "reason" => reason,
      "actor_id" => actor.id,
      "occurred_at" => now_dt,
      "reference_kind" => "lifecycle_event",
      "reference_ref" => child.uuid
    })
    |> Repo.insert()
    |> case do
      {:ok, movement} ->
        Audit.record_created(actor, "stock_movement", movement, %{
          kind: movement.kind,
          delta_qty: movement.delta_qty,
          from_cell_id: movement.from_cell_id,
          reason: movement.reason,
          reference_kind: movement.reference_kind,
          reference_ref: movement.reference_ref
        })

        {:ok, movement}

      err ->
        err
    end
  end

  defp emit_partial_fail_child_movement(
         actor,
         %StockLot{} = child,
         %StockLot{} = parent,
         cell_id,
         reject_qty,
         reason_input
       ) do
    now_dt = now()
    reason = build_partial_fail_reason(:child, reject_qty, parent, reason_input)

    %Backend.Stock.Movement{}
    |> Backend.Stock.Movement.changeset(%{
      "company_id" => child.company_id,
      "stock_lot_id" => child.id,
      "from_cell_id" => nil,
      "to_cell_id" => cell_id,
      "delta_qty" => reject_qty,
      "kind" => "receive",
      "reason" => reason,
      "actor_id" => actor.id,
      "occurred_at" => now_dt,
      "reference_kind" => "lifecycle_event",
      "reference_ref" => parent.uuid
    })
    |> Repo.insert()
    |> case do
      {:ok, movement} ->
        Audit.record_created(actor, "stock_movement", movement, %{
          kind: movement.kind,
          delta_qty: movement.delta_qty,
          to_cell_id: movement.to_cell_id,
          reason: movement.reason,
          reference_kind: movement.reference_kind,
          reference_ref: movement.reference_ref
        })

        {:ok, movement}

      err ->
        err
    end
  end

  defp build_partial_fail_reason(side, reject_qty, %StockLot{} = other, reason_input) do
    qty_str = decimal_to_string(reject_qty)
    other_label = other.uuid

    base =
      case side do
        :parent -> "QC partial fail: split off #{qty_str} into rejected lot #{other_label}"
        :child -> "QC partial fail: split from parent lot #{other_label} (#{qty_str} rejected)"
      end

    case reason_input do
      s when is_binary(s) and s != "" -> base <> " — " <> String.trim(s)
      _ -> base
    end
  end

  # Emit a `qc_failed` lifecycle event AGAINST THE CHILD lot (not the
  # parent — parent is still `received`). This is the audit-trail row
  # that the lot history view will surface ("Failed QC at 14:32 by …,
  # reason: contamination").
  defp record_partial_fail_event(%User{} = actor, %StockLot{} = parent, %StockLot{} = child, reject_qty, reason) do
    Backend.Stock.Lifecycle.record_event(child, "qc_failed", %{
      actor: actor,
      actor_kind: "user",
      reason: reason,
      metadata: %{
        "split_from_lot_id" => parent.id,
        "split_from_lot_uuid" => parent.uuid,
        "reject_qty" => Decimal.to_string(reject_qty)
      }
    })
  end

  # ----- Production closeout (post-Finish hand-off) --------------

  @doc """
  Does `lot_id` sit on the ingredient side of a booking on a live MO?

  "Live" = the consuming MO's status isn't `cancelled` AND the booking
  is still `requested` (not consumed / released). Used by:

    * `sign_off_output_qc/4` to decide `qc_passed` (sub-MO output the
      parent will eat) vs `output_qc_passed` (top-of-tree output that
      owes a Final Product Release before dispatch).
    * `list_closeout_queue/1` to drop sub-MOs whose only remaining
      output is already claimed by the parent (mirrors the shape as
      an inline subquery — see the `committed_lot_ids` subquery
      there).
    * `Backend.OrderWizard.lot_with_placement/2`'s `committed?`
      filter that hides those lots from the "output at feed" count on
      the projects board (mirrored inline for the same reason).

  Scalar helper (`true / false` for one lot) — callers that need a
  MapSet across many lots keep their inline subquery for now to avoid
  N+1 in list loops.
  """
  def lot_committed_to_downstream_mo?(company_id, lot_id)
      when is_integer(company_id) and is_integer(lot_id) do
    from(b in ManufacturingOrderBooking,
      join: mo in ManufacturingOrder,
      on: mo.id == b.manufacturing_order_id,
      where:
        b.stock_lot_id == ^lot_id and
          b.status == "requested" and
          mo.status != "cancelled" and
          mo.company_id == ^company_id,
      limit: 1,
      select: 1
    )
    |> Repo.one()
    |> case do
      nil -> false
      _ -> true
    end
  end

  @doc """
  Mobile closeout queue. Returns MOs that are `completed` and still
  have at least one open closeout-item — either a booking whose
  `consumed_at` is null OR a produced output lot still placed at the
  production-feed cell with status=available.
  """
  def list_closeout_queue(company_id) when is_integer(company_id) do
    open_booking_mos =
      from(b in ManufacturingOrderBooking,
        join: it in Item,
        on: it.id == b.item_id,
        where:
          b.status == "requested" and
            it.item_type in ["raw_material", "packaging", "semi_finished", "consumable"] and
            is_nil(b.consumed_at),
        select: b.manufacturing_order_id,
        distinct: true
      )

    # Output lots already reserved as ingredients by a live downstream
    # MO — the parent MO's closeout will consume them from the feed
    # cell directly, so the sub-MO doesn't owe closeout work for those
    # outputs. Without this filter, every finished sub-MO whose parent
    # is still running lingers on the mobile queue as a phantom row.
    # Mirrors the wizard's `committed?` filter in
    # `Backend.OrderWizard.lot_with_placement/2`.
    committed_lot_ids =
      from(b in ManufacturingOrderBooking,
        join: dmo in ManufacturingOrder,
        on: dmo.id == b.manufacturing_order_id,
        where:
          not is_nil(b.stock_lot_id) and
            b.status == "requested" and
            dmo.status != "cancelled",
        select: b.stock_lot_id,
        distinct: true
      )

    # source_ref is varchar; m.uuid is uuid — cast to text on the
    # MO side so PG accepts the equality without an implicit
    # cross-type comparison error.
    output_at_feed =
      from(p in Backend.Stock.Placement,
        join: l in StockLot,
        on: l.id == p.stock_lot_id,
        join: m in ManufacturingOrder,
        on: fragment("?::text", m.uuid) == l.source_ref,
        where:
          l.company_id == ^company_id and
            l.source_kind == "manufacturing_order" and
            l.status == "available" and
            p.qty > 0 and
            p.storage_cell_id == m.production_cell_id and
            l.id not in subquery(committed_lot_ids),
        select: m.id,
        distinct: true
      )

    from(mo in ManufacturingOrder,
      where:
        mo.company_id == ^company_id and
          mo.status == "completed" and
          (mo.id in subquery(open_booking_mos) or mo.id in subquery(output_at_feed)),
      preload: [:item, :warehouse, :production_cell, steps: []],
      order_by: [asc: mo.actual_finish, asc: mo.id]
    )
    |> Repo.all()
  end

  @doc """
  Closeout-detail loader — booking rows that still need consuming +
  produced output lots still sitting at the production-feed cell.
  Refuses non-completed MOs.
  """
  def get_closeout_detail(company_id, mo_uuid)
      when is_integer(company_id) and is_binary(mo_uuid) do
    case get_manufacturing_order(company_id, mo_uuid) do
      nil ->
        nil

      %ManufacturingOrder{status: "completed"} = mo ->
        bookings =
          list_pickup_bookings(mo)
          |> Enum.filter(&is_nil(&1.consumed_at))

        output_lots = list_open_output_lots(mo)

        %{mo: mo, bookings: bookings, output_lots: output_lots}

      %ManufacturingOrder{} ->
        {:error, :not_completed}
    end
  end

  defp list_open_output_lots(%ManufacturingOrder{} = mo) do
    from(l in StockLot,
      join: p in Backend.Stock.Placement,
      on: p.stock_lot_id == l.id,
      where:
        l.company_id == ^mo.company_id and
          l.source_kind == "manufacturing_order" and
          l.source_ref == ^mo.uuid and
          l.status == "available" and
          p.qty > 0 and
          p.storage_cell_id == ^mo.production_cell_id,
      preload: [
        item: :stock_uom,
        unit_of_measurement: [],
        placements: [storage_cell: [storage_location: [floor: [:warehouse]]]]
      ],
      distinct: true
    )
    |> Repo.all()
  end

  @doc """
  Empty production-side dispatch cells the FE picks the destination
  from. Filters on the MO's production facility so an MO running on
  Unit 11 doesn't accidentally hand off to Unit 12's dispatch lane.
  """
  def list_dispatch_cells_for_mo(company_id, mo_uuid)
      when is_integer(company_id) and is_binary(mo_uuid) do
    case get_manufacturing_order(company_id, mo_uuid) do
      %ManufacturingOrder{warehouse_id: warehouse_id}
      when is_integer(warehouse_id) ->
        from(c in Backend.Warehouses.StorageCell,
          join: l in Backend.Warehouses.StorageLocation,
          on: l.id == c.storage_location_id,
          join: f in Backend.Warehouses.Floor,
          on: f.id == l.floor_id,
          where:
            c.company_id == ^company_id and
              c.purpose == "dispatch" and
              f.warehouse_id == ^warehouse_id,
          preload: [storage_location: [floor: [:warehouse]]],
          order_by: [asc: l.code, asc: c.ordinal]
        )
        |> Repo.all()

      _ ->
        []
    end
  end

  @doc """
  Production-worker action — close out one booking. Stamps
  `consumed_at` + `consumed_quantity` + flips `status` to `consumed`,
  drops the production-feed placement, and (if any qty remains)
  moves the remainder to the operator-scanned dispatch cell via a
  `move` Stock.Movement carrying the photo URL.

  Required attrs:
    * `remaining_qty` (decimal ≥ 0; default 0 = fully consumed)
    * `scanned_cell_uuid` — production-dispatch cell uuid the
      operator scanned, REQUIRED when remaining_qty > 0
    * `photo_url` — optional but recommended (move-flow convention)
  """
  def closeout_booking(%User{} = actor, %ManufacturingOrderBooking{} = booking, attrs) do
    # Closeout model (operator's mental model on the floor):
    #   * The lot's whole drum/bag is at production. `qty_on_hand` is
    #     what the operator can physically weigh post-run.
    #   * They type "remaining" — the post-run weight of what's left.
    #   * Consumption = on_hand − remaining (computed; can exceed
    #     `booking.quantity` when spillage / recipe overage was real).
    # The cap is the lot's on-hand at closeout start, NOT the booked
    # qty — booking is the planned amount, not a ceiling on actual use.
    on_hand = lot_on_hand(booking.stock_lot_id)

    with :ok <- ensure_booking_not_closed(booking),
         :ok <- ensure_output_qc_done(booking),
         {:ok, remaining} <- parse_remaining_qty(attrs, on_hand),
         consumed = Decimal.sub(on_hand, remaining),
         :ok <- ensure_photo_or_skip(attrs),
         {:ok, dest_cell} <-
           maybe_resolve_dispatch_cell(actor.company_id, attrs, remaining) do
      photo_meta = %{
        "photo_url" => attrs["photo_url"],
        "skip_photo_reason" => attrs["skip_photo_reason"]
      }

      result =
        Repo.transaction(fn ->
          with {:ok, updated_booking} <-
                 stamp_booking_consumed(actor, booking, consumed),
               :ok <-
                 apply_booking_movement(
                   actor,
                   booking,
                   consumed,
                   remaining,
                   dest_cell,
                   photo_meta
                 ) do
            updated_booking
          else
            {:error, reason} -> Repo.rollback(reason)
          end
        end)

      # POST-COMMIT cascade. Spillage closeouts can drain a lot's
      # warehouse placement past what was booked, leaving downstream
      # MOs over-allocated. Walk affected lots and demote any MO
      # whose bookings now exceed reality back to a re-plannable
      # state (see `revalidate_bookings_for_lot/3`). Best-effort —
      # the closeout itself already succeeded; this is housekeeping.
      case result do
        {:ok, _} = ok ->
          # Drained lots = the booking's stock_lot for sure; if drain
          # spilled into other warehouse cells those still belong to
          # the same lot, so one revalidation call covers it.
          revalidate_bookings_for_lot(
            actor,
            booking.stock_lot_id,
            "Closeout of MO booking " <>
              (booking.uuid || "") <> " consumed #{decimal_to_string(consumed)}"
          )

          ok

        err ->
          err
      end
    end
  end

  # Mirror return-pickup's photo gate (BRCGS / FSSC traceability):
  # every closeout movement carries either a photo OR an attributable
  # skip-reason. UI gates the submit CTA, but the BE keeps the same
  # invariant so a curl can't slip a blank movement through.
  defp ensure_photo_or_skip(attrs) do
    photo = attrs["photo_url"]
    reason = attrs["skip_photo_reason"]

    cond do
      is_binary(photo) and photo != "" -> :ok
      is_binary(reason) and reason != "" -> :ok
      true -> {:error, :photo_or_skip_required}
    end
  end

  defp lot_on_hand(lot_id) do
    from(p in Backend.Stock.Placement, where: p.stock_lot_id == ^lot_id, select: sum(p.qty))
    |> Repo.one()
    |> case do
      nil -> Decimal.new(0)
      %Decimal{} = d -> d
    end
  end

  defp ensure_booking_not_closed(%ManufacturingOrderBooking{consumed_at: nil}), do: :ok
  defp ensure_booking_not_closed(_), do: {:error, :already_closed}

  # Compliance gate (BRCGS 3.5.1 / FSSC 22000): booking-level closeout
  # records what was consumed AND routes leftover ingredients to a
  # dispatch cell. Both side-effects should wait until the QC operator
  # has signed off the manufactured output — closing out the ingredient
  # paperwork before the verdict on the finished product is in lets
  # operators sign off batches whose outputs might later be rejected.
  #
  # Refuses when any output lot tied to this booking's MO is still
  # in `status = received` (i.e. waiting for `sign_off_output_qc`).
  defp ensure_output_qc_done(%ManufacturingOrderBooking{manufacturing_order_id: mo_id}) do
    case Repo.get(ManufacturingOrder, mo_id) do
      %ManufacturingOrder{uuid: mo_uuid} ->
        pending =
          from(l in StockLot,
            where:
              l.source_kind == "manufacturing_order" and
                l.source_ref == ^mo_uuid and
                l.status == "received",
            select: count(l.id)
          )
          |> Repo.one()

        if pending && pending > 0,
          do: {:error, :output_qc_pending},
          else: :ok

      _ ->
        :ok
    end
  end

  defp parse_remaining_qty(attrs, on_hand) do
    raw = attrs["remaining_qty"] || attrs[:remaining_qty]

    case raw do
      nil -> {:ok, Decimal.new(0)}
      "" -> {:ok, Decimal.new(0)}
      _ -> parse_non_negative_decimal_in_range(raw, on_hand)
    end
  end

  defp parse_non_negative_decimal_in_range(raw, max) do
    case parse_non_negative_decimal(raw) do
      {:ok, d} ->
        if Decimal.compare(d, max) == :gt do
          {:error, :remaining_exceeds_on_hand}
        else
          {:ok, d}
        end

      :error ->
        {:error, :bad_remaining_qty}
    end
  end

  defp parse_non_negative_decimal(%Decimal{} = d) do
    if Decimal.compare(d, Decimal.new("0")) in [:gt, :eq], do: {:ok, d}, else: :error
  end

  defp parse_non_negative_decimal(n) when is_integer(n) and n >= 0,
    do: {:ok, Decimal.new(n)}

  defp parse_non_negative_decimal(n) when is_float(n) and n >= 0,
    do: {:ok, Decimal.from_float(n)}

  defp parse_non_negative_decimal(s) when is_binary(s) do
    case Decimal.parse(s) do
      {d, ""} -> parse_non_negative_decimal(d)
      _ -> :error
    end
  end

  defp parse_non_negative_decimal(_), do: :error

  # When the operator's leaving 0 behind, no destination is needed —
  # the placement just drops to 0. Anything > 0 must land in a real,
  # dispatch-purpose cell.
  defp maybe_resolve_dispatch_cell(_company_id, _attrs, %Decimal{coef: 0}), do: {:ok, nil}

  defp maybe_resolve_dispatch_cell(company_id, attrs, _remaining) do
    case attrs["scanned_cell_uuid"] || attrs[:scanned_cell_uuid] do
      uuid when is_binary(uuid) and byte_size(uuid) > 0 ->
        case Repo.get_by(Backend.Warehouses.StorageCell, uuid: uuid, company_id: company_id) do
          %Backend.Warehouses.StorageCell{purpose: "dispatch"} = cell -> {:ok, cell}
          %Backend.Warehouses.StorageCell{} -> {:error, :dispatch_cell_required}
          _ -> {:error, :cell_not_found}
        end

      _ ->
        {:error, :missing_dispatch_cell}
    end
  end

  defp stamp_booking_consumed(%User{} = actor, %ManufacturingOrderBooking{} = booking, consumed) do
    before = booking_snapshot(booking)

    booking
    |> ManufacturingOrderBooking.changeset(%{
      "consumed_quantity" => consumed,
      "consumed_at" => now(),
      "consumed_by_id" => actor.id,
      "status" => "consumed",
      "updated_by_id" => actor.id
    })
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

        {:ok, updated}

      err ->
        err
    end
  end

  # Closeout model — the operator types "remaining" (post-run lot
  # weight); the system back-computes `consumed = on_hand - remaining`
  # and reshapes the lot's placements to match. Algorithm:
  #
  #   1. Drain feed-cell placement by min(consumed, feed_qty) via a
  #      `consume` Stock.Movement (so the floor's usage is visible in
  #      the lot's audit trail — BRCGS 3.5.1 / FSSC 22000).
  #   2. If consumed > feed_qty (spillage exceeded what was sitting at
  #      the feed cell), continue draining other placements
  #      (FIFO by id) until the full consumption is accounted for.
  #   3. Any feed-cell qty still left after step 1 moves to the
  #      scanned dispatch cell via `Stock.move_placement` (reuses
  #      the existing move + audit + photo plumbing).
  defp apply_booking_movement(
         %User{} = actor,
         %ManufacturingOrderBooking{} = booking,
         consumed,
         remaining,
         dest_cell,
         photo_meta
       ) do
    lot = Repo.get!(StockLot, booking.stock_lot_id)
    mo = Repo.get!(ManufacturingOrder, booking.manufacturing_order_id)
    feed_placement = locate_production_feed_placement(lot, mo.production_cell_id)

    feed_qty =
      case feed_placement do
        %Backend.Stock.Placement{qty: q} -> q
        nil -> Decimal.new(0)
      end

    feed_drain = decimal_min(consumed, feed_qty)
    extra_drain = Decimal.sub(consumed, feed_drain)
    feed_leftover = Decimal.sub(feed_qty, feed_drain)

    # Reason text shared across every consume movement emitted by this
    # closeout — the auditor sees the booked/overage breakdown on each
    # row in the lot's history, not just one. Without an overage:
    #   "MO closeout: consumed X (booked Y)"
    # With overage:
    #   "MO closeout: consumed X (booked Y + overage Z)"
    consume_reason = closeout_consume_reason(booking.quantity, consumed)

    with :ok <-
           drain_feed_for_closeout(
             actor,
             booking,
             feed_placement,
             feed_drain,
             feed_leftover,
             photo_meta,
             consume_reason
           ),
         :ok <-
           drain_extra_for_closeout(
             actor,
             booking,
             lot,
             mo,
             extra_drain,
             photo_meta,
             consume_reason
           ),
         :ok <-
           move_feed_leftover_to_dispatch(
             actor,
             booking,
             lot,
             feed_placement,
             feed_leftover,
             remaining,
             dest_cell,
             photo_meta
           ) do
      :ok
    end
  end

  defp decimal_min(a, b), do: if(Decimal.compare(a, b) == :gt, do: b, else: a)

  # Build the reason text the closeout flow stamps on every consume
  # movement. Surfaces `booked + overage` in the lot's audit history
  # so the auditor can see at a glance when production drew more
  # than the recipe reserved — without that breakdown, two near-
  # identical "consumed X" rows hide the variance.
  defp closeout_consume_reason(booked, consumed) do
    overage = Decimal.sub(consumed, booked)

    if Decimal.compare(overage, Decimal.new(0)) == :gt do
      "MO closeout: consumed #{decimal_to_string(consumed)} " <>
        "(booked #{decimal_to_string(booked)} + overage #{decimal_to_string(overage)})"
    else
      "MO closeout: consumed #{decimal_to_string(consumed)} " <>
        "(booked #{decimal_to_string(booked)})"
    end
  end

  # Drain the feed placement by `feed_drain`. When the drain consumes
  # the whole feed placement AND nothing's heading to dispatch (i.e.
  # feed_leftover = 0), delete the placement row; otherwise just
  # decrement so the leftover can subsequently move to dispatch.
  defp drain_feed_for_closeout(_actor, _booking, nil, _drain, _leftover, _photo, _reason), do: :ok

  defp drain_feed_for_closeout(actor, booking, placement, drain, leftover, photo_meta, reason) do
    case Decimal.compare(drain, Decimal.new(0)) do
      :eq ->
        :ok

      _ ->
        if Decimal.compare(leftover, Decimal.new(0)) == :eq do
          # Whole feed placement evaporates → consume + delete row
          # (matches the prior full-consumption path).
          emit_consume_movement(actor, booking, placement, drain, photo_meta, reason)
        else
          # Partial consume — keep the row, just decrement it.
          emit_partial_consume_movement(actor, booking, placement, drain, photo_meta, reason)
        end
    end
  end

  # Spillage case: consumed exceeded what was at the feed cell. Walk
  # the lot's other non-zero placements (FIFO by id) and drain them
  # too, emitting a separate `consume` movement per placement so the
  # audit trail names where the extra stock came from.
  defp drain_extra_for_closeout(_actor, _booking, _lot, _mo, %Decimal{coef: 0}, _photo, _reason),
    do: :ok

  defp drain_extra_for_closeout(actor, booking, lot, mo, remaining_to_drain, photo_meta, reason) do
    placements =
      from(p in Backend.Stock.Placement,
        where:
          p.stock_lot_id == ^lot.id and p.qty > 0 and
            p.storage_cell_id != ^mo.production_cell_id,
        order_by: [asc: p.id],
        preload: [:storage_cell]
      )
      |> Repo.all()

    do_drain_extra(actor, booking, placements, remaining_to_drain, photo_meta, reason)
  end

  defp do_drain_extra(_actor, _booking, _placements, %Decimal{coef: 0}, _photo, _reason), do: :ok

  defp do_drain_extra(_actor, _booking, [], _remaining, _photo, _reason),
    do: {:error, :insufficient_stock}

  defp do_drain_extra(actor, booking, [p | rest], remaining_to_drain, photo_meta, reason) do
    take = decimal_min(remaining_to_drain, p.qty)

    with :ok <-
           if(Decimal.compare(take, p.qty) == :eq,
             do: emit_consume_movement(actor, booking, p, take, photo_meta, reason),
             else: emit_partial_consume_movement(actor, booking, p, take, photo_meta, reason)
           ),
         next = Decimal.sub(remaining_to_drain, take) do
      do_drain_extra(actor, booking, rest, next, photo_meta, reason)
    end
  end

  defp move_feed_leftover_to_dispatch(
         actor,
         booking,
         lot,
         feed_placement,
         feed_leftover,
         _remaining,
         dest_cell,
         photo_meta
       ) do
    cond do
      feed_placement == nil ->
        :ok

      Decimal.compare(feed_leftover, Decimal.new(0)) == :eq ->
        :ok

      dest_cell == nil ->
        # Without a dispatch destination there's nowhere to send the
        # leftover. UI gates this (remaining > 0 ⇒ scan dispatch), so
        # reaching this branch means the request bypassed validation.
        {:error, :missing_dispatch_cell}

      true ->
        case Backend.Stock.move_placement(actor, lot.uuid, %{
               "from_cell_uuid" => feed_placement.storage_cell.uuid,
               "to_cell_uuid" => dest_cell.uuid,
               "qty" => Decimal.to_string(feed_leftover),
               "photo_url" => Map.get(photo_meta, "photo_url"),
               "skip_photo_reason" => Map.get(photo_meta, "skip_photo_reason"),
               "reference_kind" => "manufacturing_order",
               "reference_uuid" => booking.manufacturing_order_id
             }) do
          {:ok, _} -> :ok
          {:error, reason} -> {:error, {:move_failed, reason}}
        end
    end
  end

  # Mirror of Backend.Stock.write_adjusted_placement (which is private)
  # — keeps placement at qty > 0 or deletes it if the new qty is zero,
  # so the lot's footprint stays clean after partial consumes.
  defp closeout_write_placement(%Backend.Stock.Placement{} = p, new_qty) do
    if Decimal.equal?(new_qty, Decimal.new(0)) do
      case Repo.delete(p) do
        {:ok, _} -> {:ok, %Backend.Stock.Placement{p | qty: new_qty}}
        err -> err
      end
    else
      p
      |> Backend.Stock.Placement.changeset(%{"qty" => new_qty})
      |> Repo.update()
    end
  end

  # Partial consume — same shape as `emit_consume_movement` but
  # decrements the placement row (closeout_write_placement handles
  # deletion when qty reaches 0) instead of unconditionally deleting.
  defp emit_partial_consume_movement(actor, booking, placement, drain_qty, photo_meta, reason) do
    now_dt = now()

    movement_attrs = %{
      "company_id" => booking.company_id,
      "stock_lot_id" => booking.stock_lot_id,
      "from_cell_id" => placement.storage_cell_id,
      "to_cell_id" => nil,
      "delta_qty" => drain_qty,
      "kind" => "consume",
      "reason" => reason,
      "actor_id" => actor.id,
      "occurred_at" => now_dt,
      "photo_url" => Map.get(photo_meta, "photo_url"),
      "skip_photo_reason" => Map.get(photo_meta, "skip_photo_reason"),
      "reference_kind" => "manufacturing_order",
      "reference_ref" => mo_uuid_for_booking(booking)
    }

    new_qty = Decimal.sub(placement.qty, drain_qty)

    with {:ok, movement} <-
           %Backend.Stock.Movement{}
           |> Backend.Stock.Movement.changeset(movement_attrs)
           |> Repo.insert(),
         {:ok, _} <- closeout_write_placement(placement, new_qty) do
      Audit.record_created(actor, "stock_movement", movement, %{
        kind: movement.kind,
        delta_qty: movement.delta_qty,
        from_cell_id: movement.from_cell_id,
        to_cell_id: movement.to_cell_id,
        reason: movement.reason,
        reference_kind: movement.reference_kind,
        reference_ref: movement.reference_ref
      })

      :ok
    end
  end

  # Emit a `consume` Stock.Movement for the qty written off at the
  # production-feed cell, then delete the placement row. Used by the
  # closeout full-consume path so every kg leaving a cell crosses an
  # audit row (BRCGS 3.5.1 / FSSC 22000). Movement carries the
  # reference back to the booking + MO; reason text records the
  # operator's consumed_quantity.
  defp emit_consume_movement(actor, booking, placement, _consumed_qty, photo_meta, reason) do
    now_dt = now()

    movement_attrs = %{
      "company_id" => booking.company_id,
      "stock_lot_id" => booking.stock_lot_id,
      "from_cell_id" => placement.storage_cell_id,
      "to_cell_id" => nil,
      "delta_qty" => placement.qty,
      "kind" => "consume",
      "reason" => reason,
      "actor_id" => actor.id,
      "occurred_at" => now_dt,
      "photo_url" => Map.get(photo_meta, "photo_url"),
      "skip_photo_reason" => Map.get(photo_meta, "skip_photo_reason"),
      "reference_kind" => "manufacturing_order",
      "reference_ref" => mo_uuid_for_booking(booking)
    }

    with {:ok, movement} <-
           %Backend.Stock.Movement{}
           |> Backend.Stock.Movement.changeset(movement_attrs)
           |> Repo.insert(),
         {:ok, _deleted} <- Repo.delete(placement) do
      Audit.record_created(actor, "stock_movement", movement, %{
        kind: movement.kind,
        delta_qty: movement.delta_qty,
        from_cell_id: movement.from_cell_id,
        to_cell_id: movement.to_cell_id,
        reason: movement.reason,
        reference_kind: movement.reference_kind,
        reference_ref: movement.reference_ref
      })

      :ok
    end
  end

  # Looks up the lot's placement at the MO's production-feed cell.
  # Returns nil if no such placement exists or its qty is 0 — both
  # mean "nothing to move" and closeout treats that as a no-op.
  defp locate_production_feed_placement(_lot, nil), do: nil

  defp locate_production_feed_placement(%StockLot{id: lot_id}, production_cell_id) do
    case Repo.get_by(Backend.Stock.Placement,
           stock_lot_id: lot_id,
           storage_cell_id: production_cell_id
         ) do
      %Backend.Stock.Placement{qty: qty} = p ->
        if Decimal.compare(qty, Decimal.new(0)) == :gt do
          Repo.preload(p, :storage_cell)
        else
          nil
        end

      nil ->
        nil
    end
  end

  # Output lots are produced into a single placement at the MO's
  # production-feed cell, so we just pick the only non-zero
  # placement. No risk of confusing a warehouse-stored variant since
  # produced output lots are born here.
  defp locate_output_lot_placement(%StockLot{id: lot_id}) do
    from(p in Backend.Stock.Placement,
      where: p.stock_lot_id == ^lot_id and p.qty > 0,
      preload: [:storage_cell],
      limit: 1
    )
    |> Repo.one()
  end

  @doc """
  Move a produced output lot off the production-feed cell to a
  scanned production-dispatch cell. No consume here — production
  output isn't a booking, it's a fresh stock_lot the warehouse will
  pick up next.
  """
  def closeout_output_lot(%User{} = actor, lot_uuid, attrs)
      when is_binary(lot_uuid) and is_map(attrs) do
    with :ok <- ensure_photo_or_skip(attrs),
         %StockLot{status: "available", source_kind: "manufacturing_order"} = lot <-
           Backend.Stock.get_for_company(actor.company_id, lot_uuid),
         {:ok, dest_cell} <-
           maybe_resolve_dispatch_cell(actor.company_id, attrs, Decimal.new(1)),
         placement when not is_nil(placement) <- locate_output_lot_placement(lot) do
      case Backend.Stock.move_placement(actor, lot.uuid, %{
             "from_cell_uuid" => placement.storage_cell.uuid,
             "to_cell_uuid" => dest_cell.uuid,
             "qty" => Decimal.to_string(placement.qty),
             "photo_url" => attrs["photo_url"],
             "skip_photo_reason" => attrs["skip_photo_reason"],
             "reference_kind" => "manufacturing_order",
             "reference_uuid" => lot.source_ref
           }) do
        {:ok, moved_lot} -> {:ok, moved_lot}
        {:error, reason} -> {:error, {:move_failed, reason}}
      end
    else
      nil -> {:error, :lot_not_found}
      %StockLot{status: status} -> {:error, {:wrong_status, status}}
      {:error, _} = err -> err
    end
  end

  # ----- Pre-production receipt check ----------------------------

  @doc """
  Production operator's queue. MOs whose warehouse pickup is complete
  (lots on the production-feed cell) but at least one
  raw_material / packaging booking hasn't been physically verified
  yet (`received_at IS NULL`). Sorted by `pickup_completed_at` so the
  oldest hand-offs surface first.
  """
  def list_preflight_queue(company_id) when is_integer(company_id) do
    # IDs of MOs that still have at least one raw-material / packaging
    # booking awaiting the production operator's sign-off. Computed as
    # a subquery (rather than an inline EXISTS) so the outer query
    # stays simple + Ecto-aliasable.
    pending_mo_ids =
      from(b in ManufacturingOrderBooking,
        join: it in Item,
        on: it.id == b.item_id,
        where:
          b.status == "requested" and
            it.item_type in ["raw_material", "packaging", "semi_finished", "consumable"] and
            is_nil(b.received_at),
        select: b.manufacturing_order_id,
        distinct: true
      )

    pending_mos =
      from(mo in ManufacturingOrder,
        where:
          mo.company_id == ^company_id and
            mo.status == "scheduled" and
            not is_nil(mo.pickup_completed_at) and
            mo.id in subquery(pending_mo_ids),
        order_by: [asc: mo.pickup_completed_at, asc: mo.id],
        preload: [:item, :warehouse, :pickup_completed_by, steps: []]
      )
      |> Repo.all()

    Enum.map(pending_mos, fn mo ->
      planned_start = earliest_step_start(mo)
      %{mo: mo, planned_start: planned_start}
    end)
  end

  @doc """
  Full per-MO preflight detail — MO header + raw/packaging bookings
  with current received state. Mirrors the picker's detail endpoint
  shape so the FE can reuse the booking row layout.
  """
  def get_preflight_detail(company_id, mo_uuid)
      when is_integer(company_id) and is_binary(mo_uuid) do
    case get_manufacturing_order(company_id, mo_uuid) do
      nil ->
        nil

      %ManufacturingOrder{} = mo ->
        bookings = list_pickup_bookings(mo)
        %{mo: mo, bookings: bookings}
    end
  end

  @doc """
  Production operator action — confirm a single booking has arrived
  at the production-feed cell. Stamps `received_at` / `received_by_id`
  + the measured qty + free-text quality notes. `received_qty` is
  required and must be > 0. Idempotent: re-confirming an already-
  received booking succeeds without re-stamping the actor/time.

  Refuses if the MO's pickup hasn't completed (`pickup_completed_at`
  must be set first — picker needs to physically transfer before
  production can receive).
  """
  def confirm_booking_received(
        %User{} = actor,
        %ManufacturingOrderBooking{} = booking,
        attrs
      )
      when is_map(attrs) do
    mo = Repo.get!(ManufacturingOrder, booking.manufacturing_order_id)

    cond do
      is_nil(mo.pickup_completed_at) ->
        {:error, :pickup_not_completed}

      not is_nil(booking.received_at) ->
        # Idempotent re-confirm. Updates notes / qty only when the
        # operator passes them; never overwrites the actor stamp. If
        # the operator corrects received_qty, we reconcile the lot's
        # placement at the production-feed cell with a balancing
        # adjust movement so the books stay honest.
        update_attrs =
          %{}
          |> maybe_put_received_qty(attrs)
          |> maybe_put_received_notes(attrs)
          |> Map.put("updated_by_id", actor.id)

        if update_attrs == %{"updated_by_id" => actor.id} do
          {:ok, Repo.preload(booking, [:item, :stock_lot, :picked_by, :received_by])}
        else
          prev_received_qty = booking.received_qty || booking.quantity

          new_received_qty =
            case parse_received_qty(attrs) do
              {:ok, q} -> q
              _ -> prev_received_qty
            end

          run_confirm_received_txn(
            actor,
            booking,
            mo,
            update_attrs,
            prev_received_qty,
            new_received_qty,
            attrs
          )
        end

      true ->
        with {:ok, qty} <- parse_received_qty(attrs) do
          update_attrs =
            %{
              "received_at" => now(),
              "received_by_id" => actor.id,
              "received_qty" => qty,
              "updated_by_id" => actor.id
            }
            |> maybe_put_received_notes(attrs)

          # First confirm. Compare measured against booked qty (what
          # the picker physically transferred to the production-feed
          # cell). Any delta → emit a variance movement so the lot's
          # placement at the production-feed cell snaps to the
          # operator's measurement and the missing / extra kg is
          # accounted for in the audit trail.
          run_confirm_received_txn(
            actor,
            booking,
            mo,
            update_attrs,
            booking.quantity,
            qty,
            attrs
          )
        end
    end
  end

  # Wrap the booking update + variance reconciliation in one Repo
  # transaction so the booking and the placement always agree post-
  # commit. Rolls back the booking update if the variance movement
  # fails (e.g. the production-feed placement is missing).
  defp run_confirm_received_txn(
         actor,
         booking,
         mo,
         update_attrs,
         baseline_qty,
         new_qty,
         attrs
       ) do
    Repo.transaction(fn ->
      with {:ok, updated} <- apply_booking_changeset(actor, booking, update_attrs),
           :ok <-
             emit_preflight_variance(
               actor,
               updated,
               mo,
               baseline_qty,
               new_qty,
               attrs
             ) do
        updated
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  # Compare baseline (booked qty on first confirm, previous
  # received_qty on re-confirm) against the operator's measurement.
  # If they differ, emit an `adjust_down` (negative delta) or
  # `adjust_up` (positive delta) movement against the lot's
  # production-feed placement and snap that placement to the new
  # truth. Reason text records both numbers so QA can audit later.
  defp emit_preflight_variance(_actor, _booking, _mo, baseline, new_qty, _attrs)
       when is_nil(baseline) or is_nil(new_qty),
       do: :ok

  defp emit_preflight_variance(actor, booking, mo, baseline, new_qty, attrs) do
    delta = Decimal.sub(new_qty, baseline)

    if Decimal.equal?(delta, Decimal.new(0)) do
      :ok
    else
      lot = Repo.get!(StockLot, booking.stock_lot_id)

      case locate_production_feed_placement(lot, mo.production_cell_id) do
        nil ->
          # The lot isn't on the production-feed cell anymore (already
          # consumed mid-run, picker bypassed flow, etc.). The
          # variance is captured on the booking row regardless — we
          # just can't reconcile a placement that isn't there. Not
          # fatal; the audit log still has the booking's old / new
          # received_qty.
          :ok

        %Backend.Stock.Placement{} = placement ->
          reason = build_preflight_variance_reason(baseline, new_qty, attrs)
          kind = if Decimal.negative?(delta), do: "adjust_down", else: "adjust_up"
          new_placement_qty = Decimal.add(placement.qty, delta)

          cond do
            Decimal.compare(new_placement_qty, Decimal.new(0)) == :lt ->
              {:error, :insufficient_qty}

            true ->
              now_dt = now()

              movement_attrs = %{
                "company_id" => booking.company_id,
                "stock_lot_id" => booking.stock_lot_id,
                "from_cell_id" =>
                  if(Decimal.negative?(delta), do: placement.storage_cell_id),
                "to_cell_id" =>
                  if(Decimal.negative?(delta), do: nil, else: placement.storage_cell_id),
                "delta_qty" => Decimal.abs(delta),
                "kind" => kind,
                "reason" => reason,
                "actor_id" => actor.id,
                "occurred_at" => now_dt,
                "reference_kind" => "manufacturing_order_booking",
                "reference_ref" => booking.uuid
              }

              with {:ok, movement} <-
                     %Backend.Stock.Movement{}
                     |> Backend.Stock.Movement.changeset(movement_attrs)
                     |> Repo.insert(),
                   {:ok, _placement} <-
                     adjust_placement_to(placement, new_placement_qty) do
                Audit.record_created(actor, "stock_movement", movement, %{
                  kind: movement.kind,
                  delta_qty: movement.delta_qty,
                  from_cell_id: movement.from_cell_id,
                  to_cell_id: movement.to_cell_id,
                  reason: movement.reason,
                  reference_kind: movement.reference_kind,
                  reference_ref: movement.reference_ref
                })

                :ok
              end
          end
      end
    end
  end

  defp adjust_placement_to(%Backend.Stock.Placement{} = p, new_qty) do
    if Decimal.equal?(new_qty, Decimal.new(0)) do
      case Repo.delete(p) do
        {:ok, _} -> {:ok, %Backend.Stock.Placement{p | qty: new_qty}}
        err -> err
      end
    else
      p
      |> Backend.Stock.Placement.changeset(%{"qty" => new_qty})
      |> Repo.update()
    end
  end

  defp build_preflight_variance_reason(baseline, new_qty, attrs) do
    notes =
      case Map.get(attrs, "received_notes") || Map.get(attrs, :received_notes) do
        s when is_binary(s) and s != "" -> " — " <> String.trim(s)
        _ -> ""
      end

    "Preflight variance: measured #{decimal_to_string(new_qty)} vs picker-transferred #{decimal_to_string(baseline)}" <>
      notes
  end

  defp parse_received_qty(attrs) do
    raw = Map.get(attrs, "received_qty") || Map.get(attrs, :received_qty)

    case raw do
      %Decimal{} = d ->
        if Decimal.compare(d, Decimal.new("0")) == :gt, do: {:ok, d}, else: {:error, :bad_qty}

      n when is_integer(n) and n > 0 ->
        {:ok, Decimal.new(n)}

      n when is_float(n) and n > 0 ->
        {:ok, Decimal.from_float(n)}

      s when is_binary(s) ->
        case Decimal.parse(s) do
          {d, ""} ->
            if Decimal.compare(d, Decimal.new("0")) == :gt do
              {:ok, d}
            else
              {:error, :bad_qty}
            end

          _ ->
            {:error, :bad_qty}
        end

      _ ->
        {:error, :bad_qty}
    end
  end

  defp maybe_put_received_qty(attrs_out, attrs_in) do
    case parse_received_qty(attrs_in) do
      {:ok, d} -> Map.put(attrs_out, "received_qty", d)
      {:error, _} -> attrs_out
    end
  end

  defp maybe_put_received_notes(attrs_out, attrs_in) do
    case Map.get(attrs_in, "received_notes") || Map.get(attrs_in, :received_notes) do
      s when is_binary(s) -> Map.put(attrs_out, "received_notes", s)
      _ -> attrs_out
    end
  end

  defp apply_booking_changeset(%User{} = actor, %ManufacturingOrderBooking{} = booking, attrs) do
    booking
    |> ManufacturingOrderBooking.changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "manufacturing_order_booking",
          updated,
          booking_snapshot(booking),
          booking_snapshot(updated)
        )

        {:ok, Repo.preload(updated, [:item, :stock_lot, :picked_by, :received_by])}

      err ->
        err
    end
  end

  @doc """
  True when every raw_material / packaging booking on the MO has been
  received. Used to gate `do_transition(mo, "in_progress")` — the
  production operator's sign-off is the precondition for starting
  work.
  """
  def mo_preflight_complete?(%ManufacturingOrder{id: id}) do
    pending =
      from(b in ManufacturingOrderBooking,
        join: it in Item,
        on: it.id == b.item_id,
        where:
          b.manufacturing_order_id == ^id and
            b.status == "requested" and
            it.item_type in ["raw_material", "packaging", "semi_finished", "consumable"] and
            is_nil(b.received_at),
        select: count(b.id)
      )
      |> Repo.one()

    pending == 0
  end

  def mo_preflight_complete?(_), do: false

  # ----- Production run (Start / Finish) -------------------------

  @doc """
  Production operator's queue. MOs that are preflight-cleared and
  either ready-to-start (`scheduled` + every raw/packaging booking
  received) or actively in_progress. Sorted with in-progress first
  so the line operator sees the active run on top.
  """
  def list_production_runs(company_id) when is_integer(company_id) do
    mos =
      from(mo in ManufacturingOrder,
        where:
          mo.company_id == ^company_id and
            mo.status in ["scheduled", "in_progress"] and
            not is_nil(mo.pickup_completed_at),
        preload: [
          :item,
          :warehouse,
          :production_cell,
          :produced_lot,
          :pickup_completed_by,
          steps: []
        ],
        order_by: [
          desc: mo.status == "in_progress",
          asc: mo.actual_start,
          asc: mo.pickup_completed_at
        ]
      )
      |> Repo.all()

    # `scheduled` MOs only qualify if every booking is received —
    # preflight is the gate. Done in Elixir off the preloaded rows
    # so we keep the SQL simple.
    Enum.filter(mos, fn mo ->
      mo.status == "in_progress" or mo_preflight_complete?(mo)
    end)
  end

  @doc """
  Operator action — flips a preflight-cleared MO to `in_progress`
  and stamps `actual_start = now()`. Idempotent: re-pressing Start
  on an already-running MO is a no-op.
  """
  def start_mo_production(%User{} = actor, %ManufacturingOrder{} = mo) do
    cond do
      # Already in_progress AND has a real actual_start — pure no-op.
      mo.status == "in_progress" and not is_nil(mo.actual_start) ->
        {:ok, reload_manufacturing_order(mo)}

      # Already in_progress but actual_start is NULL — happens when
      # status was flipped via the generic transition path before that
      # path stamped the timestamp. Self-heal so the Finish dialog
      # has a real value to prefill from.
      mo.status == "in_progress" ->
        apply_run_changeset(actor, mo, %{
          "actual_start" => now(),
          "updated_by_id" => actor.id
        })

      mo.status != "scheduled" ->
        {:error, {:invalid_status, mo.status}}

      is_nil(mo.pickup_completed_at) ->
        {:error, :pickup_not_completed}

      not mo_preflight_complete?(mo) ->
        {:error, :preflight_incomplete}

      true ->
        apply_run_changeset(actor, mo, %{
          "status" => "in_progress",
          "actual_start" => now(),
          "updated_by_id" => actor.id
        })
    end
  end

  @doc """
  Operator action — closes a running MO. Stamps `actual_finish` +
  `quantity_produced`, creates a `stock_lot` for the manufactured
  output at the production-feed cell (status `received`, source
  `manufacturing_order`), then transitions to `completed`. The
  post-production return flow picks the lot up from there.

  Opts:
    * `:actual_finish` — DateTime or ISO8601 binary, defaults to now().
    * `:quantity_produced` — Decimal | binary | number (required, >= 0).
    * `:actual_start` — operator override if they forgot to press Start
      (defaults to the existing stamp, then `finish_dt`).
    * `:operation_times` — optional list of
      `%{step_uuid: ..., actual_start: ..., actual_finish: ...}`
      stamped per MO step. UI builds these by dividing the total run
      span across operations on the Finish dialog. Each datetime can
      be a DateTime or ISO8601 binary. Validated to live inside the
      MO's overall start/finish window.
    * `:packs` — required non-empty list. Each entry describes ONE
      physical package the operator filled. Map keys:
      `qty, length_mm, width_mm, height_mm, weight_kg, stack_factor`.
      Each pack becomes its own `stock_lot`; the sum of pack qtys
      must equal `:quantity_produced`. Matches the PO-receive shape
      so a "25 kg blend that ended up in 1 sack + 1 sample drum" can
      be recorded as two distinct lots.
  """
  def finish_mo_production(%User{} = actor, %ManufacturingOrder{} = mo, opts) do
    with :ok <- ensure_status_in(mo, ["in_progress"]),
         {:ok, qty} <- parse_quantity_produced(Keyword.get(opts, :quantity_produced)),
         {:ok, finish_dt} <- coerce_datetime(Keyword.get(opts, :actual_finish), now()),
         {:ok, start_dt} <-
           coerce_datetime(
             Keyword.get(opts, :actual_start),
             mo.actual_start || finish_dt
           ),
         :ok <- ensure_finish_after_start(start_dt, finish_dt),
         {:ok, op_times} <-
           parse_operation_times(
             Keyword.get(opts, :operation_times, []),
             start_dt,
             finish_dt
           ),
         {:ok, packs} <- parse_packs(Keyword.get(opts, :packs), qty) do
      Repo.transaction(fn ->
        with {:ok, lots} <- create_produced_lots(actor, mo, packs),
             :ok <- write_operation_times(actor, mo, op_times),
             {:ok, mo_updated} <-
               apply_run_changeset(actor, mo, %{
                 "status" => "completed",
                 "actual_start" => start_dt,
                 "actual_finish" => finish_dt,
                 "quantity_produced" => qty,
                 # `produced_lot_id` stays as the FIRST output lot — a
                 # convenience pointer for the singleton case. Multi-
                 # pack runs are still queryable via
                 # source_kind=manufacturing_order, source_ref=mo.uuid.
                 "produced_lot_id" => List.first(lots).id,
                 "updated_by_id" => actor.id
               }) do
          mo_updated
        else
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  # Packs — one row per physical package. Each pack becomes a lot.
  # `units_per_package` is set to the pack's own qty so the volume
  # math always reads `packages = qty / units_per_package = 1` (the
  # bug from the old per-package multiplier that surprised operators
  # who entered a 25 kg sack and got a 600 kg volume estimate).
  defp parse_packs(list, total_qty) when is_list(list) and list != [] do
    parsed =
      Enum.reduce_while(list, {:ok, []}, fn entry, {:ok, acc} ->
        case parse_pack_entry(entry) do
          {:ok, pack} -> {:cont, {:ok, [pack | acc]}}
          {:error, reason} -> {:halt, {:error, reason}}
        end
      end)

    with {:ok, packs} <- parsed,
         packs <- Enum.reverse(packs),
         :ok <- ensure_pack_qty_matches_total(packs, total_qty) do
      {:ok, packs}
    end
  end

  defp parse_packs(_, _), do: {:error, :missing_packs}

  defp parse_pack_entry(entry) when is_map(entry) do
    # Type per field so the lot insert downstream sees ints for the
    # integer DB columns (mm dims, stack_factor) and decimals for
    # the decimal ones (qty, weight). Ecto's :integer cast refuses
    # %Decimal{} structs, so mixing was failing the changeset.
    int_fields = ~w(length_mm width_mm height_mm stack_factor)
    decimal_fields = ~w(qty weight_kg)

    with {:ok, ints} <-
           parse_pack_fields(entry, int_fields, &parse_positive_integer/1),
         {:ok, decs} <-
           parse_pack_fields(entry, decimal_fields, &parse_positive_decimal/1) do
      {:ok, Map.merge(ints, decs)}
    end
  end

  defp parse_pack_entry(_), do: {:error, :bad_pack_entry}

  defp parse_pack_fields(entry, keys, parser) do
    Enum.reduce_while(keys, {:ok, %{}}, fn key, {:ok, acc} ->
      raw = Map.get(entry, key) || Map.get(entry, String.to_existing_atom(key))

      case parser.(raw) do
        {:ok, v} -> {:cont, {:ok, Map.put(acc, key, v)}}
        :error -> {:halt, {:error, {:bad_pack_field, key}}}
      end
    end)
  end

  defp parse_positive_integer(n) when is_integer(n) and n > 0, do: {:ok, n}

  defp parse_positive_integer(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, ""} when n > 0 -> {:ok, n}
      _ -> :error
    end
  end

  defp parse_positive_integer(_), do: :error

  # Sum of pack qtys must equal the MO's produced qty so the audit
  # ledger balances. Tolerates a tiny float rounding window
  # (0.0001 of the stock UoM) — that's smaller than the
  # `precision: 4` lot qty column resolves.
  defp ensure_pack_qty_matches_total(packs, total_qty) do
    sum = Enum.reduce(packs, Decimal.new(0), fn p, acc -> Decimal.add(acc, p["qty"]) end)
    diff = Decimal.abs(Decimal.sub(sum, total_qty))

    if Decimal.compare(diff, Decimal.new("0.0001")) in [:lt, :eq] do
      :ok
    else
      {:error, {:pack_qty_mismatch, %{sum: sum, total: total_qty}}}
    end
  end

  defp parse_positive_decimal(%Decimal{} = d) do
    if Decimal.compare(d, Decimal.new("0")) == :gt, do: {:ok, d}, else: :error
  end

  defp parse_positive_decimal(n) when is_integer(n) and n > 0, do: {:ok, Decimal.new(n)}

  defp parse_positive_decimal(n) when is_float(n) and n > 0, do: {:ok, Decimal.from_float(n)}

  defp parse_positive_decimal(s) when is_binary(s) do
    case Decimal.parse(s) do
      {d, ""} -> parse_positive_decimal(d)
      _ -> :error
    end
  end

  defp parse_positive_decimal(_), do: :error

  # Create one `stock_lot` per pack — each placed at the MO's
  # production-feed cell with status `received`. Returns the list of
  # inserted lots in the original pack order so the caller can stamp
  # the first one onto `mo.produced_lot_id`.
  defp create_produced_lots(%User{} = actor, %ManufacturingOrder{} = mo, packs) do
    if is_nil(mo.production_cell_id) do
      {:error, :no_production_cell}
    else
      # Preload the per-type compliance row so we can read the item's
      # `shelf_life_months` for expiry — finished products spec'd in
      # `finished_product_spec`, raw materials in `raw_material_compliance`.
      # Semi-finished + packaging items don't carry a shelf life (they're
      # intermediate / inert) so the lot's expiry stays nil for those.
      item =
        Repo.get!(Item, mo.item_id)
        |> Repo.preload([:finished_product_spec, :raw_material_compliance])

      manufactured_at = mo.actual_finish || now()
      expiry_at = compute_lot_expiry(item, manufactured_at)

      Enum.reduce_while(packs, {:ok, []}, fn pack, {:ok, acc} ->
        case create_produced_lot(actor, mo, item, pack, manufactured_at, expiry_at) do
          {:ok, lot} -> {:cont, {:ok, [lot | acc]}}
          {:error, reason} -> {:halt, {:error, reason}}
        end
      end)
      |> case do
        {:ok, lots} -> {:ok, Enum.reverse(lots)}
        err -> err
      end
    end
  end

  # `manufactured_at` is naturally the MO's actual_finish — the lot
  # came into existence at the moment the run closed. `expiry_at`
  # follows MRPEasy's convention: manufactured_at + the item's
  # shelf-life setting on its per-type compliance row.
  defp compute_lot_expiry(%Item{} = item, %DateTime{} = manufactured_at) do
    months =
      cond do
        item.item_type == "finished_product" and item.finished_product_spec ->
          item.finished_product_spec.shelf_life_months

        item.item_type == "raw_material" and item.raw_material_compliance ->
          item.raw_material_compliance.shelf_life_months

        true ->
          nil
      end

    case months do
      n when is_integer(n) and n > 0 ->
        # Months are calendar-aware; convert to a date by stepping the
        # calendar forward, then back to a UTC datetime at the same
        # wall time so the lot's expiry reads naturally to the operator
        # ("manufactured Jan 1 → expires Jul 1" instead of "184 days").
        manufactured_at
        |> DateTime.shift(month: n)

      _ ->
        nil
    end
  end

  defp create_produced_lot(
         %User{} = actor,
         %ManufacturingOrder{} = mo,
         %Item{} = item,
         pack,
         manufactured_at,
         expiry_at
       ) do
    qty = pack["qty"]

    lot_attrs = %{
      "company_id" => mo.company_id,
      "item_id" => mo.item_id,
      "unit_of_measurement_id" => item.stock_uom_id,
      "qty_received" => qty,
      "status" => "received",
      "source_kind" => "manufacturing_order",
      "source_ref" => mo.uuid,
      "received_at" => now(),
      # Production output: manufactured_at is when the run closed,
      # expiry_at is derived from the item's shelf life (nil for
      # semi-finished / packaging which have no spec'd shelf life —
      # operator can edit on the lot detail page if needed).
      "manufactured_at" => manufactured_at,
      "expiry_at" => expiry_at,
      "package_length_mm" => pack["length_mm"],
      "package_width_mm" => pack["width_mm"],
      "package_height_mm" => pack["height_mm"],
      "package_weight_kg" => pack["weight_kg"],
      # `units_per_package` = the pack's own qty so the downstream
      # volume math reads `packages = qty / units_per_package = 1`
      # regardless of UoM. A 4.4 kg bag stays one bag. The column is
      # numeric(10,3) so fractional UoMs (kg, L) work natively.
      "units_per_package" => qty,
      "stack_factor" => pack["stack_factor"],
      "created_by_id" => actor.id,
      "updated_by_id" => actor.id
    }

    with {:ok, lot} <-
           %StockLot{}
           |> StockLot.changeset(lot_attrs)
           |> Repo.insert(),
         {:ok, _placement} <-
           %Backend.Stock.Placement{}
           |> Backend.Stock.Placement.changeset(%{
             "company_id" => mo.company_id,
             "stock_lot_id" => lot.id,
             "storage_cell_id" => mo.production_cell_id,
             "qty" => qty
           })
           |> Repo.insert() do
      Audit.record_created(actor, "stock_lot", lot, %{
        item_id: lot.item_id,
        qty_received: lot.qty_received,
        status: lot.status,
        source_kind: lot.source_kind,
        source_ref: lot.source_ref
      })

      {:ok, lot}
    end
  end

  defp apply_run_changeset(%User{} = actor, %ManufacturingOrder{} = mo, attrs) do
    before = mo_snapshot(mo)

    mo
    |> ManufacturingOrder.run_changeset(attrs)
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

        # Ping the wizard so the CO board re-projects — start /
        # finish production both change what the "Do this next"
        # panel + progress bars render.
        Backend.OrderWizard.notify_via_mo(updated)

        {:ok, reload_manufacturing_order(updated)}

      err ->
        err
    end
  end

  defp parse_quantity_produced(raw) do
    case raw do
      %Decimal{} = d ->
        if Decimal.compare(d, Decimal.new("0")) == :lt do
          {:error, :bad_qty}
        else
          {:ok, d}
        end

      n when is_integer(n) and n >= 0 ->
        {:ok, Decimal.new(n)}

      n when is_float(n) and n >= 0 ->
        {:ok, Decimal.from_float(n)}

      s when is_binary(s) ->
        case Decimal.parse(s) do
          {d, ""} ->
            if Decimal.compare(d, Decimal.new("0")) == :lt do
              {:error, :bad_qty}
            else
              {:ok, d}
            end

          _ ->
            {:error, :bad_qty}
        end

      _ ->
        {:error, :bad_qty}
    end
  end

  defp coerce_datetime(nil, default), do: {:ok, default}
  defp coerce_datetime(%DateTime{} = dt, _default), do: {:ok, dt}

  defp coerce_datetime(s, _default) when is_binary(s) do
    case DateTime.from_iso8601(s) do
      {:ok, dt, _offset} -> {:ok, DateTime.shift_zone!(dt, "Etc/UTC")}
      _ -> {:error, :bad_datetime}
    end
  end

  defp coerce_datetime(_, _default), do: {:error, :bad_datetime}

  defp ensure_finish_after_start(%DateTime{} = start_dt, %DateTime{} = finish_dt) do
    if DateTime.compare(finish_dt, start_dt) == :lt do
      {:error, :finish_before_start}
    else
      :ok
    end
  end

  # Validate + normalise the per-operation time list the FE divider
  # produces on the Finish dialog. Each entry has step_uuid + ISO
  # actual_start/finish. We assert finish ≥ start per row and that
  # every stamp lives inside the MO's overall [start_dt, finish_dt]
  # window — sliders shouldn't be able to point at times before the
  # run started or after it ended.
  defp parse_operation_times([], _start_dt, _finish_dt), do: {:ok, []}

  defp parse_operation_times(list, start_dt, finish_dt) when is_list(list) do
    parsed =
      Enum.reduce_while(list, {:ok, []}, fn entry, {:ok, acc} ->
        with {:ok, uuid} <- fetch_step_uuid(entry),
             {:ok, s} <- coerce_datetime(entry_field(entry, "actual_start"), start_dt),
             {:ok, f} <- coerce_datetime(entry_field(entry, "actual_finish"), finish_dt),
             :ok <- ensure_finish_after_start(s, f),
             :ok <- ensure_within(s, start_dt, finish_dt),
             :ok <- ensure_within(f, start_dt, finish_dt) do
          {:cont, {:ok, [%{step_uuid: uuid, actual_start: s, actual_finish: f} | acc]}}
        else
          err -> {:halt, err}
        end
      end)

    case parsed do
      {:ok, list} -> {:ok, Enum.reverse(list)}
      err -> err
    end
  end

  defp parse_operation_times(_, _, _), do: {:error, :bad_operation_times}

  defp fetch_step_uuid(entry) do
    case entry_field(entry, "step_uuid") do
      s when is_binary(s) and byte_size(s) > 0 -> {:ok, s}
      _ -> {:error, :missing_step_uuid}
    end
  end

  defp entry_field(entry, key) when is_map(entry) do
    Map.get(entry, key) || Map.get(entry, String.to_existing_atom(key))
  end

  defp ensure_within(%DateTime{} = dt, lo, hi) do
    case {DateTime.compare(dt, lo), DateTime.compare(dt, hi)} do
      {:lt, _} -> {:error, :operation_time_outside_run}
      {_, :gt} -> {:error, :operation_time_outside_run}
      _ -> :ok
    end
  end

  # Write each operation's actual_start/finish on its step row. Steps
  # not in the list are left untouched (the FE always submits the
  # full set, but partial submits are safe). Done inside the Finish
  # transaction so a bad step rolls back the MO finish too.
  defp write_operation_times(_actor, _mo, []), do: :ok

  defp write_operation_times(%User{} = actor, %ManufacturingOrder{} = mo, op_times) do
    steps_by_uuid =
      from(s in ManufacturingOrderStep,
        where: s.manufacturing_order_id == ^mo.id
      )
      |> Repo.all()
      |> Map.new(fn s -> {s.uuid, s} end)

    Enum.reduce_while(op_times, :ok, fn %{step_uuid: uuid} = entry, _ ->
      case Map.get(steps_by_uuid, uuid) do
        nil ->
          {:halt, {:error, {:step_not_in_mo, uuid}}}

        %ManufacturingOrderStep{} = step ->
          before = mo_step_snapshot(step)

          attrs = %{
            "actual_start" => entry.actual_start,
            "actual_finish" => entry.actual_finish,
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

              {:cont, :ok}

            {:error, cs} ->
              {:halt, {:error, cs}}
          end
      end
    end)
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

        # Fire the wizard channel — any pickup-lifecycle change
        # (release, unrelease, start pickup, finish pickup,
        # abort pickup, ...) alters the "Do this next" panel + the
        # per-MO card state. Without this the FE keeps rendering
        # the pre-change snapshot until the next full page load.
        Backend.OrderWizard.notify_via_mo(updated)

        Backend.Broadcasts.entity_changed(
          "manufacturing-order",
          updated.uuid,
          updated.company_id,
          "pickup_changed"
        )

        {:ok, reload_manufacturing_order(updated)}

      err ->
        err
    end
  end

  # Hard release gate: every BOM line must have bookings covering the
  # line's required qty (BOM qty × MO qty, or the fixed amount when
  # `line.is_fixed`). Releasing a partially-booked MO sent it to the
  # picker with red "Not booked" rows on the parts table — confusing
  # the operator and breaking traceability (the missing raw material
  # was silently absent from picking). Refuse instead, with the list
  # of short lines so the planner knows exactly what to fix.
  defp ensure_all_lines_fully_booked(%ManufacturingOrder{} = mo) do
    mo = Repo.preload(mo, [:bookings, :children, bom: [lines: :part]])

    lines =
      case mo.bom do
        %BOM{lines: lines} when is_list(lines) -> lines
        _ -> []
      end

    mo_qty = mo.quantity || Decimal.new(0)

    # Output of open child MOs counts as in-flight coverage — same rule
    # the parts-table coverage badge uses. Once a child MO is approved,
    # its planned output is committed to this parent.
    children_by_item =
      mo.children
      |> Enum.filter(&(&1.status not in ["completed", "cancelled"]))
      |> Enum.group_by(& &1.item_id)

    # Precompute active bookings per item. Filtering `mo.bookings`
    # per line inside the flat_map was O(lines × bookings); once
    # this is grouped it's O(lines + bookings).
    bookings_by_item =
      mo.bookings
      |> Enum.filter(&(&1.status == "requested"))
      |> Enum.group_by(& &1.item_id)

    shortages =
      lines
      |> Enum.flat_map(fn line ->
        case line.part do
          %Item{id: part_id, name: name, item_type: t}
          when t in ["raw_material", "packaging", "semi_finished", "consumable"] ->
            required =
              if line.is_fixed do
                line.qty || Decimal.new(0)
              else
                Decimal.mult(line.qty || Decimal.new(0), mo_qty)
              end

            booked =
              bookings_by_item
              |> Map.get(part_id, [])
              |> Enum.reduce(Decimal.new(0), fn b, acc ->
                Decimal.add(acc, b.quantity || Decimal.new(0))
              end)

            pending_from_children =
              children_by_item
              |> Map.get(part_id, [])
              |> Enum.reduce(Decimal.new(0), fn c, acc ->
                Decimal.add(acc, c.quantity || Decimal.new(0))
              end)

            coverage = Decimal.add(booked, pending_from_children)

            if Decimal.compare(required, coverage) == :gt do
              [
                %{
                  item_id: part_id,
                  item_name: name,
                  required: Decimal.to_string(required),
                  booked: Decimal.to_string(coverage),
                  short: Decimal.to_string(Decimal.sub(required, coverage))
                }
              ]
            else
              []
            end

          _ ->
            []
        end
      end)

    case shortages do
      [] -> :ok
      list -> {:error, :lines_under_booked, list}
    end
  end

  # Release-only gate: every BOM line must be covered by REAL lot
  # bookings — pending output from a child MO doesn't count because
  # the picker walks the floor NOW and the child's lot doesn't exist
  # yet. Symmetric structure to ensure_all_lines_fully_booked but
  # without the children_by_item term. Returns the per-line gap so
  # the FE can render "Vitamin C blend — short by 2 kg, waiting on
  # MO00018 to finish + pass QC."
  defp ensure_all_lines_have_real_bookings(%ManufacturingOrder{} = mo) do
    mo = Repo.preload(mo, [:bookings, :children, bom: [lines: :part]])

    lines =
      case mo.bom do
        %BOM{lines: lines} when is_list(lines) -> lines
        _ -> []
      end

    mo_qty = mo.quantity || Decimal.new(0)

    # Open child MOs still hint what's pending so the error message
    # can name the producing MO ("waiting on MO00018"). Used only
    # for the error payload — does NOT add coverage.
    children_by_item =
      mo.children
      |> Enum.filter(&(&1.status not in ["completed", "cancelled"]))
      |> Enum.group_by(& &1.item_id)

    shortages =
      lines
      |> Enum.flat_map(fn line ->
        case line.part do
          %Item{id: part_id, name: name, item_type: t}
          when t in ["raw_material", "packaging", "semi_finished", "consumable"] ->
            required =
              if line.is_fixed do
                line.qty || Decimal.new(0)
              else
                Decimal.mult(line.qty || Decimal.new(0), mo_qty)
              end

            booked =
              mo.bookings
              |> Enum.filter(fn b ->
                b.item_id == part_id and b.status == "requested"
              end)
              |> Enum.reduce(Decimal.new(0), fn b, acc ->
                Decimal.add(acc, b.quantity || Decimal.new(0))
              end)

            if Decimal.compare(required, booked) == :gt do
              waiting_on =
                children_by_item
                |> Map.get(part_id, [])
                |> Enum.map(fn c ->
                  %{
                    id: c.id,
                    uuid: c.uuid,
                    status: c.status,
                    quantity: Decimal.to_string(c.quantity || Decimal.new(0))
                  }
                end)

              [
                %{
                  item_id: part_id,
                  item_name: name,
                  required: Decimal.to_string(required),
                  booked: Decimal.to_string(booked),
                  short: Decimal.to_string(Decimal.sub(required, booked)),
                  waiting_on_children: waiting_on
                }
              ]
            else
              []
            end

          _ ->
            []
        end
      end)

    case shortages do
      [] -> :ok
      list -> {:error, :lines_not_lot_booked, list}
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
            it.item_type in ["raw_material", "packaging", "semi_finished", "consumable"] and
            l.status != "available",
        select: %{booking_uuid: b.uuid, lot_uuid: l.uuid, lot_status: l.status}
      )
      |> Repo.all()

    case stale do
      [] -> :ok
      list -> {:error, :stale_bookings, list}
    end
  end

  # Release-only gate. Every booked lot must have at least
  # `booking.quantity` worth of physical placement in a `regular`
  # warehouse cell. If a lot is sitting at a production_feed /
  # dispatch / quarantine / hold / rejected cell, release is
  # blocked — the picker walks the warehouse, not the production
  # floor. Child-MO outputs that just finished have to go through
  # warehouse return-pickup before the parent can release.
  defp ensure_all_booked_lots_in_warehouse(%ManufacturingOrder{} = mo) do
    # Conditional sum: count placement.qty only when the joined cell
    # has purpose=regular. A plain `sum(p.qty)` would double-count any
    # placement (including production_feed / dispatch ones) because
    # the LEFT JOIN keeps the placement row even when the cell join
    # misses — we'd think a lot at production_feed was "in warehouse".
    mis =
      from(b in ManufacturingOrderBooking,
        join: it in Item,
        on: it.id == b.item_id,
        join: l in StockLot,
        on: l.id == b.stock_lot_id,
        left_join: p in Backend.Stock.Placement,
        on: p.stock_lot_id == l.id,
        left_join: c in Backend.Warehouses.StorageCell,
        on: c.id == p.storage_cell_id and c.purpose == "regular",
        where:
          b.manufacturing_order_id == ^mo.id and
            b.status == "requested" and
            it.item_type in ["raw_material", "packaging", "semi_finished", "consumable"],
        group_by: [b.id, b.uuid, b.quantity, it.name, l.uuid],
        select: %{
          booking_uuid: b.uuid,
          item_name: it.name,
          lot_uuid: l.uuid,
          booked_qty: b.quantity,
          in_warehouse_qty:
            coalesce(
              sum(
                fragment(
                  "CASE WHEN ? IS NOT NULL THEN ? ELSE 0 END",
                  c.id,
                  p.qty
                )
              ),
              0
            )
        }
      )
      |> Repo.all()
      |> Enum.flat_map(fn row ->
        booked = to_decimal(row.booked_qty)
        in_wh = to_decimal(row.in_warehouse_qty)

        if Decimal.compare(in_wh, booked) == :lt do
          [
            row
            |> Map.update!(:booked_qty, &decimal_to_string/1)
            |> Map.update!(:in_warehouse_qty, &decimal_to_string/1)
          ]
        else
          []
        end
      end)

    case mis do
      [] -> :ok
      list -> {:error, :lots_not_in_warehouse, list}
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
