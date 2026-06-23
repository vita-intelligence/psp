defmodule Backend.Procurement.Shortages do
  @moduledoc """
  Procurement-side shortage feed. Aggregates "what we still need to
  order" across every open MO in the system. Drives the
  `/procurement/shortages` table:

    * One row per raw_material / packaging item with positive shortage
    * Total required across all open MOs - total booked - qty already
      on open POs = net shortage
    * List of dependent MOs so procurement can see who's blocked

  Semi-finished items are excluded — they're produced internally by
  child MOs, not procured externally.
  """

  import Ecto.Query

  alias Backend.Items.Item
  alias Backend.Production.{BOM, BOMLine, ManufacturingOrder, ManufacturingOrderBooking}
  alias Backend.Purchasing.{PurchaseOrder, PurchaseOrderLine}
  alias Backend.Repo

  # Procurement only sees MOs that the planner has explicitly flagged
  # via "Request purchases". `draft` MOs with the flag set are in-
  # planning shortages; `approved+` MOs are downstream shortages
  # caught after release-time gates were bypassed (legacy data,
  # over-consumption, QC fail). All other MOs are filtered out — no
  # opt-in means procurement isn't expected to act yet.
  @open_mo_statuses ~w(draft approved scheduled in_progress)
  @procurable_item_types ~w(raw_material packaging)
  @open_po_statuses ~w(ordered partially_received)

  @doc """
  Paginated shortage feed for the procurement table. Drives the
  reusable <DataTable> on /procurement/shortages — supports sort,
  filters, search, and cursor-based infinite scroll.

  Opts:
    * `:cursor` — opaque next-page token (offset, stringified)
    * `:limit` — page size (clamped 1..200; default 50)
    * `:sort` — `%{field: <field>, direction: :asc | :desc}` or nil
    * `:filters` — `%{item_type: "raw_material" | "packaging"}`
    * `:search` — substring match on item name

  Returns `%{items: [...], next_cursor: nil | "offset"}`.
  """
  def list_page(company_id, opts \\ []) when is_integer(company_id) do
    rows = list_for(company_id)

    rows =
      rows
      |> apply_search(opts[:search])
      |> apply_filters(opts[:filters] || %{})
      |> apply_sort(opts[:sort])

    limit = clamp_limit(opts[:limit])
    offset = parse_offset(opts[:cursor])
    page = Enum.slice(rows, offset, limit)

    next_cursor =
      if offset + limit < length(rows) do
        Integer.to_string(offset + limit)
      else
        nil
      end

    %{items: page, next_cursor: next_cursor}
  end

  defp clamp_limit(nil), do: 50
  defp clamp_limit(n) when is_integer(n) and n > 0, do: min(n, 200)

  defp clamp_limit(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, _} when n > 0 -> min(n, 200)
      _ -> 50
    end
  end

  defp clamp_limit(_), do: 50

  defp parse_offset(nil), do: 0

  defp parse_offset(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, _} when n >= 0 -> n
      _ -> 0
    end
  end

  defp parse_offset(_), do: 0

  defp apply_search(rows, nil), do: rows
  defp apply_search(rows, ""), do: rows

  defp apply_search(rows, term) when is_binary(term) do
    needle = String.downcase(term)

    Enum.filter(rows, fn r ->
      name = (r.item && r.item.name) || ""
      String.contains?(String.downcase(name), needle)
    end)
  end

  defp apply_filters(rows, filters) when is_map(filters) do
    Enum.reduce(filters, rows, fn
      {"item_type", v}, acc when is_binary(v) and v != "" ->
        Enum.filter(acc, fn r -> r.item && r.item.item_type == v end)

      {"has_expecting", v}, acc when v in [true, "true"] ->
        Enum.filter(acc, fn r -> Decimal.compare(Decimal.new(r.expecting_qty), Decimal.new(0)) == :gt end)

      {"has_expecting", v}, acc when v in [false, "false"] ->
        Enum.filter(acc, fn r ->
          Decimal.compare(Decimal.new(r.expecting_qty), Decimal.new(0)) != :gt
        end)

      _, acc ->
        acc
    end)
  end

  defp apply_sort(rows, nil), do: rows

  defp apply_sort(rows, %{field: field, direction: dir}) do
    cmp = if dir in [:desc, "desc"], do: :desc, else: :asc

    keyer =
      case field do
        "shortage_qty" -> fn r -> Decimal.to_float(Decimal.new(r.shortage_qty)) end
        "required_qty" -> fn r -> Decimal.to_float(Decimal.new(r.required_qty)) end
        "booked_qty" -> fn r -> Decimal.to_float(Decimal.new(r.booked_qty)) end
        "expecting_qty" -> fn r -> Decimal.to_float(Decimal.new(r.expecting_qty)) end
        "on_hand_qty" -> fn r -> Decimal.to_float(Decimal.new(r.on_hand_qty)) end
        "item_name" -> fn r -> String.downcase((r.item && r.item.name) || "") end
        _ -> fn r -> Decimal.to_float(Decimal.new(r.shortage_qty)) end
      end

    Enum.sort_by(rows, keyer, cmp)
  end

  defp apply_sort(rows, _), do: rows

  @doc """
  Returns a list of shortage rows for `company_id`, sorted by net
  shortage (largest gap first).

  Each row:

      %{
        item: %{id, uuid, name, code, item_type, stock_uom},
        required_qty: "120",
        booked_qty: "70",
        expecting_qty: "30",            # already on open POs
        shortage_qty: "20",             # net gap procurement still owes
        on_hand_qty: "5",               # live stock at any cell
        dependent_mos: [%{uuid, code, status, item, quantity, planned_start}]
      }
  """
  def list_for(company_id) when is_integer(company_id) do
    requirements = compute_requirements(company_id)
    bookings = compute_bookings(company_id)
    # Placeholder bookings — reservations against open PO lines that
    # haven't yet produced a stock_lot. They DON'T inflate the
    # "expecting" total separately because their qty is already part
    # of `bookings` (their status is "requested" so the bookings
    # query picks them up). But we still surface them as a separate
    # facet so the FE can label "Reserved on PO00xxx" rows.
    expecting = compute_expecting(company_id)
    on_hand = compute_on_hand(company_id, Map.keys(requirements))

    item_ids = Map.keys(requirements)

    items =
      from(i in Item,
        where: i.id in ^item_ids,
        preload: [:stock_uom]
      )
      |> Repo.all()
      |> Map.new(&{&1.id, &1})

    dependent_mos = compute_dependent_mos(company_id, item_ids)

    item_ids
    |> Enum.map(fn item_id ->
      required = Map.get(requirements, item_id, Decimal.new(0))
      booked = Map.get(bookings, item_id, Decimal.new(0))
      exp = Map.get(expecting, item_id, Decimal.new(0))
      hand = Map.get(on_hand, item_id, Decimal.new(0))

      # Shortage = what procurement still owes after subtracting
      # everything that already covers demand. Three "covering" sources:
      #
      #   * on-hand available inventory (lots ready to be booked)
      #   * expecting (qty already on open POs — net of any placeholder
      #     bookings that have reserved a slice of those POs)
      #
      # Booked qty isn't a separate term because:
      #   - lot-backed bookings ⇒ already counted within `on_hand`
      #     (the lot is on the shelf)
      #   - placeholder bookings ⇒ already counted within `expecting`
      #     (the PO is in flight)
      # So `required - on_hand - expecting` cleanly captures the
      # genuine outstanding gap procurement still owes.
      coverage = Decimal.add(hand, exp)
      shortage = Decimal.sub(required, coverage)
      shortage = if Decimal.compare(shortage, Decimal.new(0)) == :gt, do: shortage, else: Decimal.new(0)

      %{
        item: item_payload(Map.get(items, item_id)),
        required_qty: Decimal.to_string(required),
        booked_qty: Decimal.to_string(booked),
        expecting_qty: Decimal.to_string(exp),
        shortage_qty: Decimal.to_string(shortage),
        on_hand_qty: Decimal.to_string(hand),
        dependent_mos: Map.get(dependent_mos, item_id, [])
      }
    end)
    |> Enum.reject(fn row -> Decimal.compare(Decimal.new(row.shortage_qty), Decimal.new(0)) != :gt end)
    |> Enum.sort_by(fn row -> Decimal.to_float(Decimal.new(row.shortage_qty)) end, :desc)
  end

  # Sum of (BOM line qty × MO qty, or line.qty if fixed) across all
  # open MOs, grouped by part_id. Limited to procurable item types so
  # semi-finished items don't pollute the procurement queue (those
  # are child-MO concerns).
  defp compute_requirements(company_id) do
    from(line in BOMLine,
      join: bom in BOM,
      on: bom.id == line.bom_id,
      join: mo in ManufacturingOrder,
      on: mo.bom_id == bom.id,
      join: part in Item,
      on: part.id == line.part_id,
      where:
        mo.company_id == ^company_id and
          mo.status in ^@open_mo_statuses and
          (mo.status != "draft" or not is_nil(mo.purchasing_requested_at)) and
          part.item_type in ^@procurable_item_types,
      select: %{
        part_id: line.part_id,
        line_qty: line.qty,
        is_fixed: line.is_fixed,
        mo_qty: mo.quantity
      }
    )
    |> Repo.all()
    |> Enum.reduce(%{}, fn row, acc ->
      qty =
        cond do
          row.is_fixed ->
            row.line_qty || Decimal.new(0)

          true ->
            Decimal.mult(row.line_qty || Decimal.new(0), row.mo_qty || Decimal.new(0))
        end

      Map.update(acc, row.part_id, qty, &Decimal.add(&1, qty))
    end)
  end

  defp compute_bookings(company_id) do
    from(b in ManufacturingOrderBooking,
      join: mo in ManufacturingOrder,
      on: mo.id == b.manufacturing_order_id,
      where:
        b.company_id == ^company_id and
          b.status == "requested" and
          mo.status in ^@open_mo_statuses and
          (mo.status != "draft" or not is_nil(mo.purchasing_requested_at)),
      group_by: b.item_id,
      select: {b.item_id, sum(b.quantity)}
    )
    |> Repo.all()
    |> Map.new()
  end

  defp compute_expecting(company_id) do
    from(l in PurchaseOrderLine,
      join: po in PurchaseOrder,
      on: po.id == l.purchase_order_id,
      where:
        l.company_id == ^company_id and
          po.status in ^@open_po_statuses and
          l.qty_received < l.qty_ordered,
      group_by: l.item_id,
      select: {l.item_id, sum(l.qty_ordered) - sum(l.qty_received)}
    )
    |> Repo.all()
    |> Map.new()
  end

  defp compute_on_hand(_company_id, []), do: %{}

  defp compute_on_hand(company_id, item_ids) do
    from(p in Backend.Stock.Placement,
      join: l in Backend.Stock.Lot,
      on: l.id == p.stock_lot_id,
      where:
        l.company_id == ^company_id and
          l.item_id in ^item_ids and
          l.status == "available" and
          p.qty > 0,
      group_by: l.item_id,
      select: {l.item_id, sum(p.qty)}
    )
    |> Repo.all()
    |> Map.new()
  end

  defp compute_dependent_mos(_company_id, []), do: %{}

  defp compute_dependent_mos(company_id, item_ids) do
    rows =
      from(line in BOMLine,
        join: bom in BOM,
        on: bom.id == line.bom_id,
        join: mo in ManufacturingOrder,
        on: mo.bom_id == bom.id,
        join: mo_item in Item,
        on: mo_item.id == mo.item_id,
        left_join: s in Backend.Production.ManufacturingOrderStep,
        on: s.manufacturing_order_id == mo.id,
        where:
          mo.company_id == ^company_id and
            mo.status in ^@open_mo_statuses and
            line.part_id in ^item_ids,
        select: %{
          part_id: line.part_id,
          mo_id: mo.id,
          mo_uuid: mo.uuid,
          status: mo.status,
          quantity: mo.quantity,
          mo_item_id: mo.item_id,
          mo_item_name: mo_item.name,
          planned_start: s.planned_start
        }
      )
      |> Repo.all()

    rows
    |> Enum.group_by(& &1.part_id)
    |> Map.new(fn {part_id, rows} ->
      mo_payloads =
        rows
        |> Enum.group_by(& &1.mo_id)
        |> Enum.map(fn {id, mo_rows} ->
          first = List.first(mo_rows)
          earliest_start =
            mo_rows
            |> Enum.map(& &1.planned_start)
            |> Enum.reject(&is_nil/1)
            |> Enum.min(DateTime, fn -> nil end)

          %{
            uuid: first.mo_uuid,
            # Rendered MO code (e.g. MO00016) — same identifier the
            # PDF labels carry, so the planner can match the chip
            # against the printed work order.
            code: BackendWeb.Payloads.render_entity_code(%{id: id}, "manufacturing_order"),
            status: first.status,
            quantity: Decimal.to_string(first.quantity || Decimal.new(0)),
            item_name: first.mo_item_name,
            planned_start: earliest_start
          }
        end)
        |> Enum.sort_by(fn r -> r.planned_start || ~U[2099-01-01 00:00:00Z] end, DateTime)

      {part_id, mo_payloads}
    end)
  end

  defp item_payload(nil), do: nil

  defp item_payload(%Item{} = item) do
    %{
      id: item.id,
      uuid: item.uuid,
      name: item.name,
      item_type: item.item_type,
      stock_uom:
        item.stock_uom &&
          %{id: item.stock_uom.id, symbol: item.stock_uom.symbol, name: item.stock_uom.name}
    }
  end
end
