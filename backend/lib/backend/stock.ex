defmodule Backend.Stock do
  @moduledoc """
  Boundary for stock lots, placements, and movements. Read paths
  return lots with optional preloads (item, unit, placements,
  movements). Mutations (receive / move / consume / dispose) land
  in subsequent slices — Slice 1 is read-only.

  Lots are scoped per company via every query. Movements are
  append-only audit rows; the public API exposes no edit/delete.
  """

  import Ecto.Query, warn: false

  alias Backend.Items.Item
  alias Backend.ListQueries
  alias Backend.Repo
  alias Backend.Stock.{Lot, Movement, Placement}

  # Sortable on the list endpoint. `code` maps to `id` since the
  # numbering format guarantees code-order == id-order for a given
  # prefix + padding (same trick as Items.list_page).
  @sortable_fields ~w(id status qty_received unit_cost supplier_batch_no expiry_at received_at available_from inserted_at)a
  @search_fields ~w(supplier_batch_no source_ref notes country_of_origin revision)a
  @default_sort {:id, :desc}

  # ----- read ------------------------------------------------------

  @doc """
  List page of lots scoped to the company. Supports cursor pagination
  (via ListQueries), search across supplier batch + provenance, and
  filters on status / item / cell.

  Opts:
    * `:sort`     — `{field, :asc | :desc}`
    * `:limit`    — page size hint
    * `:cursor`   — opaque cursor from a previous page
    * `:search`   — search term (string)
    * `:status`   — restrict to one status
    * `:item_id`  — restrict to one item
    * `:cell_id`  — restrict to lots with a placement at this cell
  """
  def list_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = normalise_sort(Keyword.get(opts, :sort, @default_sort))

    base =
      Lot
      |> where([l], l.company_id == ^company_id)
      |> maybe_status_filter(opts[:status])
      |> maybe_item_filter(opts[:item_id])
      |> maybe_cell_filter(opts[:cell_id])
      |> maybe_warehouse_filter(opts[:warehouse_id])
      |> apply_lot_search(company_id, opts[:search])
      |> ListQueries.apply_sort(sort, @sortable_fields, @default_sort)
      |> preload([
        :item,
        :unit_of_measurement,
        :created_by,
        :updated_by,
        placements: [:storage_cell]
      ])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  # The DataTable search input is a single field — operators type
  # whatever they're looking at (lot code, item name, item code,
  # supplier batch, ...). We OR across the lot's own text columns
  # AND the joined item.name / item.external_sku so the search "just
  # works". A separate parse-as-lot-code branch lets `L00007` hit
  # by id directly.
  defp apply_lot_search(query, _company_id, nil), do: query
  defp apply_lot_search(query, _company_id, ""), do: query

  defp apply_lot_search(query, company_id, term) when is_binary(term) do
    needle = "%" <> escape_like(String.trim(term)) <> "%"
    id_from_code = parse_lot_code(company_id, term)

    from l in query,
      left_join: i in Item,
      on: i.id == l.item_id,
      where:
        ilike(l.supplier_batch_no, ^needle) or
          ilike(l.source_ref, ^needle) or
          ilike(l.notes, ^needle) or
          ilike(l.country_of_origin, ^needle) or
          ilike(l.revision, ^needle) or
          ilike(i.name, ^needle) or
          ilike(i.external_sku, ^needle) or
          (^id_from_code != 0 and l.id == ^id_from_code)
  end

  defp parse_lot_code(company_id, term) do
    case Repo.get(Backend.Companies.Company, company_id) do
      nil ->
        0

      company ->
        case Backend.Numbering.parse_search(term, company, "stock_lot") do
          nil -> 0
          id when is_integer(id) -> id
        end
    end
  end

  defp escape_like(s),
    do: s |> String.replace("\\", "\\\\") |> String.replace("%", "\\%") |> String.replace("_", "\\_")

  def list_config do
    %{
      sortable_fields: Enum.map(@sortable_fields, &Atom.to_string/1),
      search_fields: Enum.map(@search_fields, &Atom.to_string/1),
      default_sort: %{
        field: Atom.to_string(elem(@default_sort, 0)),
        direction: Atom.to_string(elem(@default_sort, 1))
      }
    }
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        cell_with_breadcrumb = [storage_location: [floor: :warehouse]]

        Repo.one(
          from(l in Lot,
            where: l.company_id == ^company_id and l.uuid == ^cast,
            preload: [
              :item,
              :unit_of_measurement,
              :created_by,
              :updated_by,
              # The Goods-In Inspection that produced this lot (PO
              # receives). Carrying it inline lets the lot detail page
              # render the full QA story — section checks, decision,
              # operator + approver signatures, attached photos / CoA.
              goods_in_inspection: [
                :goods_in_operator,
                :quality_approver,
                :purchase_order,
                items: [],
                files: [:uploaded_by]
              ],
              # Direct lot attachments (CoA, QC reports, disposal
              # certs, ad-hoc photos) — separate from inspection files.
              files: [:uploaded_by],
              # Every MO booking that references this lot, with the
              # full pickup → confirm → consume chain of sign-offs.
              mo_bookings: [
                :manufacturing_order,
                :picked_by,
                :received_by,
                :consumed_by
              ],
              # Return picks (production → warehouse) on output lots.
              # Lots can have multiple return picks if split.
              return_picks: [
                :picked_by,
                :placed_by,
                picked_from_cell: ^cell_with_breadcrumb,
                placed_to_cell: ^cell_with_breadcrumb
              ],
              placements: [storage_cell: ^cell_with_breadcrumb],
              movements:
                ^from(m in Movement,
                  order_by: [desc: m.occurred_at, desc: m.id],
                  preload: [
                    :actor,
                    from_cell: ^cell_with_breadcrumb,
                    to_cell: ^cell_with_breadcrumb
                  ]
                )
            ]
          )
        )

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  @doc """
  Record a lifecycle event against a lot identified by uuid. Top-level
  boundary the controller calls — handles lot lookup + delegation into
  `Backend.Stock.Lifecycle`. Lifecycle enforces the allowed-transition
  matrix and updates the lot's projected status.

  `attrs` shape:

      %{
        kind: "qc_passed" | "qc_failed" | "held" | "released" | "disposed" | …,
        reason: nil | binary,
        metadata: %{},
        evidence_file_id: nil | integer
      }
  """
  def record_lot_event(%Backend.Accounts.User{} = actor, company_id, uuid, attrs)
      when is_integer(company_id) and is_binary(uuid) and is_map(attrs) do
    with %Lot{} = lot <- get_for_company(company_id, uuid) do
      kind = attrs["kind"] || attrs[:kind]

      Backend.Stock.Lifecycle.record_event(
        lot,
        to_string(kind),
        %{
          actor: actor,
          actor_kind: "user",
          reason: attrs["reason"] || attrs[:reason],
          metadata: attrs["metadata"] || attrs[:metadata] || %{},
          evidence_file_id: attrs["evidence_file_id"] || attrs[:evidence_file_id]
        }
      )
    else
      nil -> {:error, :not_found}
    end
  end

  @doc """
  Paginated lifecycle event timeline for one lot. Newest-first.
  """
  def list_lot_events(company_id, uuid, opts \\ [])
      when is_integer(company_id) and is_binary(uuid) do
    with %Lot{} = lot <- get_for_company(company_id, uuid) do
      {:ok, lot, Backend.Stock.Lifecycle.list_events(lot, opts)}
    else
      nil -> {:error, :not_found}
    end
  end

  @doc """
  Edit a lot's mutable fields. `qty_received`, the parent item, and
  the UoM stay immutable — those changes happen through movements or
  a delete-and-re-receive. Audit row captures the before/after diff
  across `@lot_audit_fields`.

  Returns the freshly-preloaded lot so the caller can hand it back to
  the FE without a second round-trip.
  """
  def update_lot(%Backend.Accounts.User{} = actor, company_id, uuid, attrs)
      when is_integer(company_id) and is_binary(uuid) and is_map(attrs) do
    with %Lot{} = lot <- get_for_company(company_id, uuid) do
      # `source_kind` is derived from the create-flow and never editable
      # from the form — strip it so a smuggled body field can't rewrite
      # provenance. `status` is the projected lifecycle state — operators
      # change it by recording an event through `Backend.Stock.Lifecycle`,
      # never by patching the column directly.
      attrs_with_actor =
        attrs
        |> stringify_keys()
        |> Map.drop(["source_kind", "status"])
        |> Map.put("updated_by_id", actor.id)

      before_snapshot = lot_audit_snapshot(lot)

      Repo.transaction(fn ->
        case lot |> Lot.edit_changeset(attrs_with_actor) |> Repo.update() do
          {:ok, updated} ->
            Backend.Audit.record_updated(
              actor,
              "stock_lot",
              updated,
              before_snapshot,
              lot_audit_snapshot(updated)
            )

            # Re-preload with the wider chain so the payload matches
            # the show endpoint.
            cell_with_breadcrumb = [storage_location: [floor: :warehouse]]

            Repo.preload(updated, [
              :item,
              :unit_of_measurement,
              :created_by,
              :updated_by,
              placements: [storage_cell: cell_with_breadcrumb],
              movements:
                from(m in Movement,
                  order_by: [desc: m.occurred_at, desc: m.id],
                  preload: [
                    :actor,
                    from_cell: ^cell_with_breadcrumb,
                    to_cell: ^cell_with_breadcrumb
                  ]
                )
            ])

          {:error, %Ecto.Changeset{} = cs} ->
            Repo.rollback(cs)
        end
      end)
    else
      nil -> {:error, :not_found}
    end
  end

  def update_lot(_actor, _company_id, _uuid, _attrs), do: {:error, :bad_args}

  defp stringify_keys(attrs) when is_map(attrs) do
    Map.new(attrs, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end

  @doc """
  Compute on-hand for a preloaded lot. `qty_on_hand = sum(placements.qty)`.
  Cheap when placements are already loaded; the API uses this rather
  than denormalising onto the lot row so movements never need to
  touch the parent.
  """
  def qty_on_hand(%Lot{placements: %Ecto.Association.NotLoaded{}} = lot) do
    Repo.one(
      from(p in Placement,
        where: p.stock_lot_id == ^lot.id,
        select: coalesce(sum(p.qty), 0)
      )
    )
  end

  def qty_on_hand(%Lot{placements: placements}) when is_list(placements) do
    Enum.reduce(placements, Decimal.new(0), fn p, acc -> Decimal.add(acc, p.qty) end)
  end

  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  defp maybe_status_filter(query, nil), do: query

  defp maybe_status_filter(query, status) when is_binary(status) do
    where(query, [l], l.status == ^status)
  end

  defp maybe_item_filter(query, nil), do: query

  defp maybe_item_filter(query, item_id) when is_integer(item_id) do
    where(query, [l], l.item_id == ^item_id)
  end

  defp maybe_cell_filter(query, nil), do: query

  defp maybe_cell_filter(query, cell_id) when is_integer(cell_id) do
    cell_lot_ids =
      from(p in Placement,
        where: p.storage_cell_id == ^cell_id and p.qty > 0,
        select: p.stock_lot_id
      )

    where(query, [l], l.id in subquery(cell_lot_ids))
  end

  # ----- inventory rollup -----------------------------------------

  @inventory_sortable ~w(code name qty_on_hand total_cost lots_count earliest_expiry latest_received_at)a
  @inventory_default_sort {:name, :asc}

  @doc """
  Item-level rollup for the /stock/inventory page. One row per item;
  on-hand + cost value are summed across every non-zero placement of
  every lot. Items with no lots still appear (their on-hand and cost
  read as zero) so operators can see the full catalogue at a glance.

  Filters:
    * `:warehouse_id`   — restrict to items with stock at this warehouse
    * `:item_type`      — `"raw_material"`, `"finished_product"`, `"packaging"`, …
    * `:in_stock_only`  — drop the zero-on-hand rows
    * `:search`         — ILIKE across item.name and item.external_sku

  Returns `{rows, next_cursor}`. Cost is summed naively as
  `placement.qty * lot.unit_cost` in the company's default currency.
  """
  def inventory_rollup(company_id, opts \\ []) when is_integer(company_id) do
    sort = inventory_sort(opts[:sort])
    limit = inventory_limit(opts[:limit])
    cursor = inventory_decode_cursor(opts[:cursor])

    search_needle = inventory_needle(opts[:search])
    item_type = opts[:item_type]
    warehouse_id = opts[:warehouse_id]
    in_stock_only = opts[:in_stock_only] == true

    base =
      from i in Item,
        as: :item,
        left_join: l in Lot,
        as: :lot,
        on: l.item_id == i.id and l.company_id == ^company_id,
        left_join: p in Placement,
        as: :placement,
        on: p.stock_lot_id == l.id and p.qty > 0,
        where: i.company_id == ^company_id,
        group_by: [i.id, i.name, i.uuid, i.external_sku, i.item_type, i.stock_uom_id],
        select: %{
          item_id: i.id,
          item_uuid: i.uuid,
          item_name: i.name,
          item_external_sku: i.external_sku,
          item_type: i.item_type,
          stock_uom_id: i.stock_uom_id,
          qty_on_hand: coalesce(sum(p.qty), 0),
          total_cost:
            coalesce(
              sum(fragment("? * COALESCE(?, 0)", p.qty, l.unit_cost)),
              0
            ),
          lots_count: count(l.id, :distinct),
          earliest_expiry: min(l.expiry_at),
          latest_received_at: max(l.received_at)
        }

    base =
      if item_type do
        from [item: i] in base, where: i.item_type == ^item_type
      else
        base
      end

    base =
      if search_needle do
        from [item: i] in base,
          where: ilike(i.name, ^search_needle) or ilike(i.external_sku, ^search_needle)
      else
        base
      end

    base =
      if warehouse_id do
        wh_item_ids =
          from p in Placement,
            join: l in Lot, on: l.id == p.stock_lot_id and l.company_id == ^company_id,
            join: c in Backend.Warehouses.StorageCell, on: c.id == p.storage_cell_id,
            join: sl in Backend.Warehouses.StorageLocation, on: sl.id == c.storage_location_id,
            join: f in Backend.Warehouses.Floor, on: f.id == sl.floor_id,
            where: f.warehouse_id == ^warehouse_id and p.qty > 0,
            select: l.item_id

        from [item: i] in base, where: i.id in subquery(wh_item_ids)
      else
        base
      end

    base =
      if in_stock_only do
        from q in base,
          having: coalesce(sum(as(:placement).qty), 0) > 0
      else
        base
      end

    base = inventory_apply_sort(base, sort)
    base = inventory_apply_cursor(base, sort, cursor)

    rows = Repo.all(from q in base, limit: ^(limit + 1))

    inventory_take_page(rows, limit, sort)
  end

  defp inventory_sort(nil), do: @inventory_default_sort

  defp inventory_sort({field, dir}) when is_atom(field) and dir in [:asc, :desc] do
    if field in @inventory_sortable, do: {field, dir}, else: @inventory_default_sort
  end

  defp inventory_sort(other) when is_binary(other) do
    case String.split(other, ":") do
      [field, dir] ->
        atom = String.to_existing_atom(field)
        direction = if dir == "desc", do: :desc, else: :asc

        if atom in @inventory_sortable do
          {atom, direction}
        else
          @inventory_default_sort
        end

      _ ->
        @inventory_default_sort
    end
  rescue
    ArgumentError -> @inventory_default_sort
  end

  defp inventory_sort(_), do: @inventory_default_sort

  defp inventory_limit(nil), do: 50
  defp inventory_limit(n) when is_integer(n) and n > 0 and n <= 200, do: n
  defp inventory_limit(_), do: 50

  defp inventory_needle(nil), do: nil
  defp inventory_needle(""), do: nil

  defp inventory_needle(term) when is_binary(term) do
    "%" <> escape_like(String.trim(term)) <> "%"
  end

  defp inventory_needle(_), do: nil

  defp inventory_decode_cursor(nil), do: nil
  defp inventory_decode_cursor(""), do: nil

  defp inventory_decode_cursor(cursor) when is_binary(cursor) do
    with {:ok, decoded} <- Base.url_decode64(cursor, padding: false),
         [field, value, id] <- String.split(decoded, "|", parts: 3) do
      %{field: field, value: value, id: String.to_integer(id)}
    else
      _ -> nil
    end
  rescue
    _ -> nil
  end

  defp inventory_decode_cursor(_), do: nil

  defp inventory_apply_sort(query, {:code, :asc}),
    do: from([item: i] in query, order_by: [asc: i.id])

  defp inventory_apply_sort(query, {:code, :desc}),
    do: from([item: i] in query, order_by: [desc: i.id])

  defp inventory_apply_sort(query, {:name, :asc}),
    do: from([item: i] in query, order_by: [asc: i.name, asc: i.id])

  defp inventory_apply_sort(query, {:name, :desc}),
    do: from([item: i] in query, order_by: [desc: i.name, desc: i.id])

  defp inventory_apply_sort(query, {:qty_on_hand, dir}) do
    from q in query,
      order_by: [
        {^dir, fragment("COALESCE(SUM(?), 0)", as(:placement).qty)},
        asc: as(:item).id
      ]
  end

  defp inventory_apply_sort(query, {:total_cost, dir}) do
    from q in query,
      order_by: [
        {^dir,
         fragment("COALESCE(SUM(? * COALESCE(?, 0)), 0)", as(:placement).qty, as(:lot).unit_cost)},
        asc: as(:item).id
      ]
  end

  defp inventory_apply_sort(query, {:lots_count, dir}) do
    from q in query,
      order_by: [
        {^dir, fragment("COUNT(DISTINCT ?)", as(:lot).id)},
        asc: as(:item).id
      ]
  end

  defp inventory_apply_sort(query, {:earliest_expiry, dir}) do
    # NULLs LAST so items without an expiry don't blot out the
    # "what's about to go bad" view.
    from q in query,
      order_by: [
        fragment("MIN(?) IS NULL", as(:lot).expiry_at),
        {^dir, fragment("MIN(?)", as(:lot).expiry_at)},
        asc: as(:item).id
      ]
  end

  defp inventory_apply_sort(query, {:latest_received_at, dir}) do
    from q in query,
      order_by: [
        fragment("MAX(?) IS NULL", as(:lot).received_at),
        {^dir, fragment("MAX(?)", as(:lot).received_at)},
        asc: as(:item).id
      ]
  end

  defp inventory_apply_cursor(query, _sort, nil), do: query

  defp inventory_apply_cursor(query, {:name, :asc}, %{value: name, id: id}) do
    from [item: i] in query,
      where: i.name > ^name or (i.name == ^name and i.id > ^id)
  end

  defp inventory_apply_cursor(query, {:name, :desc}, %{value: name, id: id}) do
    from [item: i] in query,
      where: i.name < ^name or (i.name == ^name and i.id < ^id)
  end

  # For aggregate sorts we keyset on item.id only — close enough; the
  # SQL would otherwise need a window function. Two items with the
  # identical aggregate land on the page boundary in id-order.
  defp inventory_apply_cursor(query, {_field, :asc}, %{id: id}) do
    from [item: i] in query, where: i.id > ^id
  end

  defp inventory_apply_cursor(query, {_field, :desc}, %{id: id}) do
    from [item: i] in query, where: i.id < ^id
  end

  defp inventory_take_page(rows, limit, sort) do
    if length(rows) > limit do
      page = Enum.take(rows, limit)
      next_cursor = inventory_encode_cursor(List.last(page), sort)
      {page, next_cursor}
    else
      {rows, nil}
    end
  end

  defp inventory_encode_cursor(nil, _), do: nil

  defp inventory_encode_cursor(row, {field, _dir}) do
    value =
      case field do
        :name -> to_string(row.item_name)
        _ -> ""
      end

    encoded = "#{field}|#{value}|#{row.item_id}"
    Base.url_encode64(encoded, padding: false)
  end

  defp maybe_warehouse_filter(query, nil), do: query

  defp maybe_warehouse_filter(query, warehouse_id) when is_integer(warehouse_id) do
    # Match lots that have at least one non-zero placement whose
    # cell rolls up to the requested warehouse. Includes the system
    # Unregistered cell so freshly-received-but-not-put-away lots
    # still show under their warehouse filter.
    warehouse_lot_ids =
      from(p in Placement,
        join: c in Backend.Warehouses.StorageCell, on: c.id == p.storage_cell_id,
        join: l in Backend.Warehouses.StorageLocation, on: l.id == c.storage_location_id,
        join: f in Backend.Warehouses.Floor, on: f.id == l.floor_id,
        where: f.warehouse_id == ^warehouse_id and p.qty > 0,
        select: p.stock_lot_id
      )

    where(query, [l], l.id in subquery(warehouse_lot_ids))
  end

  # ----- write -----------------------------------------------------

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Warehouses.{Floor, StorageCell, StorageLocation, Warehouse}

  @lot_audit_fields ~w(status qty_received unit_cost currency source_kind source_ref
                       supplier_batch_no country_of_origin revision overall_risk
                       allergen_status coa_status quality_status manufactured_at
                       expiry_at available_from received_at notes
                       package_length_mm package_width_mm package_height_mm
                       package_weight_kg units_per_package stack_factor)a

  @doc """
  Receive a new lot — atomic create of lot + initial placement +
  initial movement. All three rows land in one transaction so we
  never publish a lot row with no movement behind it (and vice
  versa).

  `attrs` shape (string keys, mirrors the controller body):

      %{
        "item_id" => 12,                       # required
        "qty_received" => "25",                # required
        "unit_of_measurement_id" => 4,         # required
        "destination_cell_id" => 87,           # required
        "status" => "received",                # default "received"
        "unit_cost" => "5.15",                 # optional
        "currency" => "GBP",
        "source_kind" => "purchase_order",
        "source_ref" => "PO00438",
        "supplier_batch_no" => "BATCH-AA-42",
        "country_of_origin" => "IT",
        "revision" => "V00",
        "available_from" => "2026-06-08T09:00:00Z",
        "expiry_at" => "2028-06-04",
        "manufactured_at" => "2025-05-21",
        "overall_risk" => "low",
        "allergen_status" => "pending",
        "coa_status" => "accepted",
        "quality_status" => "pending",
        "notes" => "Heat-treated batch"
      }
  """
  def receive_lot(%User{} = actor, company_id, attrs) when is_integer(company_id) do
    # Multi-cell receive: callers may pass `placements: [{cell_id, qty}, …]`
    # to land the same lot across N cells in one shot. The old
    # single-cell shape (`destination_cell_id` + `qty_received`)
    # still works — it collapses to a one-row placements list.
    with {:ok, %Item{} = item} <- fetch_item(actor.company_id, attrs["item_id"]),
         {:ok, placement_specs} <- parse_placements(actor.company_id, attrs) do
      now = DateTime.utc_now() |> DateTime.truncate(:second)

      total_qty =
        Enum.reduce(placement_specs, Decimal.new(0), fn {_cell, qty}, acc ->
          Decimal.add(acc, qty)
        end)

      # `source_kind` is derived from the calling flow, never operator-
      # supplied. `__service_source_kind__` is the internal hand-off the
      # PO-receive path uses to declare "this is a PO receipt"; absence
      # means the manual receive form, which is always `"manual"`.
      # Anything the operator might smuggle in their attrs is dropped.
      service_source_kind = attrs["__service_source_kind__"] || "manual"

      # `__goods_in_inspection_id__` is the PO-receive hand-off that
      # wires every lot from one delivery back to its governing
      # inspection. Surfaces as a real FK on the lot row so the
      # approver-sign transaction can look up "every lot from this
      # inspection" without walking the event log.
      goods_in_inspection_id = attrs["__goods_in_inspection_id__"]

      lot_attrs =
        attrs
        |> Map.drop([
          "placements",
          "destination_cell_id",
          "warehouse_id",
          "source_kind",
          "status",
          "__service_source_kind__",
          "__po_line_id__",
          "__goods_in_inspection_id__"
        ])
        |> Map.put("company_id", company_id)
        |> Map.put("item_id", item.id)
        |> Map.put("qty_received", total_qty)
        |> maybe_put("goods_in_inspection_id", goods_in_inspection_id)
        # Land at `expected` so the lifecycle event we emit below
        # (`received`) does the real status flip via the projection.
        # The lot row is never in `expected` for more than a few
        # microseconds inside the transaction — the projection update
        # ships in the same `Repo.transaction/1`.
        |> Map.put("status", "expected")
        |> Map.put_new_lazy("received_at", fn -> now end)
        |> Map.put_new_lazy("available_from", fn -> now end)
        |> Map.put("source_kind", service_source_kind)
        |> Map.put("created_by_id", actor.id)
        |> Map.put("updated_by_id", actor.id)

      Repo.transaction(fn ->
        with {:ok, lot} <-
               %Lot{} |> Lot.changeset(lot_attrs) |> Repo.insert(),
             {:ok, _} <-
               insert_placements_and_movements(
                 actor,
                 company_id,
                 lot,
                 placement_specs,
                 now,
                 attrs
               ),
             {:ok, %{lot: lot_after_event}} <-
               emit_received_event(actor, lot, attrs, now) do
          Audit.record_created(actor, "stock_lot", lot_after_event, lot_audit_snapshot(lot_after_event))

          Repo.preload(lot_after_event, [
            :item,
            :unit_of_measurement,
            :created_by,
            :updated_by,
            placements: [:storage_cell],
            movements: [:from_cell, :to_cell, :actor]
          ])
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          other -> Repo.rollback(other)
        end
      end)
    end
  end

  # Emit the lifecycle `received` event so the lot lands with a
  # non-empty event log. Metadata carries the source linkage (PO line
  # id when the receipt is against a PO) so the timeline can trace
  # back without a join. Runs inside the parent `Repo.transaction/1`
  # so a failed event write rolls the lot row back too.
  defp emit_received_event(%User{} = actor, %Lot{} = lot, attrs, _now) do
    metadata =
      %{}
      |> maybe_put_metadata("source_ref", attrs["source_ref"])
      |> maybe_put_metadata("po_line_id", attrs["__po_line_id__"])

    case Backend.Stock.Lifecycle.record_event_in_transaction(
           lot,
           "received",
           %{
             actor: actor,
             actor_kind: "user",
             reason: attrs["receive_reason"],
             metadata: metadata
           }
         ) do
      {:ok, result} -> {:ok, result}
      {:error, :illegal_transition, info} -> {:error, {:illegal_transition, info}}
      {:error, other} -> {:error, other}
    end
  end

  defp maybe_put_metadata(map, _key, nil), do: map
  defp maybe_put_metadata(map, _key, ""), do: map
  defp maybe_put_metadata(map, key, value), do: Map.put(map, key, value)

  # Same shape but for the outer attrs map — only set the key when
  # the caller actually supplied a value. Used by the PO-receive lot
  # hand-off so a manual receive (no inspection) doesn't NULL the
  # column with an explicit nil cast.
  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, _key, ""), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  @doc """
  Receive several lots in one shot, sharing item + destination + most
  identity fields but each with its own packaging + qty + (optionally)
  supplier batch number. This is the manual-side equivalent of the
  PO receive flow's per-pack split, used when a single delivery
  arrives as mixed packaging — e.g. 100kg of an ingredient as 4×25kg
  drums + 1×50kg sack, or 50kg as 2×25kg bags.

  Atomic: every pack creates one lot inside a single `Repo.transaction`,
  so partial-success is impossible. If any pack fails the whole bulk
  rolls back and the caller gets the failing pack's index + reason
  via `{:error, {pack_index, reason}}`.

  `common_attrs` shape (string keys): item_id, warehouse_id, currency,
  unit_cost, country_of_origin, revision, manufactured_at, expiry_at,
  available_from, overall_risk, allergen_status, coa_status,
  quality_status, notes.

  `pack_attrs_list` is a list of per-pack attribute maps. Each must
  carry `qty_received` + the six packaging dims + optionally a
  `supplier_batch_no` override (falls back to `common_attrs["supplier_batch_no"]`).
  """
  def receive_lots_bulk(%User{} = actor, company_id, common_attrs, pack_attrs_list)
      when is_integer(company_id) and is_list(pack_attrs_list) do
    cond do
      pack_attrs_list == [] ->
        {:error, :no_packs}

      true ->
        Repo.transaction(fn ->
          pack_attrs_list
          |> Enum.with_index()
          |> Enum.reduce_while([], fn {pack_attrs, idx}, acc ->
            attrs = merge_pack_attrs(common_attrs, pack_attrs)

            case receive_lot(actor, company_id, attrs) do
              {:ok, lot} -> {:cont, [lot | acc]}
              {:error, reason} -> {:halt, {:error, {idx, reason}}}
            end
          end)
          |> case do
            {:error, _} = err -> Repo.rollback(err)
            lots when is_list(lots) -> Enum.reverse(lots)
          end
        end)
        |> case do
          {:ok, lots} -> {:ok, lots}
          {:error, {:error, payload}} -> {:error, payload}
          {:error, payload} -> {:error, payload}
        end
    end
  end

  # Compose the final receive_lot/3 attrs by overlaying the per-pack
  # bag on top of the shared bag, then handling the per-pack
  # supplier_batch_no override explicitly (the empty-string fallback
  # protects against the FE sending blank inputs).
  defp merge_pack_attrs(common, pack) do
    common
    |> Map.merge(pack)
    |> maybe_carry_supplier_batch(common, pack)
  end

  defp maybe_carry_supplier_batch(merged, common, pack) do
    case pack["supplier_batch_no"] do
      nil -> Map.put(merged, "supplier_batch_no", common["supplier_batch_no"])
      "" -> Map.put(merged, "supplier_batch_no", common["supplier_batch_no"])
      _ -> merged
    end
  end

  @doc """
  Every lot stamped with the given inspection id. The goods-in
  quality-approver transaction walks this list and emits one
  lifecycle event per lot based on the (inspection-level decision,
  per-line decision) tuple.

  Returns a plain list of `%Lot{}` structs with no preloads — the
  caller is the goods-in boundary, which already holds the inspection
  + per-line decisions and only needs the lot rows to drive the
  lifecycle calls.
  """
  def list_lots_for_inspection(inspection_id) when is_integer(inspection_id) do
    Repo.all(
      from(l in Lot,
        where: l.goods_in_inspection_id == ^inspection_id,
        order_by: [asc: l.id]
      )
    )
  end

  def list_lots_for_inspection(_), do: []

  # Resolve the destination into a list of `{cell, qty_decimal}`
  # tuples. Accepted shapes, in priority order:
  #
  #   1. `warehouse_id` + `qty_received` (or `qty`) — current canonical
  #      manual-lot shape. Stock lands in the warehouse's auto-managed
  #      Unregistered cell; operators later scan-move it to a real
  #      shelf. This is the only path the new receive form uses.
  #   2. `placements: [{cell_id, qty}, …]` — legacy/multi-cell shape
  #      kept around so the procurement module can target specific
  #      cells when it ships.
  #   3. `destination_cell_id` + `qty_received` — original single-cell
  #      shape from before the multi-cell migration.
  defp parse_placements(company_id, %{"warehouse_id" => raw} = attrs)
       when raw not in [nil, ""] do
    warehouse_id = parse_int(raw)
    qty_raw = attrs["qty_received"] || attrs["qty"]

    with {:ok, warehouse} <- fetch_warehouse(company_id, warehouse_id),
         {:ok, qty} <- parse_positive_decimal(qty_raw) do
      cell = Backend.Warehouses.get_or_create_unregistered_cell!(warehouse)
      {:ok, [{cell, qty}]}
    end
  end

  defp parse_placements(company_id, %{"placements" => list}) when is_list(list) do
    if list == [] do
      {:error, :no_placements}
    else
      Enum.reduce_while(list, {:ok, []}, fn row, {:ok, acc} ->
        cell_id = parse_int(row["cell_id"] || row["storage_cell_id"])
        qty_raw = row["qty"] || row["qty_received"]

        with {:ok, cell} <- fetch_cell(company_id, cell_id),
             {:ok, qty} <- parse_positive_decimal(qty_raw) do
          {:cont, {:ok, acc ++ [{cell, qty}]}}
        else
          err -> {:halt, err}
        end
      end)
    end
  end

  defp parse_placements(company_id, attrs) do
    cell_id = parse_int(attrs["destination_cell_id"])
    qty_raw = attrs["qty_received"]

    with {:ok, cell} <- fetch_cell(company_id, cell_id),
         {:ok, qty} <- parse_positive_decimal(qty_raw) do
      {:ok, [{cell, qty}]}
    end
  end

  defp parse_int(nil), do: nil
  defp parse_int(v) when is_integer(v), do: v

  defp parse_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp parse_int(_), do: nil

  defp insert_placements_and_movements(
         actor,
         company_id,
         %Lot{} = lot,
         placement_specs,
         now,
         attrs
       ) do
    Enum.reduce_while(placement_specs, {:ok, []}, fn {cell, qty}, {:ok, acc} ->
      with {:ok, placement} <-
             %Placement{}
             |> Placement.changeset(%{
               "company_id" => company_id,
               "stock_lot_id" => lot.id,
               "storage_cell_id" => cell.id,
               "qty" => qty
             })
             |> Repo.insert(),
           {:ok, movement} <-
             %Movement{}
             |> Movement.changeset(%{
               "company_id" => company_id,
               "stock_lot_id" => lot.id,
               "to_cell_id" => cell.id,
               "delta_qty" => qty,
               "kind" => "receive",
               "reason" => "Initial receipt",
               "reference_kind" => attrs["source_kind"],
               "reference_ref" => attrs["source_ref"],
               "actor_id" => actor.id,
               "occurred_at" => now
             })
             |> Repo.insert() do
        Audit.record_created(actor, "stock_lot_placement", placement, %{
          qty: placement.qty,
          storage_cell_id: placement.storage_cell_id
        })

        Audit.record_created(actor, "stock_movement", movement, %{
          kind: movement.kind,
          delta_qty: movement.delta_qty,
          to_cell_id: movement.to_cell_id
        })

        {:cont, {:ok, [{placement, movement} | acc]}}
      else
        err -> {:halt, err}
      end
    end)
  end

  # ----- move ----------------------------------------------------------

  @doc """
  Move stock for `lot` from `from_cell` to `to_cell`, all-or-nothing.

  Inputs:
    * `actor`     — User performing the move (recorded on the movement)
    * `lot_uuid`  — public uuid of the lot
    * `attrs`     — `%{"to_cell_uuid", "qty", "photo_url" | "skip_photo_reason"}`

  Behaviour:
    * `from_cell` is the lot's only current placement when the operator
      doesn't pass one explicitly (the common case from /m where stock
      is sitting in the warehouse's Unregistered cell).
    * Qty defaults to the full from-placement when omitted.
    * Decrements the source placement, upserts the destination, inserts
      a `move` movement carrying the photo URL or skip-reason. If the
      source hits zero it stays at zero (kept for the history rollup).

  Error tuples: `:lot_not_found | :cell_not_found | :bad_qty |
  :placement_not_found | :insufficient_qty`.
  """
  def move_placement(%User{} = actor, lot_uuid, attrs) when is_binary(lot_uuid) do
    with {:ok, lot} <- fetch_lot_by_uuid(actor.company_id, lot_uuid),
         :ok <- ensure_not_locked_by_pickup(lot),
         {:ok, to_cell} <-
           fetch_cell_by_uuid(actor.company_id, attrs["to_cell_uuid"]),
         {:ok, from_placement} <- resolve_from_placement(lot, attrs["from_cell_uuid"]),
         {:ok, qty} <- resolve_move_qty(from_placement, attrs["qty"]),
         :ok <- ensure_distinct_cells(from_placement.storage_cell_id, to_cell.id) do
      now = DateTime.utc_now() |> DateTime.truncate(:second)

      Repo.transaction(fn ->
        with {:ok, new_from} <- decrement_placement(from_placement, qty),
             {:ok, new_to} <- upsert_placement(lot, to_cell, qty),
             {:ok, movement} <- insert_move_movement(actor, lot, from_placement, to_cell, qty, attrs, now) do
          Audit.record_updated(
            actor,
            "stock_lot_placement",
            new_from,
            %{qty: from_placement.qty, storage_cell_id: from_placement.storage_cell_id},
            %{qty: new_from.qty, storage_cell_id: new_from.storage_cell_id}
          )

          Audit.record_created(actor, "stock_lot_placement", new_to, %{
            qty: new_to.qty,
            storage_cell_id: new_to.storage_cell_id
          })

          Audit.record_created(actor, "stock_movement", movement, %{
            kind: movement.kind,
            delta_qty: movement.delta_qty,
            from_cell_id: movement.from_cell_id,
            to_cell_id: movement.to_cell_id
          })

          Repo.preload(lot, [
            :item,
            :unit_of_measurement,
            placements: [storage_cell: [storage_location: [floor: [:warehouse]]]],
            movements: [:from_cell, :to_cell, :actor]
          ])
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  @doc """
  Manually adjust a placement's qty up or down. Records an `adjust_up`
  or `adjust_down` movement carrying the operator's reason. Used for
  shrinkage / re-counts / damage write-offs where no physical move
  happened — qty just diverged from the last known count.

  `attrs` shape:

      %{
        "from_cell_uuid" => "…",          # optional when there's a single placement
        "delta_qty"      => "5" | "-3",   # signed; positive = up, negative = down
        "reason"         => "stock take"
      }

  Error tuples: `:lot_not_found | :placement_not_found |
  :ambiguous_placement | :bad_qty | :insufficient_qty`.
  """
  def adjust_placement(%Backend.Accounts.User{} = actor, lot_uuid, attrs)
      when is_binary(lot_uuid) and is_map(attrs) do
    with {:ok, lot} <- fetch_lot_by_uuid(actor.company_id, lot_uuid),
         :ok <- ensure_not_locked_by_pickup(lot),
         {:ok, placement} <- resolve_from_placement(lot, attrs["from_cell_uuid"]),
         {:ok, delta} <- parse_signed_decimal(attrs["delta_qty"]),
         {:ok, kind} <- adjust_kind(delta),
         :ok <- ensure_non_negative_after(placement, delta) do
      now = DateTime.utc_now() |> DateTime.truncate(:second)

      Repo.transaction(fn ->
        new_qty = Decimal.add(placement.qty, delta)
        before_qty = placement.qty

        with {:ok, updated_placement} <-
               placement
               |> Placement.changeset(%{"qty" => new_qty})
               |> Repo.update(),
             {:ok, movement} <-
               %Movement{}
               |> Movement.changeset(%{
                 "company_id" => lot.company_id,
                 "stock_lot_id" => lot.id,
                 "from_cell_id" =>
                   if(Decimal.negative?(delta), do: placement.storage_cell_id),
                 "to_cell_id" =>
                   if(Decimal.negative?(delta), do: nil, else: placement.storage_cell_id),
                 "delta_qty" => delta,
                 "kind" => kind,
                 "reason" => attrs["reason"],
                 "actor_id" => actor.id,
                 "occurred_at" => now
               })
               |> Repo.insert() do
          Backend.Audit.record_updated(
            actor,
            "stock_lot_placement",
            updated_placement,
            %{qty: before_qty, storage_cell_id: placement.storage_cell_id},
            %{qty: updated_placement.qty, storage_cell_id: updated_placement.storage_cell_id}
          )

          Backend.Audit.record_created(actor, "stock_movement", movement, %{
            kind: movement.kind,
            delta_qty: movement.delta_qty,
            from_cell_id: movement.from_cell_id,
            to_cell_id: movement.to_cell_id,
            reason: movement.reason
          })

          cell_with_breadcrumb = [storage_location: [floor: :warehouse]]

          Repo.preload(lot, [
            :item,
            :unit_of_measurement,
            placements: [storage_cell: cell_with_breadcrumb],
            movements:
              from(m in Movement,
                order_by: [desc: m.occurred_at, desc: m.id],
                preload: [
                  :actor,
                  from_cell: ^cell_with_breadcrumb,
                  to_cell: ^cell_with_breadcrumb
                ]
              )
          ])
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  def adjust_placement(_actor, _uuid, _attrs), do: {:error, :bad_args}

  defp parse_signed_decimal(nil), do: {:error, :bad_qty}

  defp parse_signed_decimal(raw) when is_binary(raw) do
    case Decimal.parse(String.trim(raw)) do
      {%Decimal{} = d, ""} ->
        if Decimal.eq?(d, 0), do: {:error, :bad_qty}, else: {:ok, d}

      _ ->
        {:error, :bad_qty}
    end
  end

  defp parse_signed_decimal(raw) when is_integer(raw) and raw != 0,
    do: {:ok, Decimal.new(raw)}

  defp parse_signed_decimal(_), do: {:error, :bad_qty}

  defp adjust_kind(%Decimal{} = delta) do
    if Decimal.negative?(delta), do: {:ok, "adjust_down"}, else: {:ok, "adjust_up"}
  end

  defp ensure_non_negative_after(%Placement{qty: current}, %Decimal{} = delta) do
    if Decimal.lt?(Decimal.add(current, delta), 0) do
      {:error, :insufficient_qty}
    else
      :ok
    end
  end

  defp fetch_lot_by_uuid(company_id, uuid) when is_binary(uuid) do
    case Repo.get_by(Lot, uuid: uuid) do
      %Lot{company_id: ^company_id} = l ->
        {:ok, Repo.preload(l, placements: [storage_cell: [storage_location: [floor: [:warehouse]]]])}

      _ ->
        {:error, :lot_not_found}
    end
  end

  defp fetch_lot_by_uuid(_, _), do: {:error, :lot_not_found}

  defp fetch_cell_by_uuid(company_id, uuid) when is_binary(uuid) and uuid != "" do
    case Repo.get_by(StorageCell, uuid: uuid) do
      %StorageCell{company_id: ^company_id} = c -> {:ok, c}
      _ -> {:error, :cell_not_found}
    end
  end

  defp fetch_cell_by_uuid(_, _), do: {:error, :cell_not_found}

  # When the operator doesn't say which cell to move from (the common
  # case — the lot only lives at the Unregistered cell), pick the
  # single non-zero placement. If there's more than one we bail and ask
  # them to disambiguate; better than picking arbitrarily.
  defp resolve_from_placement(%Lot{placements: placements}, nil) do
    case Enum.filter(placements, fn p -> Decimal.gt?(p.qty, 0) end) do
      [single] -> {:ok, single}
      [] -> {:error, :placement_not_found}
      _ -> {:error, :ambiguous_placement}
    end
  end

  defp resolve_from_placement(%Lot{placements: placements}, uuid)
       when is_binary(uuid) do
    case Enum.find(placements, fn p ->
           p.storage_cell && p.storage_cell.uuid == uuid
         end) do
      %Placement{} = p -> {:ok, p}
      _ -> {:error, :placement_not_found}
    end
  end

  defp resolve_move_qty(%Placement{qty: available}, nil), do: {:ok, available}

  defp resolve_move_qty(%Placement{qty: available}, qty_raw) do
    with {:ok, qty} <- parse_positive_decimal(qty_raw),
         true <- Decimal.lte?(qty, available) do
      {:ok, qty}
    else
      false -> {:error, :insufficient_qty}
      err -> err
    end
  end

  defp ensure_distinct_cells(from_id, to_id) when from_id == to_id,
    do: {:error, :same_cell}

  defp ensure_distinct_cells(_, _), do: :ok

  # Trolley guard — refuse physical placement mutations on a lot that
  # is currently booked to a pickup-in-progress MO. Matches the QC
  # event guard in Stock.Lifecycle so both lot-status and lot-quantity
  # paths agree: once the picker has the lot on the trolley, no one
  # else can move it or write off qty until the pickup completes or
  # aborts.
  defp ensure_not_locked_by_pickup(%Lot{id: lot_id}) do
    if Backend.Production.lot_locked_by_pickup?(lot_id) do
      {:error, :locked_by_pickup_in_progress}
    else
      :ok
    end
  end

  defp decrement_placement(%Placement{} = p, qty) do
    new_qty = Decimal.sub(p.qty, qty)

    p
    |> Placement.changeset(%{"qty" => new_qty})
    |> Repo.update()
  end

  defp upsert_placement(%Lot{} = lot, %StorageCell{} = cell, qty) do
    case Repo.get_by(Placement, stock_lot_id: lot.id, storage_cell_id: cell.id) do
      %Placement{} = existing ->
        existing
        |> Placement.changeset(%{"qty" => Decimal.add(existing.qty, qty)})
        |> Repo.update()

      nil ->
        %Placement{}
        |> Placement.changeset(%{
          "company_id" => lot.company_id,
          "stock_lot_id" => lot.id,
          "storage_cell_id" => cell.id,
          "qty" => qty
        })
        |> Repo.insert()
    end
  end

  defp insert_move_movement(actor, lot, from_placement, to_cell, qty, attrs, now) do
    %Movement{}
    |> Movement.changeset(%{
      "company_id" => lot.company_id,
      "stock_lot_id" => lot.id,
      "from_cell_id" => from_placement.storage_cell_id,
      "to_cell_id" => to_cell.id,
      "delta_qty" => qty,
      "kind" => "move",
      "reason" => attrs["reason"],
      "actor_id" => actor.id,
      "occurred_at" => now,
      "photo_url" => attrs["photo_url"],
      "skip_photo_reason" => attrs["skip_photo_reason"]
    })
    |> Repo.insert()
  end

  # ----- pending putaway / lookups -------------------------------------

  @doc """
  Lots that still have stock sitting in a system Unregistered cell.
  Used by the mobile /m pending-putaway list.
  """
  def list_pending_putaway(company_id) when is_integer(company_id) do
    # Two flavours of "pending putaway":
    #
    #   1. Anything physically in the auto-managed `unregistered`
    #      staging cell — that's the manual-receive flow's parking
    #      spot.
    #   2. `available` lots still sitting in a `quarantine` purpose
    #      cell — QC just cleared them but the operator hasn't picked
    #      a real shelf yet. The auto-router deliberately doesn't move
    #      these (`Backend.Stock.AutoRouter`'s status->purpose matrix
    #      excludes `available`) so put-away stays an operator
    #      decision, not a silent system move.
    from(l in Lot,
      join: p in Placement,
      on: p.stock_lot_id == l.id,
      join: c in StorageCell,
      on: c.id == p.storage_cell_id,
      where:
        l.company_id == ^company_id and
          p.qty > 0 and
          (c.system_kind == "unregistered" or
             (l.status == "available" and c.purpose == "quarantine")),
      distinct: l.id,
      preload: [
        :item,
        :unit_of_measurement,
        placements:
          ^from(p in Placement,
            preload: [storage_cell: [storage_location: [floor: [:warehouse]]]]
          )
      ],
      order_by: [desc: l.received_at]
    )
    |> Repo.all()
  end

  @doc """
  Look up a lot by uuid with full breadcrumb preloads. Mobile scanner
  hits this after decoding the QR.
  """
  def get_for_scan(company_id, uuid) when is_integer(company_id) and is_binary(uuid) do
    case Repo.get_by(Lot, uuid: uuid) do
      %Lot{company_id: ^company_id} = lot ->
        Repo.preload(lot, [
          :item,
          :unit_of_measurement,
          placements: [storage_cell: [storage_location: [floor: [:warehouse]]]],
          movements: [:from_cell, :to_cell, :actor]
        ])

      _ ->
        nil
    end
  end

  @doc """
  Recommend cells for moving `lot` out of its current placement, ranked
  by usefulness:

    1. Cells already holding any lot of the same item (consolidation —
       same SKU shouldn't be split across shelves if avoidable).
    2. Cells whose effective tag set ⊇ item.storage_tags (matches the
       item's storage requirements). Higher rank when ALL tags match.
    3. Other cells with at least one matching tag.

  System (Unregistered) cells are excluded — those are where stock
  *leaves from*, not where it lands. Caps at `limit` to keep the
  mobile UI snappy.
  """
  def list_move_recommendations(company_id, lot_uuid, opts \\ [])
      when is_integer(company_id) and is_binary(lot_uuid) do
    limit = Keyword.get(opts, :limit, 6)

    with %Lot{} = lot <-
           Repo.get_by(Lot, uuid: lot_uuid, company_id: company_id) do
      lot = Repo.preload(lot, [:item])
      item_tags = (lot.item && lot.item.storage_tags) || []
      lot_footprint = compute_lot_footprint(lot)

      # 1. Cells that already hold ANY lot of the same item — used as
      #    a MapSet for the consolidation scoring rule.
      consolidation_cell_ids =
        from(p in Placement,
          join: other in Lot,
          on: other.id == p.stock_lot_id,
          where:
            other.item_id == ^lot.item_id and
              other.company_id == ^company_id and
              p.qty > 0,
          select: p.storage_cell_id,
          distinct: true
        )
        |> Repo.all()
        |> MapSet.new()

      # 1b. Cells the lot is CURRENTLY in. Excluded from candidates
      #     below — "move to the cell you're already in" isn't a
      #     useful suggestion. Stored separately from consolidation
      #     because for same-item consolidation we still want the
      #     hint to surface (just on neighbouring cells).
      source_cell_ids =
        from(p in Placement,
          where: p.stock_lot_id == ^lot.id and p.qty > 0,
          select: p.storage_cell_id,
          distinct: true
        )
        |> Repo.all()

      # 1c. Warehouse(s) the lot is currently sitting in. The operator
      #     can only physically walk a lot within the same warehouse
      #     during put-away, so candidates must live in the same site.
      #     If the lot has no live placements (edge case — fresh lot)
      #     we fall back to "any warehouse" rather than block all
      #     suggestions.
      source_warehouse_ids =
        from(p in Placement,
          join: c in StorageCell,
          on: c.id == p.storage_cell_id,
          join: l in StorageLocation,
          on: l.id == c.storage_location_id,
          where: p.stock_lot_id == ^lot.id and p.qty > 0,
          select: l.warehouse_id,
          distinct: true
        )
        |> Repo.all()

      # 2. Committed footprint per cell — sum each placement's
      #    (qty × packaging dims) so we know the *real* free space.
      #    Joined to the lot for packaging dims; lots without dims are
      #    treated as zero-footprint (legacy data won't lock cells).
      committed_by_cell =
        from(p in Placement,
          join: pl in Lot,
          on: pl.id == p.stock_lot_id,
          where: p.qty > 0 and pl.company_id == ^company_id,
          select: {p.storage_cell_id, p, pl}
        )
        |> Repo.all()
        |> Enum.group_by(fn {cell_id, _, _} -> cell_id end, fn {_, p, l} ->
          compute_lot_footprint(%{l | qty_received: p.qty})
        end)
        |> Map.new(fn {cell_id, footprints} ->
          {cell_id, sum_footprints(footprints)}
        end)

      # 3. Candidate cells with breadcrumb. Source cells are excluded
      #    so the recommender never suggests "move here" for the cell
      #    the lot is already in.
      #
      #    Purpose = "regular" only — every other purpose is workflow-
      #    specific and must never appear as a put-away suggestion:
      #
      #      quarantine       — set by the receive flow
      #      hold / rejected  — set by QC verdict (auto-router)
      #      dispatch         — set by the picker after staging
      #      production_feed  — set by the picker walking stock to the line
      #
      #    Suggesting any of these for a QC-passed put-away breaks the
      #    audit chain (the cell's intent stops matching the lot's
      #    state) and physically shoves stock into the wrong area.
      base_query =
        from c in StorageCell,
          join: l in StorageLocation,
          on: l.id == c.storage_location_id,
          join: f in Floor,
          on: f.id == l.floor_id,
          join: w in Warehouse,
          on: w.id == l.warehouse_id,
          where:
            c.company_id == ^company_id and
              c.purpose == "regular" and
              is_nil(c.system_kind) and
              is_nil(l.system_kind) and
              is_nil(f.system_kind) and
              c.id not in ^source_cell_ids,
          select: %{cell: c, location: l, floor: f, warehouse: w}

      # Restrict to the warehouse(s) the lot is currently in — put-away
      # is a physical walk, so a cell in another site (e.g. unit 11
      # when the lot sits in unit 12) is never a legitimate suggestion.
      # Skip the filter when the lot has no live placements anywhere
      # (fresh lot, or all-consumed) so the recommender still has
      # something to offer in that edge case.
      #
      # Fallback: if the source warehouse has NO regular cells at all
      # (typical for a production-only site that holds nothing in
      # long-term storage), drop the warehouse filter so the operator
      # gets candidates from the main warehouse. Without this, a lot
      # stranded at a production-feed cell in a pure-production site
      # shows zero suggestions and the operator can't return it
      # anywhere via the recommender.
      query =
        case source_warehouse_ids do
          [] ->
            base_query

          ids ->
            scoped = from [c, l, f, w] in base_query, where: l.warehouse_id in ^ids

            if Repo.exists?(scoped) do
              scoped
            else
              base_query
            end
        end

      query
      |> Repo.all()
      |> Enum.map(fn row ->
        has_consolidation = MapSet.member?(consolidation_cell_ids, row.cell.id)
        committed = Map.get(committed_by_cell, row.cell.id, empty_footprint())
        capacity = compute_cell_capacity(row.cell, committed)
        fit = check_fit(lot_footprint, capacity)

        score_recommendation(
          row
          |> Map.put(:has_consolidation, has_consolidation)
          |> Map.put(:fit, fit),
          item_tags
        )
      end)
      |> Enum.reject(fn r -> r.score == 0 or r.row.fit.disqualified? end)
      |> Enum.sort_by(fn r -> {-r.score, r.row.fit.percent_used, r.row.cell.id} end)
      |> Enum.take(limit)
    else
      _ -> []
    end
  end

  defp score_recommendation(row, item_tags) do
    cell_tags = (row.cell.tags || []) ++ (row.location.tags || [])
    cell_tag_set = MapSet.new(cell_tags)
    item_tag_set = MapSet.new(item_tags || [])

    base =
      cond do
        row.has_consolidation -> 10
        item_tag_set == MapSet.new() -> 1
        MapSet.subset?(item_tag_set, cell_tag_set) -> 8
        MapSet.size(MapSet.intersection(item_tag_set, cell_tag_set)) > 0 -> 4
        true -> 0
      end

    # Fit nudges the score: lots of headroom is preferred over a tight
    # fit. `percent_used` ranges 0..100; convert into a small bonus.
    fit_bonus =
      case row.fit do
        %{disqualified?: true} -> 0
        %{percent_used: pct} when pct < 50 -> 2
        %{percent_used: pct} when pct < 80 -> 1
        _ -> 0
      end

    # `base` carries the actual reason category (consolidation /
    # tag-fit / fallback) — surfaced separately so the controller can
    # render the right label. `score` (base + fit) is the ordering
    # metric.
    %{row: row, score: base + fit_bonus, base_score: base}
  end

  # ----- fit math -------------------------------------------------------

  defp empty_footprint do
    %{
      footprint_area_mm2: Decimal.new(0),
      stack_height_mm: 0,
      weight_kg: Decimal.new(0)
    }
  end

  # Compute a lot's physical footprint from its packaging dims +
  # qty_received. Returns `:unknown` when any packaging field is missing
  # so callers can degrade gracefully (legacy lots don't lock cells).
  defp compute_lot_footprint(%Lot{} = lot) do
    cond do
      is_nil(lot.package_length_mm) or is_nil(lot.package_width_mm) or
        is_nil(lot.package_height_mm) or is_nil(lot.package_weight_kg) or
          is_nil(lot.units_per_package) or is_nil(lot.stack_factor) ->
        :unknown

      true ->
        # `units_per_package` is now `decimal` (was integer) — accept
        # a %Decimal{} as-is; convert other shapes through Decimal.new.
        units_per_package =
          case lot.units_per_package do
            %Decimal{} = d -> d
            other -> Decimal.new(other)
          end

        qty = lot.qty_received || Decimal.new(0)
        packages = qty |> Decimal.div(units_per_package) |> Decimal.round(0, :up)
        packages_int = Decimal.to_integer(packages)
        stacks = ceil_div(packages_int, lot.stack_factor)

        footprint_area_mm2 =
          Decimal.new(stacks)
          |> Decimal.mult(Decimal.new(lot.package_length_mm))
          |> Decimal.mult(Decimal.new(lot.package_width_mm))

        # Actual stack height = how tall the TALLEST column ends up.
        # `stack_factor` is the operator's safety cap, not the size of
        # the lot — a 1-package lot with stack_factor=50 occupies one
        # 250mm slot, not 12,500mm. We take `min(packages, stack_factor)`
        # so a partial column counts as its actual height.
        tallest_column = min(packages_int, lot.stack_factor)
        stack_height_mm = tallest_column * lot.package_height_mm

        total_weight_kg =
          Decimal.mult(Decimal.new(packages_int), lot.package_weight_kg)

        %{
          footprint_area_mm2: footprint_area_mm2,
          stack_height_mm: stack_height_mm,
          weight_kg: total_weight_kg
        }
    end
  end

  defp compute_lot_footprint(_), do: :unknown

  defp ceil_div(_, 0), do: 0
  defp ceil_div(num, den) when num <= 0, do: 0
  defp ceil_div(num, den), do: div(num + den - 1, den)

  defp sum_footprints(list) when is_list(list) do
    Enum.reduce(list, empty_footprint(), fn
      :unknown, acc ->
        acc

      f, acc ->
        %{
          footprint_area_mm2:
            Decimal.add(acc.footprint_area_mm2, f.footprint_area_mm2),
          stack_height_mm: max(acc.stack_height_mm, f.stack_height_mm),
          weight_kg: Decimal.add(acc.weight_kg, f.weight_kg)
        }
    end)
  end

  # Total cell capacity minus already-committed footprints.
  defp compute_cell_capacity(%StorageCell{} = cell, committed) do
    # Cell dims in metres → millimetres for the comparison. Missing
    # dims = treat cell as "unbounded" (operator skipped dims, we
    # don't want to block them).
    length_mm = decimal_metres_to_mm(cell.width_m)
    width_mm = decimal_metres_to_mm(cell.depth_m)
    height_mm = decimal_metres_to_mm(cell.height_m)

    total_area_mm2 =
      if length_mm && width_mm,
        do: Decimal.mult(Decimal.new(length_mm), Decimal.new(width_mm)),
        else: nil

    max_weight_kg = cell.max_weight_kg

    %{
      total_area_mm2: total_area_mm2,
      committed_area_mm2: committed.footprint_area_mm2,
      total_height_mm: height_mm,
      committed_height_mm: committed.stack_height_mm,
      total_weight_kg: max_weight_kg,
      committed_weight_kg: committed.weight_kg
    }
  end

  defp decimal_metres_to_mm(nil), do: nil

  defp decimal_metres_to_mm(%Decimal{} = m) do
    m
    |> Decimal.mult(Decimal.new(1000))
    |> Decimal.round(0)
    |> Decimal.to_integer()
  end

  defp decimal_metres_to_mm(other) when is_number(other),
    do: round(other * 1000)

  # Decide whether the lot's footprint fits in the cell's remaining
  # capacity. Returns a map the recommender uses for filtering + scoring
  # + UI labels.
  defp check_fit(:unknown, _capacity) do
    # Legacy lot without packaging dims — don't block recommendations.
    %{disqualified?: false, reason: nil, percent_used: 0, free_pct: 100}
  end

  defp check_fit(footprint, capacity) do
    over_weight =
      not is_nil(capacity.total_weight_kg) and
        Decimal.gt?(
          Decimal.add(capacity.committed_weight_kg, footprint.weight_kg),
          capacity.total_weight_kg
        )

    over_area =
      not is_nil(capacity.total_area_mm2) and
        Decimal.gt?(
          Decimal.add(capacity.committed_area_mm2, footprint.footprint_area_mm2),
          capacity.total_area_mm2
        )

    over_height =
      not is_nil(capacity.total_height_mm) and
        footprint.stack_height_mm > capacity.total_height_mm

    current_percent_used = area_percent(capacity.committed_area_mm2, capacity.total_area_mm2)

    cond do
      over_weight ->
        %{
          disqualified?: true,
          reason: "weight_exceeded",
          current_percent_used: current_percent_used,
          projected_percent_used: 100,
          # Legacy alias for older mobile clients (mirrors projected).
          percent_used: 100,
          free_pct: 0
        }

      over_height ->
        %{
          disqualified?: true,
          reason: "stack_too_tall",
          current_percent_used: current_percent_used,
          projected_percent_used: 100,
          percent_used: 100,
          free_pct: 0
        }

      over_area ->
        %{
          disqualified?: true,
          reason: "no_room",
          current_percent_used: current_percent_used,
          projected_percent_used: 100,
          percent_used: 100,
          free_pct: 0
        }

      true ->
        # `projected_percent_used` is the headline metric — it's what
        # the cell would read AFTER this lot lands, which is the
        # number put-away workers actually care about.
        # `current_percent_used` is what the cell holds right now, so
        # the UI can render "Currently X% → Y% after this lot".
        projected =
          area_percent(
            Decimal.add(capacity.committed_area_mm2, footprint.footprint_area_mm2),
            capacity.total_area_mm2
          )

        %{
          disqualified?: false,
          reason: nil,
          current_percent_used: current_percent_used,
          projected_percent_used: projected,
          # Legacy alias kept stable for the mobile client.
          percent_used: projected,
          free_pct: max(0, 100 - projected)
        }
    end
  end

  defp area_percent(_committed, nil), do: 0

  defp area_percent(committed, total) do
    Decimal.mult(committed, Decimal.new(100))
    |> Decimal.div(total)
    |> Decimal.round(0)
    |> Decimal.to_integer()
  end

  # ----- packaging suggestions ------------------------------------------

  @doc """
  Return packaging suggestions for an item — what the receive form
  should pre-fill. Three sources in priority order:

    * `item_default` — `items.default_packaging` (the canonical
      template the admin set on the item card).
    * `last_lot` — packaging dims from the most recent lot.
    * `average` — mode/median of the last 10 lots; useful when the
      most recent was an outlier.

  Returns `nil` for any source that has no data.
  """
  def packaging_suggestions(company_id, item_id)
      when is_integer(company_id) and is_integer(item_id) do
    item = Repo.get(Item, item_id)
    if is_nil(item) or item.company_id != company_id, do: nil

    recent_lots =
      from(l in Lot,
        where:
          l.item_id == ^item_id and l.company_id == ^company_id and
            not is_nil(l.package_length_mm),
        order_by: [desc: l.inserted_at],
        limit: 10
      )
      |> Repo.all()

    item_default = item && item.default_packaging
    last_lot = recent_lots |> List.first() |> packaging_from_lot()
    average = packaging_average(recent_lots)

    %{
      item_default: item_default,
      last_lot: last_lot,
      average: average
    }
  end

  defp packaging_from_lot(nil), do: nil

  defp packaging_from_lot(%Lot{} = l) do
    %{
      "length_mm" => l.package_length_mm,
      "width_mm" => l.package_width_mm,
      "height_mm" => l.package_height_mm,
      "weight_kg" => l.package_weight_kg,
      "units_per_package" => l.units_per_package,
      "stack_factor" => l.stack_factor
    }
  end

  defp packaging_average([]), do: nil

  defp packaging_average(lots) when length(lots) < 2, do: nil

  defp packaging_average(lots) do
    %{
      "length_mm" => integer_median(lots, & &1.package_length_mm),
      "width_mm" => integer_median(lots, & &1.package_width_mm),
      "height_mm" => integer_median(lots, & &1.package_height_mm),
      "weight_kg" => decimal_median(lots, & &1.package_weight_kg),
      # `units_per_package` is decimal now — use the decimal median so
      # fractional kg-per-bag values aren't truncated when computing a
      # historical average across lots.
      "units_per_package" => decimal_median(lots, & &1.units_per_package),
      "stack_factor" => integer_median(lots, & &1.stack_factor)
    }
  end

  defp integer_median(lots, get) do
    values = lots |> Enum.map(get) |> Enum.reject(&is_nil/1) |> Enum.sort()
    n = length(values)
    cond do
      n == 0 -> nil
      rem(n, 2) == 1 -> Enum.at(values, div(n, 2))
      true ->
        a = Enum.at(values, div(n, 2) - 1)
        b = Enum.at(values, div(n, 2))
        div(a + b, 2)
    end
  end

  defp decimal_median(lots, get) do
    values =
      lots
      |> Enum.map(get)
      |> Enum.reject(&is_nil/1)
      |> Enum.sort_by(&Decimal.to_float/1)

    n = length(values)
    cond do
      n == 0 -> nil
      rem(n, 2) == 1 -> Enum.at(values, div(n, 2))
      true ->
        a = Enum.at(values, div(n, 2) - 1)
        b = Enum.at(values, div(n, 2))
        Decimal.add(a, b) |> Decimal.div(Decimal.new(2)) |> Decimal.round(3)
    end
  end

  @doc """
  Return the floor's plan for the mobile directions screen: every
  non-system location with its x/y/width/height + breadcrumb. The
  caller (directions UI) renders this as a mini SVG with the target
  location highlighted, so the operator can see where to walk before
  pointing the camera.
  """
  def get_floor_plan(company_id, floor_uuid)
      when is_integer(company_id) and is_binary(floor_uuid) do
    case Repo.one(
           from f in Floor,
             where:
               f.company_id == ^company_id and f.uuid == ^floor_uuid and
                 is_nil(f.system_kind),
             preload: [:warehouse]
         ) do
      nil ->
        nil

      %Floor{} = floor ->
        locations =
          Repo.all(
            from l in StorageLocation,
              where: l.floor_id == ^floor.id and is_nil(l.system_kind),
              order_by: [asc: l.id]
          )

        %{floor: floor, locations: locations}
    end
  end

  @doc "Look up a cell by uuid for the destination scan in the move flow."
  def get_cell_for_scan(company_id, uuid)
      when is_integer(company_id) and is_binary(uuid) do
    case Repo.get_by(StorageCell, uuid: uuid) do
      %StorageCell{company_id: ^company_id} = c ->
        Repo.preload(c, storage_location: [floor: [:warehouse]])

      _ ->
        nil
    end
  end

  defp fetch_item(company_id, item_id) when is_integer(item_id) do
    case Repo.get(Item, item_id) do
      %Item{company_id: ^company_id} = i -> {:ok, i}
      _ -> {:error, :item_not_found}
    end
  end

  defp fetch_item(_company_id, _), do: {:error, :item_not_found}

  defp fetch_cell(company_id, cell_id) when is_integer(cell_id) do
    case Repo.get(StorageCell, cell_id) do
      %StorageCell{company_id: ^company_id} = c -> {:ok, c}
      _ -> {:error, :cell_not_found}
    end
  end

  defp fetch_cell(_company_id, _), do: {:error, :cell_not_found}

  defp fetch_warehouse(company_id, warehouse_id) when is_integer(warehouse_id) do
    case Repo.get(Backend.Warehouses.Warehouse, warehouse_id) do
      %Backend.Warehouses.Warehouse{company_id: ^company_id} = w -> {:ok, w}
      _ -> {:error, :warehouse_not_found}
    end
  end

  defp fetch_warehouse(_company_id, _), do: {:error, :warehouse_not_found}

  defp parse_positive_decimal(value) do
    with {:ok, d} <- parse_decimal(value),
         true <- Decimal.positive?(d) do
      {:ok, d}
    else
      _ -> {:error, :bad_qty}
    end
  end

  defp parse_decimal(%Decimal{} = d), do: {:ok, d}
  defp parse_decimal(n) when is_integer(n), do: {:ok, Decimal.new(n)}
  defp parse_decimal(n) when is_float(n), do: {:ok, Decimal.from_float(n)}

  defp parse_decimal(s) when is_binary(s) do
    case Decimal.parse(s) do
      {d, ""} -> {:ok, d}
      _ -> :error
    end
  end

  defp parse_decimal(_), do: :error

  defp lot_audit_snapshot(%Lot{} = l),
    do: Map.new(@lot_audit_fields, fn k -> {k, Map.get(l, k)} end)

  # ----- picker helpers --------------------------------------------

  # (Floor/StorageLocation/Warehouse aliases moved up to module top
  # alongside StorageCell so list_move_recommendations can use them.)

  @picker_limit_default 50
  @picker_limit_max 200

  @doc """
  Searchable, filterable cell picker. Built for the receive form
  where a warehouse can have hundreds of thousands of cells — every
  filter is pushed to Postgres so we never hold more than `limit`
  rows in memory.

  Opts:
    * `:search`        — free-text ILIKE across cell.name, location.name,
                         location.code, warehouse.name
    * `:warehouse_id`  — scope to one warehouse (the form's Site filter)
    * `:item_id`       — combined with `:match_tags`, requires that
                         `(location.tags ∪ cell.tags) ⊇ item.storage_tags`
    * `:match_tags`    — boolean; default `true` when an item_id is
                         supplied so the picker honours the operator's
                         intent without an extra round-trip
    * `:limit`         — capped at #{@picker_limit_max}, default
                         #{@picker_limit_default}
    * `:cursor`        — opaque, exclusive-of cursor from a previous page

  Returns `{rows, next_cursor}` — keyset paginated by (warehouse.name,
  floor.ordinal, location.name, cell.ordinal, cell.id) so the
  ordering matches the natural breadcrumb traversal.
  """
  @doc """
  Latest non-null photo_url from `stock_movements` per lot — the
  "what does this lot physically look like" reference shown next to
  the floor-plan on pickup screens so the worker can recognise the
  box / pallet at the shelf.

  Returns a map `%{lot_id => url}`. Lots with no photo'd movement are
  absent from the map.
  """
  def last_photo_url_by_lot_ids(company_id, lot_ids)
      when is_integer(company_id) and is_list(lot_ids) do
    if lot_ids == [] do
      %{}
    else
      from(m in Movement,
        where:
          m.company_id == ^company_id and
            m.stock_lot_id in ^lot_ids and
            not is_nil(m.photo_url),
        distinct: m.stock_lot_id,
        order_by: [
          asc: m.stock_lot_id,
          desc: m.occurred_at,
          desc: m.id
        ],
        select: {m.stock_lot_id, m.photo_url}
      )
      |> Repo.all()
      |> Map.new()
    end
  end

  def list_cells_for_picker(company_id, opts \\ []) when is_integer(company_id) do
    limit = opts |> Keyword.get(:limit) |> normalise_limit()
    item = maybe_fetch_item_for_tags(company_id, opts)

    query =
      from c in StorageCell,
        join: l in StorageLocation,
        on: l.id == c.storage_location_id,
        join: f in Floor,
        on: f.id == l.floor_id,
        join: w in Warehouse,
        on: w.id == l.warehouse_id,
        where: c.company_id == ^company_id,
        # System slots (the auto-managed Unregistered cell per
        # warehouse) never appear in the picker — only real shelves
        # the operator could choose. The receive endpoint resolves
        # the unregistered cell server-side from `warehouse_id`.
        where:
          is_nil(c.system_kind) and is_nil(l.system_kind) and
            is_nil(f.system_kind),
        # Order by cell id ascending — keeps keyset cursor cheap and
        # unambiguous. UX-wise the operator types a search term
        # almost immediately, so default ordering matters less than
        # pagination correctness.
        order_by: [asc: c.id],
        select: %{cell: c, location: l, floor: f, warehouse: w}

    query
    |> maybe_warehouse_filter(opts[:warehouse_id])
    |> maybe_cell_search(opts[:search])
    |> maybe_tag_match(item, opts[:match_tags])
    |> maybe_apply_cursor(opts[:cursor])
    |> limit(^(limit + 1))
    |> Repo.all()
    |> paginate_picker(limit)
  end

  defp normalise_limit(nil), do: @picker_limit_default
  defp normalise_limit(n) when is_integer(n) and n > 0, do: min(n, @picker_limit_max)
  defp normalise_limit(_), do: @picker_limit_default

  defp maybe_warehouse_filter(query, nil), do: query

  defp maybe_warehouse_filter(query, warehouse_id) when is_integer(warehouse_id) do
    where(query, [c, _l, _f, w], w.id == ^warehouse_id)
  end

  defp maybe_cell_search(query, nil), do: query
  defp maybe_cell_search(query, ""), do: query

  defp maybe_cell_search(query, term) when is_binary(term) do
    needle = "%" <> escape_like(String.trim(term)) <> "%"

    from [c, l, _f, w] in query,
      where:
        ilike(c.name, ^needle) or
          ilike(l.name, ^needle) or
          ilike(l.code, ^needle) or
          ilike(w.name, ^needle)
  end

  # When the item declares storage_tags and the caller wants strict
  # matching, require that the cell's effective set (location.tags ∪
  # cell.tags) is a superset. PG arrays make this a single `@>`. We
  # build the array literal at query time via a fragment so any
  # special chars are parameterised.
  defp maybe_tag_match(query, %{storage_tags: tags}, match)
       when is_list(tags) and tags != [] and match != false do
    from [c, l, _f, _w] in query,
      where: fragment("(? || ?) @> ?", l.tags, c.tags, ^tags)
  end

  defp maybe_tag_match(query, _item, _), do: query

  defp maybe_fetch_item_for_tags(company_id, opts) do
    case opts[:item_id] do
      id when is_integer(id) ->
        case Repo.get(Item, id) do
          %Item{company_id: ^company_id} = item -> item
          _ -> nil
        end

      _ ->
        nil
    end
  end

  defp maybe_apply_cursor(query, nil), do: query
  defp maybe_apply_cursor(query, ""), do: query

  defp maybe_apply_cursor(query, cursor) when is_binary(cursor) do
    case decode_picker_cursor(cursor) do
      {:ok, last_id} when is_integer(last_id) ->
        from [c, _l, _f, _w] in query, where: c.id > ^last_id

      _ ->
        query
    end
  end

  defp paginate_picker(rows, limit) do
    {page, rest} = Enum.split(rows, limit)

    next_cursor =
      case rest do
        [] -> nil
        _ ->
          last = List.last(page)
          last && encode_picker_cursor(last.cell.id)
      end

    {page, next_cursor}
  end

  defp encode_picker_cursor(id) when is_integer(id),
    do: Integer.to_string(id) |> Base.url_encode64(padding: false)

  defp decode_picker_cursor(cursor) when is_binary(cursor) do
    case Base.url_decode64(cursor, padding: false) do
      {:ok, raw} ->
        case Integer.parse(raw) do
          {n, ""} -> {:ok, n}
          _ -> :error
        end

      _ ->
        :error
    end
  end
end
