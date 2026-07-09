defmodule BackendWeb.COTimeBreakdownController do
  @moduledoc """
  `GET /api/customer-orders/:customer_order_id/time-breakdown`

  Project-wide wall-clock roll-up: total elapsed since the CO was
  drafted, split into the timestamped phases (setup, approval,
  in_production, awaiting_pickup, dispatched, delivered) plus two
  grouped ranges covering the phases we can't back-compute yet
  (preparing_production, post_production_pre_dispatch). Powers the
  "Project time so far" card on the wizard.

  Compute lives in `Backend.CustomerOrders.TimeBreakdown`; this
  controller resolves UUID → id and passes the response through.
  """

  use BackendWeb, :controller

  import Ecto.Query

  alias Backend.CustomerOrders.CustomerOrder
  alias Backend.CustomerOrders.TimeBreakdown
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
         %{} = breakdown <- TimeBreakdown.customer_order_time_breakdown(company_id, co_id) do
      json(conn, breakdown)
    else
      _ -> {:error, :not_found}
    end
  end
end
