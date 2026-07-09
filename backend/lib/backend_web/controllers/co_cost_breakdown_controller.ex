defmodule BackendWeb.COCostBreakdownController do
  @moduledoc """
  `GET /api/customer-orders/:customer_order_id/cost-breakdown`

  Project-wide cost roll-up: every MO in this CO's tree (top-level +
  descendants via `parent_mo_id`) summed into a materials / labour /
  machine total. Powers the "Project cost so far" card on the wizard
  (project control board).

  The heavy lifting lives in `Backend.Production.Costing`; this
  controller stringifies decimals so the frontend can render them
  without pulling in a Decimal library.
  """

  use BackendWeb, :controller

  import Ecto.Query

  alias Backend.CustomerOrders.CustomerOrder
  alias Backend.Production.Costing
  alias Backend.Repo
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "customer_orders.view"

  action_fallback BackendWeb.FallbackController

  def show(conn, %{"customer_order_id" => uuid}) do
    company_id = conn.assigns.current_user.company_id

    with co_id when is_integer(co_id) <-
           Repo.one(
             from c in CustomerOrder,
               where: c.company_id == ^company_id and c.uuid == ^uuid,
               select: c.id
           ),
         %{} = breakdown <- Costing.customer_order_cost_breakdown(company_id, co_id) do
      json(conn, stringify(breakdown))
    else
      _ -> {:error, :not_found}
    end
  end

  # ---- helpers ----

  # Stringify every %Decimal{} in the response so the frontend types
  # can stay `string | null`. Recurses maps + lists; leaves everything
  # else untouched (integers stay integers, DateTimes serialise via
  # Jason natively).
  defp stringify(%Decimal{} = d), do: to_string(d)
  defp stringify(nil), do: nil

  defp stringify(map) when is_map(map) and not is_struct(map) do
    Map.new(map, fn {k, v} -> {k, stringify(v)} end)
  end

  defp stringify(list) when is_list(list), do: Enum.map(list, &stringify/1)
  defp stringify(other), do: other
end
