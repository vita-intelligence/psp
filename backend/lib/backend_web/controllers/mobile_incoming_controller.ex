defmodule BackendWeb.MobileIncomingController do
  @moduledoc """
  Mobile "Expected today" board — the landing page operators see when
  they pick up the tablet at the goods-in dock.

  One read endpoint:

      GET /api/m/incoming?days=N&warehouse_id=X

  Returns POs in `ordered` or `partially_received` status whose
  expected delivery date lands inside the horizon window (default
  today + 7 days), each joined with its most-recent non-terminal
  Goods-In Inspection (so the FE can route between "start a fresh
  inspection" and "jump back into a draft").

  Gated by `goods_in.view` — the same perm the inspection wizard
  uses. Works under both the laptop session token and the paired
  device token (the RequireAuth plug falls through device tokens
  transparently).
  """

  use BackendWeb, :controller

  alias Backend.GoodsIn.MobileIncoming
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "goods_in.view" when action in [:index]

  action_fallback BackendWeb.FallbackController

  def index(conn, params) do
    actor = conn.assigns.current_user

    opts =
      [
        window_days: parse_window(params),
        warehouse_id: params["warehouse_id"]
      ]

    %{items: pairs, by_day: by_day} =
      MobileIncoming.list_expected(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(pairs, &mobile_incoming_row/1),
      by_day: by_day
    })
  end

  defp parse_window(%{"days" => raw}), do: raw
  defp parse_window(_), do: 7

  # Per-row shape: PO summary + the most-recent open inspection (or
  # nil). Deliberately slim — the operator card doesn't need money
  # totals or approval signatures, just "what's coming, who's it from,
  # is someone already on it".
  defp mobile_incoming_row({po, open_inspection}) do
    %{
      purchase_order: %{
        id: po.id,
        uuid: po.uuid,
        code: Payloads.render_entity_code(po, "purchase_order"),
        status: po.status,
        expected_delivery_date: po.expected_delivery_date,
        delivery_address: po.delivery_address,
        notes: po.notes,
        vendor: vendor_compact(po.vendor),
        default_warehouse: warehouse_compact(po.default_warehouse),
        lines: Enum.map(po.lines || [], &line_compact/1)
      },
      open_inspection: maybe_open_inspection(open_inspection)
    }
  end

  defp vendor_compact(%Backend.Vendors.Vendor{} = v) do
    %{
      id: v.id,
      uuid: v.uuid,
      code: Payloads.render_entity_code(v, "vendor"),
      name: v.name
    }
  end

  defp vendor_compact(_), do: nil

  defp warehouse_compact(%Backend.Warehouses.Warehouse{} = w) do
    %{
      id: w.id,
      uuid: w.uuid,
      code: Payloads.render_entity_code(w, "warehouse"),
      name: w.name
    }
  end

  defp warehouse_compact(_), do: nil

  defp line_compact(%Backend.Purchasing.PurchaseOrderLine{} = l) do
    qty_ordered = l.qty_ordered || Decimal.new(0)
    qty_received = l.qty_received || Decimal.new(0)
    remaining = Decimal.sub(qty_ordered, qty_received)

    %{
      uuid: l.uuid,
      qty_ordered: qty_ordered,
      qty_received: qty_received,
      remaining: remaining,
      item: item_compact(l.item)
    }
  end

  defp item_compact(%Backend.Items.Item{} = i) do
    %{
      id: i.id,
      uuid: i.uuid,
      code: Payloads.render_entity_code(i, "item"),
      name: i.name
    }
  end

  defp item_compact(_), do: nil

  defp maybe_open_inspection(nil), do: nil

  defp maybe_open_inspection(%Backend.GoodsIn.Inspection{} = i) do
    %{
      id: i.id,
      uuid: i.uuid,
      status: i.status,
      delivery_date: i.delivery_date,
      goods_in_operator: actor_compact(i.goods_in_operator),
      quality_approver: actor_compact(i.quality_approver)
    }
  end

  defp actor_compact(%Backend.Accounts.User{} = u),
    do: %{id: u.id, uuid: u.uuid, name: u.name}

  defp actor_compact(_), do: nil
end
