defmodule BackendWeb.IntegrationReadController do
  @moduledoc """
  Read-side endpoints for the vita-performance integration. Every
  action is scope-gated by a `RequireIntegrationAuth` plug applied
  at the router level.

  All responses are company-scoped from `conn.assigns.current_company_id`,
  which the plug sets from the bearer token — the caller can't
  accidentally cross tenants.
  """

  use BackendWeb, :controller

  import Ecto.Query
  import BackendWeb.IntegrationScopePlug

  alias Backend.HR
  alias Backend.HR.EmployeeWage
  alias Backend.Items.Item
  alias Backend.Production.{ManufacturingOrder, ManufacturingOrderStep, Workstation}
  alias Backend.Repo

  plug :require_integration_scope, "mo:read"
       when action in [:list_manufacturing_orders, :get_manufacturing_order]

  plug :require_integration_scope, "workstation:read" when action == :list_workstations
  plug :require_integration_scope, "item:read" when action == :list_items
  plug :require_integration_scope, "hr:read" when action == :list_employees

  action_fallback BackendWeb.FallbackController

  # ---- Manufacturing orders ----

  def list_manufacturing_orders(conn, params) do
    company_id = conn.assigns.current_company_id
    statuses = parse_status_filter(params["status"])
    workstation_uuid = params["workstation_uuid"]

    base =
      from mo in ManufacturingOrder,
        where: mo.company_id == ^company_id and mo.status in ^statuses,
        preload: [:item, steps: :workstation]

    mos = Repo.all(base)

    mos =
      case workstation_uuid do
        uuid when is_binary(uuid) and uuid != "" ->
          Enum.filter(mos, fn mo ->
            Enum.any?(mo.steps, fn step ->
              step.workstation && step.workstation.external_id &&
                to_string(step.workstation.external_id) == uuid
            end)
          end)

        _ ->
          mos
      end

    json(conn, %{items: Enum.map(mos, &mo_payload/1)})
  end

  def get_manufacturing_order(conn, %{"uuid" => uuid}) do
    company_id = conn.assigns.current_company_id

    case Repo.one(
           from mo in ManufacturingOrder,
             where: mo.company_id == ^company_id and mo.uuid == ^uuid,
             preload: [:item, steps: [:workstation, :workstation_group]]
         ) do
      nil -> {:error, :not_found}
      mo -> json(conn, %{manufacturing_order: mo_payload(mo)})
    end
  end

  defp parse_status_filter(nil), do: ["scheduled", "in_progress"]
  defp parse_status_filter(""), do: ["scheduled", "in_progress"]

  defp parse_status_filter(s) when is_binary(s) do
    s
    |> String.split(",", trim: true)
    |> Enum.map(&String.trim/1)
    |> Enum.filter(&(&1 != ""))
  end

  defp mo_payload(%ManufacturingOrder{} = mo) do
    %{
      uuid: mo.uuid,
      status: mo.status,
      quantity: to_string(mo.quantity),
      due_date: mo.due_date,
      item: item_summary(mo.item),
      steps: Enum.map(mo.steps || [], &mo_step_summary/1)
    }
  end

  defp mo_step_summary(%ManufacturingOrderStep{} = step) do
    %{
      uuid: step.uuid,
      sort_order: step.sort_order,
      name: Map.get(step, :name) || Map.get(step, :operation_name),
      status: Map.get(step, :status),
      planned_start: step.planned_start,
      planned_finish: step.planned_end || step.planned_finish,
      actual_start: step.actual_start,
      actual_finish: step.actual_end || step.actual_finish,
      workstation: workstation_summary(step.workstation)
    }
  end

  defp workstation_summary(nil), do: nil

  defp workstation_summary(%Workstation{} = w) do
    %{uuid: w.uuid, external_id: w.external_id, name: w.name}
  end

  defp item_summary(nil), do: nil

  defp item_summary(%Item{} = i) do
    %{uuid: i.uuid, name: i.name, item_type: Map.get(i, :item_type)}
  end

  # ---- Workstations ----

  def list_workstations(conn, params) do
    company_id = conn.assigns.current_company_id
    only_sot = params["source_of_truth_only"] in ["true", "1"]

    query =
      from w in Workstation,
        where: w.company_id == ^company_id and w.is_active == true

    query =
      if only_sot, do: from(w in query, where: w.psp_source_of_truth == true), else: query

    workstations = Repo.all(from w in query, order_by: w.name)

    json(conn, %{
      items:
        Enum.map(workstations, fn w ->
          %{
            uuid: w.uuid,
            external_id: w.external_id,
            name: w.name,
            hourly_rate: w.hourly_rate,
            productivity: w.productivity,
            is_active: w.is_active,
            psp_source_of_truth: w.psp_source_of_truth
          }
        end)
    })
  end

  # ---- Items ----

  def list_items(conn, params) do
    company_id = conn.assigns.current_company_id

    types =
      case params["item_types"] do
        nil -> nil
        "" -> nil
        s -> String.split(s, ",", trim: true)
      end

    base =
      from i in Item,
        where: i.company_id == ^company_id and i.is_active == true,
        order_by: i.name

    query =
      case types do
        nil -> base
        list -> from i in base, where: i.item_type in ^list
      end

    items = Repo.all(query)

    json(conn, %{
      items:
        Enum.map(items, fn i ->
          %{
            uuid: i.uuid,
            name: i.name,
            item_type: i.item_type,
            external_sku: Map.get(i, :external_sku),
            is_active: i.is_active
          }
        end)
    })
  end

  # ---- HR / Employees ----

  def list_employees(conn, _params) do
    company_id = conn.assigns.current_company_id
    employees = HR.list_employees(company_id, active_only: true)

    json(conn, %{
      items:
        Enum.map(employees, fn e ->
          wage = HR.current_wage(e)

          %{
            uuid: e.uuid,
            external_id: e.external_id,
            full_name: e.full_name,
            preferred_name: e.preferred_name,
            is_active: e.is_active,
            is_qa: e.is_qa,
            reputation_score: e.reputation_score,
            employee_number: e.employee_number,
            has_pin: not is_nil(e.kiosk_pin_hash),
            current_hourly_rate:
              case wage do
                %EmployeeWage{hourly_rate: r} -> to_string(r)
                _ -> nil
              end,
            currency_code: wage && wage.currency_code
          }
        end)
    })
  end
end
