defmodule BackendWeb.MOCostBreakdownController do
  @moduledoc """
  `GET /api/production/manufacturing-orders/:uuid/cost-breakdown`

  Aggregates the actual costs incurred on a manufacturing order,
  broken down by step and rolled up to the MO total. Labour uses
  point-in-time wage lookups against `Backend.HR.EmployeeWage.wage_at/2`
  so a wage change mid-MO doesn't retroactively rewrite the labour
  cost of sessions that ran before the change.

  The compute logic lives in `Backend.Production.Costing`; this
  controller is now a thin HTTP shell that preserves the exact
  response shape callers depend on. See the module for the material,
  labour, machine, and per-unit roll-up rules.
  """

  use BackendWeb, :controller

  alias Backend.Production.Costing
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "production.mo_view"

  action_fallback BackendWeb.FallbackController

  def show(conn, %{"id" => uuid}) do
    company_id = conn.assigns.current_user.company_id

    case Costing.mo_cost_breakdown(company_id, uuid) do
      nil -> {:error, :not_found}
      breakdown -> json(conn, breakdown)
    end
  end
end
