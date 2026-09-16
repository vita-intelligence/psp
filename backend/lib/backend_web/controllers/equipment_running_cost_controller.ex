defmodule BackendWeb.EquipmentRunningCostController do
  @moduledoc """
  Per-equipment hourly running-cost component CRUD. Each component
  is one line item in the cost stack (electricity, compressed air,
  consumables, maintenance reserve, licence fees, …); the SUM of
  active components lands on ``equipment.hourly_running_cost`` for
  the workstation cost roll-up.

    * `GET    /api/equipment/:equipment_id/running-costs`
    * `POST   /api/equipment/:equipment_id/running-costs`
    * `PATCH  /api/equipment/:equipment_id/running-costs/:id`
    * `DELETE /api/equipment/:equipment_id/running-costs/:id`
       (soft — flips `is_active` to false)

  Auth mirrors EquipmentController — `equipment.view` reads,
  `equipment.act` writes.
  """

  use BackendWeb, :controller

  alias Backend.Equipment
  alias Backend.Equipment.RunningCosts
  alias BackendWeb.Errors
  alias BackendWeb.FallbackController
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "equipment.view" when action in [:index]
  plug RequirePermission,
       "equipment.act"
       when action in [:create, :update, :delete]

  action_fallback FallbackController

  def index(conn, %{"equipment_id" => uuid}) do
    actor = conn.assigns.current_user

    case Equipment.get_for_company(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      unit ->
        rows = RunningCosts.list_for_equipment(unit)

        json(conn, %{
          items: Enum.map(rows, &Payloads.equipment_running_cost_component/1),
          total: length(rows),
          hourly_running_cost:
            unit.hourly_running_cost &&
              Decimal.to_string(unit.hourly_running_cost),
          hourly_running_cost_currency: unit.hourly_running_cost_currency
        })
    end
  end

  def create(conn, %{"equipment_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         {:ok, comp} <-
           RunningCosts.create(unit, Map.drop(params, ["equipment_id"]), actor) do
      conn
      |> put_status(:created)
      |> json(%{component: Payloads.equipment_running_cost_component(comp)})
    else
      nil -> not_found(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def update(conn, %{"equipment_id" => uuid, "id" => cid} = params) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         %Backend.Equipment.RunningCostComponent{} = comp <-
           RunningCosts.get_for_equipment(unit, cid),
         {:ok, updated} <-
           RunningCosts.update(comp, Map.drop(params, ["equipment_id", "id"]), actor) do
      json(conn, %{component: Payloads.equipment_running_cost_component(updated)})
    else
      nil -> not_found(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def delete(conn, %{"equipment_id" => uuid, "id" => cid}) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         %Backend.Equipment.RunningCostComponent{} = comp <-
           RunningCosts.get_for_equipment(unit, cid),
         {:ok, updated} <- RunningCosts.deactivate(comp, actor) do
      json(conn, %{component: Payloads.equipment_running_cost_component(updated)})
    else
      nil -> not_found(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  defp not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", "Component or equipment not found."))
  end

  defp changeset_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{errors: BackendWeb.ChangesetJSON.error(%{changeset: cs})})
  end
end
