defmodule Backend.Purchasing.PurchaseTerms do
  @moduledoc """
  Boundary for vendor-quoted purchase terms — the commercial baseline
  the buyer negotiates with each supplier per item. Distinct from
  `Backend.Purchasing.VendorPrices`, which tracks what was actually
  paid on POs.

  Three read paths:

    * `list_for_vendor/2` — vendor detail page's Purchase-terms card.
    * `list_for_item/2` — item detail page's Purchase-terms table
      (ranked by priority; primary vendor tops the list).
    * `primary_for/3` — point lookup for the PO "suggest price"
      fallback chain and item default-cost derivation.

  Two write paths:

    * `upsert/1` — create or update a term. Enforces the "vendor must
      be approved for this item" rule (see :requires_approval error).
    * `delete/1` — remove a term. Non-destructive: doesn't touch the
      approval row.

  All write paths audit through the standard audit log.
  """

  import Ecto.Query, warn: false

  alias Backend.Purchasing.PurchaseTerm
  alias Backend.Repo
  alias Backend.Vendors.ApprovedItem

  @doc """
  Vendor detail page — every term this vendor holds, item preloaded
  so the FE can group by item name / code without a second fetch.
  """
  def list_for_vendor(company_id, vendor_id)
      when is_integer(company_id) and is_integer(vendor_id) do
    Repo.all(
      from(t in PurchaseTerm,
        where: t.company_id == ^company_id and t.vendor_id == ^vendor_id,
        order_by: [asc: t.priority, asc: t.item_id],
        preload: [:item]
      )
    )
  end

  @doc """
  Item detail page — every vendor quoting this item, ranked by
  priority (1 = primary). Vendor preloaded for the table row's
  Vendor column.
  """
  def list_for_item(company_id, item_id)
      when is_integer(company_id) and is_integer(item_id) do
    Repo.all(
      from(t in PurchaseTerm,
        where: t.company_id == ^company_id and t.item_id == ^item_id,
        order_by: [asc: t.priority, asc: t.vendor_id],
        preload: [:vendor]
      )
    )
  end

  @doc """
  Point lookup for the PO "suggest price" fallback. Returns the
  primary (lowest-priority-number) term for the (vendor, item) pair,
  or nil when none exists. Doesn't require a currency filter — the
  PO cascade layers currency on top when converting.
  """
  def primary_for(company_id, vendor_id, item_id)
      when is_integer(company_id) and is_integer(vendor_id) and is_integer(item_id) do
    Repo.one(
      from(t in PurchaseTerm,
        where:
          t.company_id == ^company_id and
            t.vendor_id == ^vendor_id and
            t.item_id == ^item_id,
        order_by: [asc: t.priority],
        limit: 1
      )
    )
  end

  @doc """
  Item-cost lookup for BOM roll-up / spec sheet defaults — the
  cheapest primary term across every vendor quoting this item. Only
  reads currently-valid terms (skips ones outside their valid_from /
  valid_until window). Returns nil when there's no live term.
  """
  def item_default_cost(company_id, item_id)
      when is_integer(company_id) and is_integer(item_id) do
    today = Date.utc_today()

    Repo.one(
      from(t in PurchaseTerm,
        where:
          t.company_id == ^company_id and
            t.item_id == ^item_id and
            (is_nil(t.valid_from) or t.valid_from <= ^today) and
            (is_nil(t.valid_until) or t.valid_until >= ^today),
        order_by: [asc: t.priority, asc: t.price],
        limit: 1
      )
    )
  end

  @doc """
  Bulk cost lookup for downstream consumers (vita-cff's builder cost
  calculator, spec-sheet BOM roll-up). Given a list of item uuids,
  returns one row per uuid with the best-guess unit_cost and its
  provenance so the caller can render a badge.

  Fallback chain per item (mirrors the single-item PO suggest_price
  flow but is vendor-agnostic since the caller has no PO context):

  1. `po_history` — most-recent `VendorItemPrice.unit_price` across
     any vendor for this item. Real money paid trumps a negotiated
     baseline.
  2. `purchase_term` — the primary term across all vendors quoting
     this item, courtesy of `item_default_cost/2`.
  3. `bom_rollup` — semi-finished items with no direct cost fall back
     to summing their primary+active BOM: `Σ line.qty × cost(part)`.
     Recurses depth-first with a cycle guard + depth cap
     (`@bom_rollup_max_depth`); child costs are normalised to the
     company's base currency via `company.currency_rates`; line qty
     is UoM-converted into the part's `stock_uom` before multiplying.
     Any child that returns `none` or a UoM/currency conversion that
     fails degrades the row to `bom_rollup_partial` — sum still
     returned but the caller renders a warning chip.
  4. `none` — no live cost data + no BOM to roll up. Caller renders
     a warning.

  Every returned map carries `:uuid`, `:unit_cost`, `:currency_code`,
  `:uom_symbol` (nil for `po_history` — the paid price has no
  price-per-uom concept, it's just per stock-unit), `:source`, and
  `:vendor_name` (for the operator to know who quoted; nil for
  rollup sources — no single vendor is responsible). Uuids that
  don't resolve to a live item silently drop out of the response —
  caller can compute the missing set by diffing input vs response.
  """
  # Roll-up recursion cap. Six levels covers every real-world recipe
  # tree we've seen (finished → semi → semi → raw); a runaway BOM
  # deeper than this returns `none` rather than churning the DB.
  @bom_rollup_max_depth 6

  def suggest_costs_bulk(company_id, item_uuids)
      when is_integer(company_id) and is_list(item_uuids) do
    alias Backend.Items.Item

    trimmed_uuids =
      item_uuids
      |> Enum.filter(&is_binary/1)
      |> Enum.uniq()

    if trimmed_uuids == [] do
      []
    else
      # Resolve uuids → items in one query. Skip archived rows so a
      # stale reference doesn't surface pricing on a deleted item.
      top_items =
        Repo.all(
          from(i in Item,
            where: i.company_id == ^company_id and i.uuid in ^trimmed_uuids,
            left_join: u in assoc(i, :stock_uom),
            preload: [stock_uom: u]
          )
        )

      # Walk the BOM graph breadth-first so every price / term lookup
      # + every UoM the recursion may need is loaded in a bounded
      # number of queries instead of one per node.
      {items_by_id, lines_by_bom_item_id} =
        preload_bom_graph(company_id, top_items)

      all_item_ids = Map.keys(items_by_id)

      last_paid_by_item_id = load_last_paid(company_id, all_item_ids)
      primary_terms_by_item_id = load_primary_terms(company_id, all_item_ids)

      company = Backend.Companies.get!(company_id)

      ctx = %{
        items: items_by_id,
        bom_lines: lines_by_bom_item_id,
        last_paid: last_paid_by_item_id,
        primary_terms: primary_terms_by_item_id,
        company: company
      }

      {rows, _memo} =
        Enum.map_reduce(top_items, %{}, fn item, memo ->
          {cost, memo2} = resolve_cost(item.id, ctx, memo, MapSet.new(), 0)
          {response_row(item, cost), memo2}
        end)

      rows
    end
  end

  # ----- BOM rollup helpers ---------------------------------------

  # Latest paid across any vendor per item. `distinct: :item_id`
  # keeps one row per item; ordering by `last_paid_at desc`
  # guarantees the newest wins per PG's DISTINCT ON semantics.
  defp load_last_paid(_company_id, []), do: %{}

  defp load_last_paid(company_id, item_ids) do
    alias Backend.Purchasing.VendorItemPrice
    alias Backend.Vendors.Vendor

    Repo.all(
      from(p in VendorItemPrice,
        where: p.company_id == ^company_id and p.item_id in ^item_ids,
        join: v in Vendor,
        on: v.id == p.vendor_id,
        order_by: [asc: p.item_id, desc: p.last_paid_at],
        distinct: [p.item_id],
        select: {p.item_id, p.unit_price, p.currency_code, v.name}
      )
    )
    |> Map.new(fn {item_id, price, ccy, vendor_name} ->
      {item_id, %{unit_price: price, currency_code: ccy, vendor_name: vendor_name}}
    end)
  end

  # Prefetch the primary term per item (vendor-agnostic — cheapest
  # live term across all quoting vendors). N sequential Repo calls
  # here is dwarfed by the FE round-trips it saves.
  defp load_primary_terms(_company_id, []), do: %{}

  defp load_primary_terms(company_id, item_ids) do
    item_ids
    |> Enum.map(fn item_id ->
      case item_default_cost(company_id, item_id) do
        nil -> {item_id, nil}
        term -> {item_id, Repo.preload(term, :vendor)}
      end
    end)
    |> Map.new()
  end

  # BFS the BOM graph. Starts from the seed items and expands through
  # every semi_finished part encountered, loading each level's
  # primary+active BOM lines in a single query. Returns:
  #
  #   * `items_by_id` — every item touched (seed ∪ reachable parts)
  #     with `stock_uom` preloaded so the rollup can convert qty.
  #   * `lines_by_bom_item_id` — for each semi_finished item that
  #     owns a primary+active BOM, the list of its lines with the
  #     line's UoM preloaded. Terminal / raw parts don't appear here.
  defp preload_bom_graph(company_id, seed_items) do
    items_by_id = Map.new(seed_items, &{&1.id, &1})

    # Only semi_finished items can host a rollup — raw materials and
    # finished products stop the walk.
    initial_frontier =
      seed_items
      |> Enum.filter(&(&1.item_type == "semi_finished"))
      |> Enum.map(& &1.id)
      |> MapSet.new()

    walk_bom_graph(company_id, initial_frontier, items_by_id, %{}, 0)
  end

  defp walk_bom_graph(company_id, frontier, items_by_id, lines_by_item_id, depth) do
    cond do
      depth > @bom_rollup_max_depth ->
        # Hit the depth cap — stop expanding but keep whatever we've
        # collected. Anything below this level surfaces as `none` in
        # `resolve_cost` because its BOM lines weren't preloaded.
        {items_by_id, lines_by_item_id}

      MapSet.size(frontier) == 0 ->
        {items_by_id, lines_by_item_id}

      true ->
        do_walk_bom_graph(company_id, frontier, items_by_id, lines_by_item_id, depth)
    end
  end

  defp do_walk_bom_graph(company_id, frontier, items_by_id, lines_by_item_id, depth) do
    alias Backend.Items.Item
    alias Backend.Production.{BOM, BOMLine}

    frontier_ids = MapSet.to_list(frontier)

    # Load the primary+active BOM lines for every item in the
    # frontier. One query per depth level regardless of frontier
    # size — Postgres handles the IN list. We select the owning
    # BOM's `item_id` alongside the line so grouping doesn't need a
    # second round-trip.
    line_rows =
      Repo.all(
        from(l in BOMLine,
          join: b in BOM,
          on: b.id == l.bom_id,
          where:
            b.company_id == ^company_id and b.is_primary == true and b.is_active == true and
              b.item_id in ^frontier_ids,
          preload: [:unit_of_measurement],
          select: {b.item_id, l}
        )
      )

    lines_by_owning_item_id =
      Enum.reduce(line_rows, %{}, fn {owner_item_id, line}, acc ->
        Map.update(acc, owner_item_id, [line], &[line | &1])
      end)

    lines_by_item_id_merged = Map.merge(lines_by_item_id, lines_by_owning_item_id)

    # Collect part_ids that we haven't loaded yet — they become the
    # next frontier if they're semi_finished.
    discovered_part_ids =
      line_rows
      |> Enum.map(fn {_owner_id, line} -> line.part_id end)
      |> Enum.uniq()
      |> Enum.reject(&Map.has_key?(items_by_id, &1))

    new_items =
      if discovered_part_ids == [] do
        []
      else
        Repo.all(
          from(i in Item,
            where: i.company_id == ^company_id and i.id in ^discovered_part_ids,
            left_join: u in assoc(i, :stock_uom),
            preload: [stock_uom: u]
          )
        )
      end

    items_by_id_merged =
      Enum.reduce(new_items, items_by_id, fn i, acc -> Map.put(acc, i.id, i) end)

    next_frontier =
      new_items
      |> Enum.filter(&(&1.item_type == "semi_finished"))
      |> Enum.map(& &1.id)
      |> MapSet.new()

    walk_bom_graph(
      company_id,
      next_frontier,
      items_by_id_merged,
      lines_by_item_id_merged,
      depth + 1
    )
  end

  # Resolve one item's unit cost with memoisation + cycle guard.
  # Returns `{cost_struct, updated_memo}`. `cost_struct` is nil-safe
  # (`unit_cost: nil`, `source: "none"`) for unresolvable items.
  defp resolve_cost(item_id, ctx, memo, seen, depth) do
    cond do
      Map.has_key?(memo, item_id) ->
        {Map.fetch!(memo, item_id), memo}

      MapSet.member?(seen, item_id) ->
        # Cycle — treat as unresolved to break the loop. Don't
        # memoise; the same item on a different branch might still
        # resolve legitimately.
        {%{
           unit_cost: nil,
           currency_code: nil,
           source: "none",
           vendor_name: nil,
           uom_symbol: nil
         }, memo}

      true ->
        item = Map.get(ctx.items, item_id)

        cost =
          cond do
            is_nil(item) ->
              nil_cost()

            paid = Map.get(ctx.last_paid, item_id) ->
              %{
                unit_cost: paid.unit_price,
                currency_code: paid.currency_code,
                source: "po_history",
                vendor_name: paid.vendor_name,
                uom_symbol: uom_symbol_of(item)
              }

            term = Map.get(ctx.primary_terms, item_id) ->
              %{
                unit_cost: term.price,
                currency_code: term.currency_code,
                source: "purchase_term",
                vendor_name: term.vendor && term.vendor.name,
                uom_symbol: term.min_quantity_uom || uom_symbol_of(item)
              }

            item.item_type == "semi_finished" and depth < @bom_rollup_max_depth ->
              # Delegate to a helper that walks this item's BOM lines
              # and either returns a summed rollup or nil_cost.
              nil

            true ->
              nil_cost()
          end

        {cost, memo2} =
          case cost do
            nil ->
              rollup_cost(item, ctx, memo, MapSet.put(seen, item_id), depth + 1)

            direct ->
              {direct, memo}
          end

        {cost, Map.put(memo2, item_id, cost)}
    end
  end

  # BOM rollup for a semi_finished with no direct cost. Sums each
  # line's `qty × child_unit_cost`, normalising every child into the
  # company's base currency and every line's qty into the part's
  # stock_uom. Any degradation (missing rate, dimension mismatch,
  # unresolved child) marks the whole row `bom_rollup_partial` so the
  # UI can warn without hiding the number.
  defp rollup_cost(item, ctx, memo, seen, depth) do
    lines = Map.get(ctx.bom_lines, item.id, [])
    base_ccy = ctx.company.currency_code
    rates = ctx.company.currency_rates || %{}

    if lines == [] do
      {%{
         unit_cost: nil,
         currency_code: nil,
         source: "none",
         vendor_name: nil,
         uom_symbol: uom_symbol_of(item)
       }, memo}
    else
      {sum, partial?, memo2} =
        Enum.reduce(lines, {Decimal.new(0), false, memo}, fn line,
                                                             {acc, partial?, memo_in} ->
          {child_cost, memo_next} =
            resolve_cost(line.part_id, ctx, memo_in, seen, depth)

          case line_contribution(line, ctx.items, child_cost, base_ccy, rates) do
            {:ok, amount} ->
              {Decimal.add(acc, amount), partial?, memo_next}

            :partial ->
              {acc, true, memo_next}
          end
        end)

      cond do
        Decimal.compare(sum, Decimal.new(0)) == :eq and partial? ->
          {%{
             unit_cost: nil,
             currency_code: nil,
             source: "none",
             vendor_name: nil,
             uom_symbol: uom_symbol_of(item)
           }, memo2}

        partial? ->
          {%{
             unit_cost: sum,
             currency_code: base_ccy,
             source: "bom_rollup_partial",
             vendor_name: nil,
             uom_symbol: uom_symbol_of(item)
           }, memo2}

        true ->
          {%{
             unit_cost: sum,
             currency_code: base_ccy,
             source: "bom_rollup",
             vendor_name: nil,
             uom_symbol: uom_symbol_of(item)
           }, memo2}
      end
    end
  end

  # A single BOM line's contribution to the parent's cost. Returns
  # `{:ok, amount_in_base_ccy}` or `:partial` when any piece is
  # missing (unresolved child, no rate, dim mismatch on UoM).
  defp line_contribution(line, items_by_id, child_cost, base_ccy, rates) do
    part = Map.get(items_by_id, line.part_id)

    with true <- child_has_cost?(child_cost),
         {:ok, qty} <- line_qty_in_part_stock_uom(line, part),
         {:ok, child_price_in_base} <-
           to_base(child_cost.unit_cost, child_cost.currency_code, base_ccy, rates) do
      {:ok, Decimal.mult(qty, child_price_in_base)}
    else
      _ -> :partial
    end
  end

  defp child_has_cost?(%{unit_cost: %Decimal{}}), do: true
  defp child_has_cost?(_), do: false

  # Convert `line.qty` into the part's stock_uom. If the line has no
  # explicit UoM we assume it's already stored in the part's stock
  # UoM (the shape the FE writes today). If dimensions mismatch or
  # the part is missing we degrade the line to `:partial`.
  defp line_qty_in_part_stock_uom(%{unit_of_measurement: nil, qty: qty}, _part),
    do: {:ok, qty}

  defp line_qty_in_part_stock_uom(_line, nil), do: {:error, :no_part}

  defp line_qty_in_part_stock_uom(line, %{stock_uom: nil}), do: {:ok, line.qty}

  defp line_qty_in_part_stock_uom(line, part) do
    case Backend.Units.convert(line.qty, line.unit_of_measurement, part.stock_uom) do
      {:ok, converted} -> {:ok, converted}
      {:error, _} -> {:error, :dim_mismatch}
    end
  end

  # `amount_in_base = amount / rate` where rate = "1 base = X foreign"
  # (mirrors `Backend.CashFlow.convert_to_base/4`).
  defp to_base(_amount, nil, _base_ccy, _rates), do: {:error, :no_rate}

  defp to_base(amount, ccy, base_ccy, _rates) when ccy == base_ccy, do: {:ok, amount}

  defp to_base(amount, ccy, _base_ccy, rates) do
    case Map.get(rates, ccy) do
      nil ->
        {:error, :no_rate}

      rate when is_binary(rate) ->
        to_base(amount, ccy, nil, %{ccy => Decimal.new(rate)})

      rate ->
        case Decimal.compare(rate, Decimal.new(0)) do
          :gt -> {:ok, Decimal.div(amount, rate)}
          _ -> {:error, :no_rate}
        end
    end
  end

  defp nil_cost do
    %{
      unit_cost: nil,
      currency_code: nil,
      source: "none",
      vendor_name: nil,
      uom_symbol: nil
    }
  end

  defp uom_symbol_of(%{stock_uom: %{symbol: s}}), do: s
  defp uom_symbol_of(_), do: nil

  defp response_row(item, cost) do
    %{
      uuid: item.uuid,
      unit_cost: cost.unit_cost,
      currency_code: cost.currency_code,
      uom_symbol: cost.uom_symbol || uom_symbol_of(item),
      source: cost.source,
      vendor_name: cost.vendor_name
    }
  end

  def get(company_id, uuid) when is_integer(company_id) and is_binary(uuid) do
    Repo.one(
      from(t in PurchaseTerm,
        where: t.company_id == ^company_id and t.uuid == ^uuid,
        preload: [:vendor, :item]
      )
    )
  end

  @doc """
  Create or update a purchase term for a (vendor, item) pair. The
  unique index on (company, vendor, item) means a second call with
  the same key updates the existing row instead of failing — the
  caller sees a normal changeset back either way.

  Returns:

    * `{:ok, %PurchaseTerm{}}` — persisted, preloaded.
    * `{:error, :requires_approval}` — the vendor isn't on the item's
      approved-supplier list. Fix by approving on the vendor page,
      then retry.
    * `{:error, %Ecto.Changeset{}}` — validation failure (missing
      required field, bad decimal, currency, etc.).
  """
  def upsert(attrs, opts \\ []) when is_map(attrs) do
    company_id = to_int(attrs["company_id"] || attrs[:company_id])
    vendor_id = to_int(attrs["vendor_id"] || attrs[:vendor_id])
    item_id = to_int(attrs["item_id"] || attrs[:item_id])

    with true <- present?(company_id) and present?(vendor_id) and present?(item_id),
         :ok <- ensure_approved(company_id, vendor_id, item_id, opts) do
      existing =
        Repo.get_by(PurchaseTerm,
          company_id: company_id,
          vendor_id: vendor_id,
          item_id: item_id
        )

      changeset =
        (existing || %PurchaseTerm{})
        |> PurchaseTerm.changeset(attrs)

      case Repo.insert_or_update(changeset) do
        {:ok, term} -> {:ok, Repo.preload(term, [:vendor, :item])}
        {:error, cs} -> {:error, cs}
      end
    else
      false -> {:error, :missing_scope}
      {:error, reason} -> {:error, reason}
    end
  end

  def delete(%PurchaseTerm{} = term) do
    Repo.delete(term)
  end

  # ----- helpers ----------------------------------------------------

  # Skipping the approval check is only for internal callers that
  # already validated (e.g. bulk import). External API always enforces.
  defp ensure_approved(company_id, vendor_id, item_id, opts) do
    if Keyword.get(opts, :skip_approval_check, false) do
      :ok
    else
      do_ensure_approved(company_id, vendor_id, item_id)
    end
  end

  defp do_ensure_approved(company_id, vendor_id, item_id) do
    exists? =
      Repo.exists?(
        from(a in ApprovedItem,
          where:
            a.company_id == ^company_id and
              a.vendor_id == ^vendor_id and
              a.item_id == ^item_id
        )
      )

    if exists?, do: :ok, else: {:error, :requires_approval}
  end

  defp present?(nil), do: false
  defp present?(_), do: true

  defp to_int(nil), do: nil
  defp to_int(n) when is_integer(n), do: n

  defp to_int(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp to_int(_), do: nil
end
