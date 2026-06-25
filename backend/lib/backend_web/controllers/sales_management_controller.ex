defmodule BackendWeb.SalesManagementController do
  @moduledoc """
  Single endpoint dashboard — sales-management book-of-business snapshot.
  Read-only. Powers /sales/sales-management.
  """

  use BackendWeb, :controller

  alias Backend.{Companies, SalesManagement}
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "sales_management.view" when action in [:index]

  action_fallback BackendWeb.FallbackController

  def index(conn, _params) do
    actor = conn.assigns.current_user
    company = Companies.get!(actor.company_id)

    snapshot = SalesManagement.snapshot(company)

    json(conn, %{
      sales_management: Payloads.sales_management(snapshot, company),
      base_currency: company.currency_code
    })
  end
end
