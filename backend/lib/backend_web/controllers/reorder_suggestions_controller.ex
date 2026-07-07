defmodule BackendWeb.ReorderSuggestionsController do
  @moduledoc """
  Read surface for the reorder queue — items whose coverage (on-hand +
  in-flight PO qty) has fallen below their configured `min_stock_qty`.

  Gated on `procurement.po_view` (same read gate as the shortages
  page — this is a "what to buy next" list, not a mutation surface).
  """
  use BackendWeb, :controller

  alias Backend.Procurement
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "procurement.po_view" when action in [:index]

  action_fallback BackendWeb.FallbackController

  def index(conn, _params) do
    actor = conn.assigns.current_user

    rows =
      actor.company_id
      |> Procurement.reorder_status()
      |> Enum.filter(& &1.below_threshold)

    json(conn, %{
      suggestions: Enum.map(rows, &row_payload(actor.company_id, &1)),
      total: length(rows)
    })
  end

  defp row_payload(company_id, row) do
    vendor = Procurement.last_vendor_for_item(company_id, row.item.id)

    %{
      item: Payloads.item(row.item),
      on_hand: row.on_hand,
      in_flight: row.in_flight,
      coverage: row.coverage,
      min_stock_qty: row.min_stock_qty,
      target_stock_qty: row.target_stock_qty,
      shortfall: row.shortfall,
      # Suggested vendor for the pre-filled PO. Nil when the item has
      # never been ordered — the buyer picks manually in that case.
      suggested_vendor: vendor && Payloads.vendor_summary(vendor)
    }
  end
end
