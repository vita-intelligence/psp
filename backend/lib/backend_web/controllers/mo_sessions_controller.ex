defmodule BackendWeb.MOSessionsController do
  @moduledoc """
  Chronological session read for the timeline UI on the MO detail
  page + the CO wizard. Two entry points, one payload shape:

    * `GET /api/manufacturing-orders/:id/sessions` — every session
      attributed to any step of this MO.
    * `GET /api/customer-orders/:uuid/sessions` — every session
      across every MO in the CO's tree (main + sub-assemblies).

  Session data lands here via the vita-performance kiosk writeback
  (`BackendWeb.IntegrationSessionController.create_mo_session/2`).
  Gated by `production.mo_view` — same rule the MO index uses; if
  you can see the MO, you can see its labour timeline.
  """

  use BackendWeb, :controller

  import Ecto.Query

  alias Backend.CustomerOrders
  alias Backend.Production
  alias Backend.Production.ManufacturingOrder
  alias Backend.Repo
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "production.mo_view" when action == :index
  plug RequirePermission, "customer_orders.view" when action == :for_customer_order

  action_fallback BackendWeb.FallbackController

  def index(conn, %{"id" => id}) do
    actor = conn.assigns.current_user

    with {mo_id, ""} <- Integer.parse(id),
         %ManufacturingOrder{} <-
           Repo.one(
             from(m in ManufacturingOrder,
               where: m.company_id == ^actor.company_id and m.id == ^mo_id,
               select: m
             )
           ) do
      sessions = Production.list_sessions_for_mo(actor.company_id, mo_id)
      json(conn, %{sessions: Payloads.workstation_sessions(sessions)})
    else
      _ -> {:error, :not_found}
    end
  end

  def for_customer_order(conn, %{"customer_order_id" => uuid}) do
    actor = conn.assigns.current_user

    case CustomerOrders.get_for_company(actor.company_id, uuid) do
      nil ->
        {:error, :not_found}

      co ->
        sessions = Production.list_sessions_for_customer_order(actor.company_id, co.id)
        json(conn, %{sessions: Payloads.workstation_sessions(sessions)})
    end
  end
end
