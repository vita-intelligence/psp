defmodule BackendWeb.StatisticsController do
  @moduledoc """
  Single endpoint dashboard — sales statistics snapshot.

  Read-only. Powers /sales/statistics.
  """

  use BackendWeb, :controller

  alias Backend.{Companies, Statistics}
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "statistics.view" when action in [:index]

  action_fallback BackendWeb.FallbackController

  def index(conn, _params) do
    actor = conn.assigns.current_user
    company = Companies.get!(actor.company_id)

    snapshot = Statistics.snapshot(company)

    json(conn, %{
      statistics: Payloads.statistics(snapshot, company),
      base_currency: company.currency_code
    })
  end
end
