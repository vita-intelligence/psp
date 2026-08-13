defmodule Backend.Procurement.Shortages do
  @moduledoc """
  Procurement-side shortage feed. Aggregates "what we still need to
  order" across every open MO in the system. Drives the
  `/procurement/shortages` table:

    * One row per `(raw_material / packaging item, R&D stream)`
      combo with positive shortage. R&D (trial / sample MOs) and
      production streams are split so a buyer creating a PO for a
      row ticks the right ``For R&D`` flag automatically. Mixing
      the streams would break the booking guard on trial MOs —
      they can only book lots received as R&D.
    * Total required across all open MOs of that stream - total
      booked - qty already on open POs of that stream = net shortage
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

  # Project types that draw from the R&D stock stream. Kept in one
  # place because the same list gates the booking allocator too
  # (see ``Backend.Production.mo_expects_rnd?/1``).
  @rnd_project_types ~w(trial sample)

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
    # All four maps are now keyed by ``{item_id, is_rnd}`` so
    # streams stay separate end-to-end. Row keys come from the
    # requirements map (there's no shortage without demand); the
    # other maps default to zero on missing keys.
    {requirements, line_uoms_by_key, explicit_request_by_key} =
      compute_requirements(company_id)

    bookings = compute_bookings(company_id)
    expecting = compute_expecting(company_id)

    item_ids =
      requirements
      |> Map.keys()
      |> Enum.map(fn {item_id, _is_rnd} -> item_id end)
      |> Enum.uniq()

    on_hand = compute_on_hand(company_id, item_ids)

    items =
      from(i in Item,
        where: i.id in ^item_ids,
        preload: [:stock_uom]
      )
      |> Repo.all()
      |> Map.new(&{&1.id, &1})

    line_uoms_by_id =
      line_uoms_by_key
      |> Map.values()
      |> Enum.uniq()
      |> case do
        [] ->
          %{}

        ids ->
          from(u in Backend.Units.UnitOfMeasurement, where: u.id in ^ids)
          |> Repo.all()
          |> Map.new(&{&1.id, &1})
      end

    dependent_mos = compute_dependent_mos(company_id, item_ids)

    requirements
    |> Enum.map(fn {{item_id, is_rnd}, required} ->
      booked = Map.get(bookings, {item_id, is_rnd}, Decimal.new(0))
      exp = Map.get(expecting, {item_id, is_rnd}, Decimal.new(0))
      hand = Map.get(on_hand, {item_id, is_rnd}, Decimal.new(0))
      line_uom_id = Map.get(line_uoms_by_key, {item_id, is_rnd})
      line_uom = line_uom_id && Map.get(line_uoms_by_id, line_uom_id)

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
      shortage =
        if Decimal.compare(shortage, Decimal.new(0)) == :gt,
          do: shortage,
          else: Decimal.new(0)
      explicit_request = Map.get(explicit_request_by_key, {item_id, is_rnd}, false)

      %{
        item: item_payload(Map.get(items, item_id)),
        is_rnd: is_rnd,
        # ``line_uom`` reflects the UoM every contributing BOM line
        # actually stores its qty in (kg / L after the NPD normalizer
        # lands). The FE prefers this over ``item.stock_uom`` when
        # rendering the row so the number + label always match.
        # Falls back to null for legacy lines without a line UoM.
        line_uom: uom_payload(line_uom),
        required_qty: Decimal.to_string(required),
        booked_qty: Decimal.to_string(booked),
        expecting_qty: Decimal.to_string(exp),
        shortage_qty: Decimal.to_string(shortage),
        on_hand_qty: Decimal.to_string(hand),
        # ``explicit_request`` — an operator hit "Request purchases"
        # on at least one MO in this bucket. FE badges these rows
        # differently so procurement knows they're operator-flagged
        # (vs auto-derived from raw shortage).
        explicit_request: explicit_request,
        dependent_mos: Map.get(dependent_mos, {item_id, is_rnd}, [])
      }
    end)
    # Keep a row when there's genuine shortage (procurement MUST buy)
    # OR when an operator explicitly requested purchases AND there's
    # still an outstanding gap between required and booked (they want
    # procurement's eyes on the unbooked portion even if on-hand
    # stock nets the shortage). The FE decides "book from stock" vs
    # "raise PO" from the per-row on_hand / expecting numbers.
    #
    # ``outstanding = required > booked`` — filters out lines already
    # fully booked on the explicit-request MO, so a mix of booked +
    # unbooked lines only surfaces the unbooked ones.
    |> Enum.reject(fn row ->
      shortage_positive =
        Decimal.compare(Decimal.new(row.shortage_qty), Decimal.new(0)) == :gt

      outstanding =
        Decimal.compare(
          Decimal.new(row.required_qty),
          Decimal.new(row.booked_qty)
        ) == :gt

      not (shortage_positive or (row.explicit_request and outstanding))
    end)
    |> Enum.sort_by(fn row -> Decimal.to_float(Decimal.new(row.shortage_qty)) end, :desc)
  end

  # Sum of (BOM line qty × MO qty, or line.qty if fixed) across all
  # open MOs, grouped by ``{part_id, is_rnd}`` where ``is_rnd`` comes
  # from ``mo.project_type in ["trial", "sample"]``. Same stream-
  # isolation rule the booking allocator uses — a trial MO's demand
  # can only be met by R&D stock, so its shortage row must be
  # separate. Limited to procurable item types so semi-finished
  # items don't pollute the procurement queue (those are child-MO
  # concerns).
  defp compute_requirements(company_id) do
    # BOM-line requirements. When a packaging combo overlay is active
    # on the MO (``packaging_combo_items IS NOT NULL``) the booking
    # loop skips packaging BOM lines and substitutes the overlay
    # items instead — mirror that here so packaging demand isn't
    # double-counted. The overlay contribution is collected below
    # from ``compute_overlay_requirements``.
    bom_acc =
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
            part.item_type in ^@procurable_item_types and
            (part.item_type != "packaging" or is_nil(mo.packaging_combo_items)),
        select: %{
          part_id: line.part_id,
          line_qty: line.qty,
          line_uom_id: line.unit_of_measurement_id,
          is_fixed: line.is_fixed,
          mo_qty: mo.quantity,
          mo_project_type: mo.project_type,
          # Contributing MO's explicit-request flag. When any MO
          # sharing this ``{part, is_rnd}`` bucket has ``Request
          # purchases`` fired, ``list_for`` keeps the row on the
          # shortages page even if on-hand stock would otherwise
          # net the shortage to zero — the operator asked
          # procurement to look at it, procurement should see it.
          mo_purchasing_requested: not is_nil(mo.purchasing_requested_at)
        }
      )
      |> Repo.all()
      |> Enum.reduce({%{}, %{}, %{}}, fn row, {qty_acc, uom_acc, req_acc} ->
        qty =
          cond do
            row.is_fixed ->
              row.line_qty || Decimal.new(0)

            true ->
              Decimal.mult(row.line_qty || Decimal.new(0), row.mo_qty || Decimal.new(0))
          end

        is_rnd = row.mo_project_type in @rnd_project_types
        key = {row.part_id, is_rnd}
        qty_acc = Map.update(qty_acc, key, qty, &Decimal.add(&1, qty))
        # Remember the last non-nil line UoM per (part, stream). After
        # the NPD-side base-unit normalisation lands, every line for a
        # given part will use the same UoM (kg / L) so "last" is stable;
        # for legacy data we pick something reasonable rather than
        # crashing.
        uom_acc =
          if row.line_uom_id, do: Map.put(uom_acc, key, row.line_uom_id), else: uom_acc

        # ``bool_or`` semantics — any contributing MO with an
        # explicit request flips this bucket true and it stays true.
        req_acc =
          if row.mo_purchasing_requested,
            do: Map.put(req_acc, key, true),
            else: Map.put_new(req_acc, key, false)

        {qty_acc, uom_acc, req_acc}
      end)

    # Fold in packaging-combo overlay requirements. The overlay stores
    # ``[%{"item_id" => id, "quantity" => "per-stock-unit"}]`` on the
    # MO — the buyer needs to see these on the shortages page too
    # or a sample MO that requested purchases for its Pouch overlay
    # would show zero packaging demand and procurement wouldn't act.
    fold_overlay_requirements(bom_acc, company_id)
  end

  # Second pass — walk every open MO with a non-nil ``packaging_combo_items``
  # and fold each overlay row into the same {qty, uom, req} accumulator.
  # UoM defaults to the item's stock_uom (overlay rows don't carry
  # a per-line UoM the way BOM lines do). Non-procurable item types
  # are skipped so an overlay pointing at a semi-finished output
  # doesn't pollute the queue.
  defp fold_overlay_requirements({qty_acc, uom_acc, req_acc}, company_id) do
    mos =
      from(mo in ManufacturingOrder,
        where:
          mo.company_id == ^company_id and
            mo.status in ^@open_mo_statuses and
            (mo.status != "draft" or not is_nil(mo.purchasing_requested_at)) and
            not is_nil(mo.packaging_combo_items),
        select: %{
          quantity: mo.quantity,
          project_type: mo.project_type,
          purchasing_requested: not is_nil(mo.purchasing_requested_at),
          overlay: mo.packaging_combo_items
        }
      )
      |> Repo.all()

    overlay_item_ids =
      mos
      |> Enum.flat_map(fn m ->
        for row <- m.overlay || [], id = overlay_extract_int(row, "item_id"), do: id
      end)
      |> Enum.uniq()

    procurable_items =
      if overlay_item_ids == [] do
        %{}
      else
        from(i in Item,
          where: i.id in ^overlay_item_ids and i.item_type in ^@procurable_item_types,
          select: {i.id, i.stock_uom_id}
        )
        |> Repo.all()
        |> Map.new()
      end

    Enum.reduce(mos, {qty_acc, uom_acc, req_acc}, fn m, {qa, ua, ra} ->
      is_rnd = m.project_type in @rnd_project_types

      Enum.reduce(m.overlay || [], {qa, ua, ra}, fn row, {qa2, ua2, ra2} ->
        with {:ok, item_id} <- overlay_extract_int_ok(row, "item_id"),
             true <- Map.has_key?(procurable_items, item_id),
             {:ok, required} <- overlay_extract_decimal_ok(row, "quantity") do
          # Overlay ``quantity`` is the ABSOLUTE TOTAL — NPD already
          # rolled ``per_pack × total_packs`` (with ceil for count
          # items) — so we don't multiply by mo.quantity here.
          key = {item_id, is_rnd}
          qa2 = Map.update(qa2, key, required, &Decimal.add(&1, required))

          ua2 =
            case Map.get(procurable_items, item_id) do
              nil -> ua2
              uom_id -> Map.put_new(ua2, key, uom_id)
            end

          ra2 =
            if m.purchasing_requested,
              do: Map.put(ra2, key, true),
              else: Map.put_new(ra2, key, false)

          {qa2, ua2, ra2}
        else
          _ -> {qa2, ua2, ra2}
        end
      end)
    end)
  end

  defp overlay_extract_int(row, key) do
    case Map.get(row, key) do
      i when is_integer(i) ->
        i

      s when is_binary(s) ->
        case Integer.parse(s) do
          {i, ""} -> i
          _ -> nil
        end

      _ ->
        nil
    end
  end

  defp overlay_extract_int_ok(row, key) do
    case overlay_extract_int(row, key) do
      nil -> :error
      i -> {:ok, i}
    end
  end

  defp overlay_extract_decimal_ok(row, key) do
    case Map.get(row, key) do
      %Decimal{} = d -> {:ok, d}
      n when is_integer(n) -> {:ok, Decimal.new(n)}
      n when is_float(n) -> {:ok, Decimal.from_float(n)}
      s when is_binary(s) ->
        case Decimal.parse(s) do
          {d, ""} -> {:ok, d}
          _ -> :error
        end
      _ -> :error
    end
  end

  defp compute_bookings(company_id) do
    # Bookings can be lot-backed (``stock_lot_id`` set — carries the
    # lot's ``is_rnd``) or placeholder against an open PO (``stock_lot_id``
    # nil, ``purchase_order_line_id`` set — carries the PO's
    # ``is_rnd``). Both need bucketing so the coverage bucket lines
    # up with the requirements bucket.
    from(b in ManufacturingOrderBooking,
      join: mo in ManufacturingOrder,
      on: mo.id == b.manufacturing_order_id,
      left_join: lot in Backend.Stock.Lot,
      on: lot.id == b.stock_lot_id,
      left_join: pol in Backend.Purchasing.PurchaseOrderLine,
      on: pol.id == b.purchase_order_line_id,
      left_join: po in Backend.Purchasing.PurchaseOrder,
      on: po.id == pol.purchase_order_id,
      where:
        b.company_id == ^company_id and
          b.status == "requested" and
          mo.status in ^@open_mo_statuses and
          (mo.status != "draft" or not is_nil(mo.purchasing_requested_at)),
      select: %{
        item_id: b.item_id,
        quantity: b.quantity,
        lot_is_rnd: lot.is_rnd,
        po_is_rnd: po.is_rnd
      }
    )
    |> Repo.all()
    |> Enum.reduce(%{}, fn row, acc ->
      # Lot side wins when present (that's the concrete allocation);
      # placeholder falls back to the PO's flag. Anything nil is
      # ``false`` — matches the field default.
      is_rnd = row.lot_is_rnd || row.po_is_rnd || false
      qty = row.quantity || Decimal.new(0)
      Map.update(acc, {row.item_id, is_rnd}, qty, &Decimal.add(&1, qty))
    end)
  end

  defp compute_expecting(company_id) do
    from(l in PurchaseOrderLine,
      join: po in PurchaseOrder,
      on: po.id == l.purchase_order_id,
      where:
        l.company_id == ^company_id and
          po.status in ^@open_po_statuses and
          l.qty_received < l.qty_ordered,
      group_by: [l.item_id, po.is_rnd],
      select: %{
        item_id: l.item_id,
        po_is_rnd: po.is_rnd,
        unrealised: sum(l.qty_ordered) - sum(l.qty_received)
      }
    )
    |> Repo.all()
    |> Enum.reduce(%{}, fn row, acc ->
      is_rnd = row.po_is_rnd || false
      Map.update(acc, {row.item_id, is_rnd}, row.unrealised, &Decimal.add(&1, row.unrealised))
    end)
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
      group_by: [l.item_id, l.is_rnd],
      select: %{item_id: l.item_id, is_rnd: l.is_rnd, qty: sum(p.qty)}
    )
    |> Repo.all()
    |> Enum.reduce(%{}, fn row, acc ->
      is_rnd = row.is_rnd || false
      Map.update(acc, {row.item_id, is_rnd}, row.qty, &Decimal.add(&1, row.qty))
    end)
  end

  defp compute_dependent_mos(_company_id, []), do: %{}

  defp compute_dependent_mos(company_id, item_ids) do
    # BOM-line dependents. Skip packaging lines when the MO carries
    # an active overlay — same substitution the booker + requirements
    # aggregator apply.
    bom_rows =
      from(line in BOMLine,
        join: bom in BOM,
        on: bom.id == line.bom_id,
        join: mo in ManufacturingOrder,
        on: mo.bom_id == bom.id,
        join: part in Item,
        on: part.id == line.part_id,
        join: mo_item in Item,
        on: mo_item.id == mo.item_id,
        left_join: s in Backend.Production.ManufacturingOrderStep,
        on: s.manufacturing_order_id == mo.id,
        where:
          mo.company_id == ^company_id and
            mo.status in ^@open_mo_statuses and
            line.part_id in ^item_ids and
            (part.item_type != "packaging" or is_nil(mo.packaging_combo_items)),
        select: %{
          part_id: line.part_id,
          mo_id: mo.id,
          mo_uuid: mo.uuid,
          status: mo.status,
          quantity: mo.quantity,
          mo_item_id: mo.item_id,
          mo_item_name: mo_item.name,
          mo_project_type: mo.project_type,
          planned_start: s.planned_start
        }
      )
      |> Repo.all()

    # Overlay-derived dependents. Any MO with a non-nil
    # ``packaging_combo_items`` referencing one of ``item_ids`` in an
    # overlay row is a dependent for that item's shortage bucket.
    overlay_rows =
      from(mo in ManufacturingOrder,
        join: mo_item in Item,
        on: mo_item.id == mo.item_id,
        left_join: s in Backend.Production.ManufacturingOrderStep,
        on: s.manufacturing_order_id == mo.id,
        where:
          mo.company_id == ^company_id and
            mo.status in ^@open_mo_statuses and
            not is_nil(mo.packaging_combo_items),
        select: %{
          mo_id: mo.id,
          mo_uuid: mo.uuid,
          status: mo.status,
          quantity: mo.quantity,
          mo_item_id: mo.item_id,
          mo_item_name: mo_item.name,
          mo_project_type: mo.project_type,
          planned_start: s.planned_start,
          overlay: mo.packaging_combo_items
        }
      )
      |> Repo.all()
      |> Enum.flat_map(fn m ->
        for row <- m.overlay || [],
            id = overlay_extract_int(row, "item_id"),
            id in item_ids do
          %{
            part_id: id,
            mo_id: m.mo_id,
            mo_uuid: m.mo_uuid,
            status: m.status,
            quantity: m.quantity,
            mo_item_id: m.mo_item_id,
            mo_item_name: m.mo_item_name,
            mo_project_type: m.mo_project_type,
            planned_start: m.planned_start
          }
        end
      end)

    rows = bom_rows ++ overlay_rows

    # Grouped by ``{part_id, is_rnd}`` so a row can list only the MOs
    # from its own stream — production row for Acai lists production
    # MOs, R&D row lists trial / sample MOs.
    rows
    |> Enum.group_by(fn r -> {r.part_id, r.mo_project_type in @rnd_project_types} end)
    |> Map.new(fn {key, rows} ->
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

      {key, mo_payloads}
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

  defp uom_payload(nil), do: nil

  defp uom_payload(%Backend.Units.UnitOfMeasurement{} = uom) do
    %{id: uom.id, symbol: uom.symbol, name: uom.name}
  end
end
