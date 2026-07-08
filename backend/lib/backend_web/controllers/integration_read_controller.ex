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

    # MO steps route to a workstation_group, not to a specific
    # workstation. So "MOs routed to Weighing #1" means "MOs with a
    # step targeting Weighing #1's group". We look up the group off
    # the workstation before hitting the MO query so the SQL stays
    # a plain WHERE, not a JOIN across a nullable chain.
    group_id =
      case workstation_uuid do
        u when is_binary(u) and u != "" ->
          Repo.one(
            from w in Workstation,
              where: w.company_id == ^company_id and w.uuid == ^u,
              select: w.workstation_group_id
          )

        _ ->
          nil
      end

    base =
      from mo in ManufacturingOrder,
        where: mo.company_id == ^company_id and mo.status in ^statuses,
        preload: [:item, steps: :workstation_group]

    base =
      if group_id do
        from mo in base,
          join: s in assoc(mo, :steps),
          where: s.workstation_group_id == ^group_id,
          distinct: true
      else
        base
      end

    mos = Repo.all(base)
    json(conn, %{items: Enum.map(mos, &mo_payload(&1, group_id))})
  end

  def get_manufacturing_order(conn, %{"uuid" => uuid}) do
    company_id = conn.assigns.current_company_id

    case Repo.one(
           from mo in ManufacturingOrder,
             where: mo.company_id == ^company_id and mo.uuid == ^uuid,
             preload: [:item, steps: :workstation_group]
         ) do
      nil -> {:error, :not_found}
      mo -> json(conn, %{manufacturing_order: mo_payload(mo, nil)})
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

  defp mo_payload(%ManufacturingOrder{} = mo, filter_group_id) do
    %{
      uuid: mo.uuid,
      status: mo.status,
      quantity: to_string(mo.quantity),
      due_date: mo.due_date,
      item: item_summary(mo.item),
      steps:
        Enum.map(mo.steps || [], fn step ->
          step
          |> mo_step_summary()
          |> Map.put(
            :for_this_workstation,
            filter_group_id != nil and
              step.workstation_group_id == filter_group_id
          )
        end)
    }
  end

  defp mo_step_summary(%ManufacturingOrderStep{} = step) do
    %{
      uuid: step.uuid,
      sort_order: step.sort_order,
      # Steps use `operation_description` as their human label; `name`
      # is a legacy field that no longer exists on the schema.
      name: step.operation_description,
      # Steps don't carry their own status column — it's derived from
      # the parent MO's status + preflight / QC events. Return nil
      # so callers know to look at the MO status instead.
      status: nil,
      planned_start: step.planned_start,
      planned_finish: step.planned_finish,
      actual_start: step.actual_start,
      actual_finish: step.actual_finish,
      # Steps target a workstation group, not a specific station.
      # The kiosk uses the group to know "is this MO for any of the
      # stations in my group?"
      workstation_group: workstation_group_summary(step.workstation_group)
    }
  end

  defp workstation_group_summary(nil), do: nil

  defp workstation_group_summary(%{uuid: uuid, name: name}) do
    %{uuid: uuid, name: name}
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
