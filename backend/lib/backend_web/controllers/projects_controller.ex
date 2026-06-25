defmodule BackendWeb.ProjectsController do
  @moduledoc """
  Read-only landing page for active "projects" — i.e., every CO
  that's left the draft stage and hasn't been cancelled. The page
  shows one card per project with its wizard phase + the "do this
  next" hook so an operator opening PSP first thing in the morning
  knows where every job stands.
  """

  use BackendWeb, :controller

  alias Backend.OrderWizard
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "customer_orders.view" when action in [:index]

  action_fallback BackendWeb.FallbackController

  def index(conn, _params) do
    actor = conn.assigns.current_user

    summaries = OrderWizard.list_active(actor.company_id)

    json(conn, %{
      items: Enum.map(summaries, &Payloads.project_summary/1)
    })
  end
end
