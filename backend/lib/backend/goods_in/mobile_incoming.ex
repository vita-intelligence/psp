defmodule Backend.GoodsIn.MobileIncoming do
  @moduledoc """
  Mobile "Expected today" board.

  Returns POs in `ordered` or `partially_received` status whose
  `expected_delivery_date` falls inside a horizon window (default
  today + 7 days), optionally filtered by warehouse. Each PO is
  joined with the most-recent non-terminal goods-in inspection so
  the FE can decide between "start a new inspection" and "jump back
  into the one already in progress".

  This is a read-only projection across the Purchasing + GoodsIn
  contexts — it doesn't own state, just shapes a list the operator
  picks up on the tablet. Gated by `goods_in.view` at the controller.
  """

  import Ecto.Query, warn: false

  alias Backend.GoodsIn.Inspection
  alias Backend.Purchasing.PurchaseOrder
  alias Backend.Repo

  @default_window_days 7
  @max_window_days 90
  @open_statuses ~w(ordered partially_received)
  @open_inspection_statuses ~w(draft submitted)

  @doc """
  Build the "expected deliveries" projection.

  Options (all optional):

    * `:window_days` — integer ≥ 0; horizon size in days from today.
      Defaults to 7. Clamped to `@max_window_days` so a stray
      `?days=99999` doesn't scan the whole table.
    * `:warehouse_id` — narrow to POs whose `default_warehouse_id`
      matches. Lines may carry per-line overrides, but the "expected
      today" board reads off the header default — it's a delivery
      planning view, not a per-line picking view.
    * `:include_overdue?` — defaults to `true`. POs whose expected
      date already slipped past today are included so the operator
      sees "this should have landed yesterday" with the overdue
      badge.

  Returns:

      %{
        items: [%{purchase_order: PO_payload, open_inspection: insp | nil}],
        by_day: %{"2026-06-11" => 3, "2026-06-12" => 1, ...}
      }
  """
  def list_expected(company_id, opts \\ []) when is_integer(company_id) do
    today = Keyword.get(opts, :today) || Date.utc_today()
    window = clamp_window(Keyword.get(opts, :window_days, @default_window_days))
    horizon = Date.add(today, window)
    warehouse_id = parse_warehouse_id(opts[:warehouse_id])
    include_overdue? = Keyword.get(opts, :include_overdue?, true)

    base =
      from(p in PurchaseOrder,
        where: p.company_id == ^company_id,
        where: p.status in ^@open_statuses,
        where: not is_nil(p.expected_delivery_date),
        where: p.expected_delivery_date <= ^horizon,
        order_by: [asc: p.expected_delivery_date, asc: p.id],
        preload: [
          :vendor,
          :default_warehouse,
          lines: [:item]
        ]
      )

    base
    |> maybe_warehouse_filter(warehouse_id)
    |> maybe_overdue_filter(today, include_overdue?)
    |> Repo.all()
    |> attach_open_inspections(company_id)
    |> shape_response()
  end

  defp clamp_window(n) when is_integer(n) and n >= 0,
    do: min(n, @max_window_days)

  defp clamp_window(raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} when n >= 0 -> min(n, @max_window_days)
      _ -> @default_window_days
    end
  end

  defp clamp_window(_), do: @default_window_days

  defp parse_warehouse_id(nil), do: nil
  defp parse_warehouse_id(""), do: nil
  defp parse_warehouse_id(n) when is_integer(n) and n > 0, do: n

  defp parse_warehouse_id(raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} when n > 0 -> n
      _ -> nil
    end
  end

  defp parse_warehouse_id(_), do: nil

  defp maybe_warehouse_filter(query, nil), do: query

  defp maybe_warehouse_filter(query, warehouse_id) when is_integer(warehouse_id) do
    where(query, [p], p.default_warehouse_id == ^warehouse_id)
  end

  defp maybe_overdue_filter(query, _today, true), do: query

  defp maybe_overdue_filter(query, today, false) do
    where(query, [p], p.expected_delivery_date >= ^today)
  end

  # One follow-up query for the open inspection (status ∈ draft|submitted)
  # per PO — keyed on the PO id list we just pulled. Returns the most
  # recent one per PO so a tablet operator who half-filled an
  # inspection yesterday lands right back in the same draft today.
  defp attach_open_inspections([], _company_id), do: []

  defp attach_open_inspections(pos, company_id) do
    po_ids = Enum.map(pos, & &1.id)

    inspections =
      Repo.all(
        from(i in Inspection,
          where: i.company_id == ^company_id,
          where: i.purchase_order_id in ^po_ids,
          where: i.status in ^@open_inspection_statuses,
          order_by: [desc: i.inserted_at, desc: i.id],
          preload: [:goods_in_operator, :quality_approver]
        )
      )

    # Bucket by PO id, keeping the first (most recent) per group.
    by_po =
      Enum.reduce(inspections, %{}, fn insp, acc ->
        Map.put_new(acc, insp.purchase_order_id, insp)
      end)

    Enum.map(pos, fn po ->
      {po, Map.get(by_po, po.id)}
    end)
  end

  defp shape_response(pairs) do
    by_day =
      Enum.reduce(pairs, %{}, fn {po, _insp}, acc ->
        key = Date.to_iso8601(po.expected_delivery_date)
        Map.update(acc, key, 1, &(&1 + 1))
      end)

    %{items: pairs, by_day: by_day}
  end
end
