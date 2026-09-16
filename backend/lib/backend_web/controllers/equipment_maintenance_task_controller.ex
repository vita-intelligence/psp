defmodule BackendWeb.EquipmentMaintenanceTaskController do
  @moduledoc """
  Per-equipment preventive-maintenance / calibration task CRUD.

    * `GET  /api/equipment/:equipment_id/maintenance-tasks`
    * `POST /api/equipment/:equipment_id/maintenance-tasks`
    * `PATCH /api/equipment/:equipment_id/maintenance-tasks/:uuid`
    * `POST /api/equipment/:equipment_id/maintenance-tasks/:uuid/complete`
    * `DELETE /api/equipment/:equipment_id/maintenance-tasks/:uuid`
       (soft-delete — flips `is_active` to false, keeps the row)

  Auth mirrors EquipmentController — `equipment.view` reads,
  `equipment.act` writes. Completion is `equipment.act` too.
  """

  use BackendWeb, :controller

  alias Backend.Equipment
  alias Backend.Equipment.MaintenanceTasks
  alias BackendWeb.Errors
  alias BackendWeb.FallbackController
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "equipment.view" when action in [:index]
  plug RequirePermission, "equipment.act" when action in [:create, :update, :delete, :complete]

  action_fallback FallbackController

  def index(conn, %{"equipment_id" => uuid}) do
    actor = conn.assigns.current_user

    case Equipment.get_for_company(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      unit ->
        tasks = MaintenanceTasks.list_for_equipment(unit)

        json(conn, %{
          items: Enum.map(tasks, &Payloads.equipment_maintenance_task/1),
          total: length(tasks)
        })
    end
  end

  def create(conn, %{"equipment_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         {:ok, task} <-
           MaintenanceTasks.create(unit, Map.drop(params, ["equipment_id"]), actor) do
      conn
      |> put_status(:created)
      |> json(%{task: Payloads.equipment_maintenance_task(task)})
    else
      nil -> not_found(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def update(conn, %{"equipment_id" => uuid, "id" => task_uuid} = params) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         %Backend.Equipment.MaintenanceTask{} = task <-
           MaintenanceTasks.get_for_equipment(unit, task_uuid),
         {:ok, updated} <-
           MaintenanceTasks.update(task, Map.drop(params, ["equipment_id", "id"]), actor) do
      json(conn, %{task: Payloads.equipment_maintenance_task(updated)})
    else
      nil -> not_found(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def delete(conn, %{"equipment_id" => uuid, "id" => task_uuid}) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         %Backend.Equipment.MaintenanceTask{} = task <-
           MaintenanceTasks.get_for_equipment(unit, task_uuid),
         {:ok, updated} <- MaintenanceTasks.deactivate(task, actor) do
      json(conn, %{task: Payloads.equipment_maintenance_task(updated)})
    else
      nil -> not_found(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def complete(conn, %{"equipment_id" => uuid, "id" => task_uuid} = params) do
    actor = conn.assigns.current_user

    completion_date =
      case params["completed_on"] do
        d when is_binary(d) and d != "" ->
          case Date.from_iso8601(d) do
            {:ok, date} -> date
            _ -> Date.utc_today()
          end
        _ ->
          Date.utc_today()
      end

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         %Backend.Equipment.MaintenanceTask{} = task <-
           MaintenanceTasks.get_for_equipment(unit, task_uuid),
         {:ok, updated} <-
           MaintenanceTasks.complete(task, actor,
             completed_on: completion_date,
             reason: params["reason"] || "",
             evidence_urls: params["evidence_urls"] || []
           ) do
      json(conn, %{task: Payloads.equipment_maintenance_task(updated)})
    else
      nil ->
        not_found(conn)

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      {:error, {:illegal_transition, info}} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "illegal_transition",
            "Equipment is in status `#{info.from}` — can't record this completion.",
            info
          )
        )

      {:error, :certificate_required} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "certificate_required",
            "This task requires a certificate on completion. Upload the calibration / service evidence via the Files section, then include the file URL(s) in `evidence_urls`."
          )
        )

      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(Errors.payload("complete_failed", inspect(reason)))
    end
  end

  # ── helpers ──────────────────────────────────────────────────────

  defp not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", "Task or equipment not found."))
  end

  defp changeset_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{errors: BackendWeb.ChangesetJSON.error(%{changeset: cs})})
  end

  defp unprocessable(conn, code, message) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, message))
  end
end
