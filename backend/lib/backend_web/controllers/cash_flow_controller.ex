defmodule BackendWeb.CashFlowController do
  @moduledoc """
  Single endpoint dashboard — 12-week cash-flow forecast.

  Read-only. The underlying writes happen on the sales-invoice + PO
  workflows themselves; this surface is a projection.
  """

  use BackendWeb, :controller

  alias Backend.{CashFlow, Companies}
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "cash_flow.view" when action in [:index]

  action_fallback BackendWeb.FallbackController

  def index(conn, _params) do
    actor = conn.assigns.current_user
    company = Companies.get!(actor.company_id)

    forecast = CashFlow.forecast(company)

    json(conn, %{
      cash_flow: Payloads.cash_flow(forecast, company),
      base_currency: company.currency_code
    })
  end
end
