defmodule BackendWeb.MobileDispatchPickupController do
  @moduledoc """
  Mobile pickup queue for the ``/m/dispatch`` landing page.

      GET /api/m/dispatch-pickups?cursor=&search=&limit=

  Returns ``{items, next_cursor}`` where every item is a slim
  ``shipment_pickup_row`` (uuid, code, recipient, planned ship time,
  lot code + qty, customer name). Keyset paginated on
  ``(planned_ship_at ASC NULLS LAST, id ASC)`` — the partial
  ``shipments_ready_queue_idx`` migration keeps the cost O(page size)
  even against millions of historical shipments.

  Permission gate: ``shipments.pickup`` — same perm that lets an
  operator tap Confirm pickup on a shipment detail page, so anyone
  who could complete the pickup can also see the queue.
  """

  use BackendWeb, :controller

  alias Backend.Shipments
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "shipments.pickup" when action in [:queue]

  action_fallback BackendWeb.FallbackController

  def queue(conn, params) do
    actor = conn.assigns.current_user

    opts = [
      limit: parse_limit(params["limit"]),
      cursor: sanitize_string(params["cursor"]),
      search: sanitize_string(params["search"])
    ]

    {items, next_cursor} = Shipments.list_ready_for_pickup(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.shipment_pickup_row/1),
      next_cursor: next_cursor
    })
  end

  # Page size — same defaults as the desktop shipments list. Clamp to
  # a hard ceiling so a malicious ``?limit=1000000`` request can't
  # spike DB / memory.
  defp parse_limit(nil), do: 25

  defp parse_limit(raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} when n > 0 -> min(n, 100)
      _ -> 25
    end
  end

  defp parse_limit(_), do: 25

  defp sanitize_string(v) when is_binary(v) and v != "", do: v
  defp sanitize_string(_), do: nil
end
