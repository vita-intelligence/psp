defmodule BackendWeb.EquipmentRepairController do
  @moduledoc """
  Equipment repair (reactive breakdown) records + spare-parts lines.

    * `GET  /api/equipment/:equipment_id/repairs`
    * `POST /api/equipment/:equipment_id/repairs`                     — report breakdown
    * `GET  /api/equipment/:equipment_id/repairs/:uuid`
    * `PATCH /api/equipment/:equipment_id/repairs/:uuid`
    * `POST /api/equipment/:equipment_id/repairs/:uuid/complete`
    * `POST /api/equipment/:equipment_id/repairs/:uuid/parts`         — add a part
    * `DELETE /api/equipment/:equipment_id/repairs/:uuid/parts/:part_uuid`
  """

  use BackendWeb, :controller

  alias Backend.Equipment
  alias Backend.Equipment.Repairs
  alias BackendWeb.Errors
  alias BackendWeb.FallbackController
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "equipment.view" when action in [:index, :show]
  plug RequirePermission,
       "equipment.act"
       when action in [:create, :update, :complete, :add_part, :remove_part]

  action_fallback FallbackController

  def index(conn, %{"equipment_id" => uuid}) do
    actor = conn.assigns.current_user

    case Equipment.get_for_company(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      unit ->
        rows = Repairs.list_for_equipment(unit)

        json(conn, %{
          items: Enum.map(rows, &Payloads.equipment_repair/1),
          total: length(rows)
        })
    end
  end

  def show(conn, %{"equipment_id" => uuid, "id" => repair_uuid}) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         %Backend.Equipment.Repair{} = repair <-
           Repairs.get_for_equipment(unit, repair_uuid) do
      json(conn, %{repair: Payloads.equipment_repair(repair)})
    else
      nil -> not_found(conn)
    end
  end

  def create(conn, %{"equipment_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         {:ok, repair} <-
           Repairs.report(unit, Map.drop(params, ["equipment_id"]), actor) do
      conn
      |> put_status(:created)
      |> json(%{repair: Payloads.equipment_repair(repair)})
    else
      nil -> not_found(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      {:error, reason} -> unprocessable(conn, "report_failed", inspect(reason))
    end
  end

  def update(conn, %{"equipment_id" => uuid, "id" => repair_uuid} = params) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         %Backend.Equipment.Repair{} = repair <-
           Repairs.get_for_equipment(unit, repair_uuid),
         {:ok, updated} <-
           Repairs.update(repair, Map.drop(params, ["equipment_id", "id"]), actor) do
      json(conn, %{repair: Payloads.equipment_repair(updated)})
    else
      nil -> not_found(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def complete(conn, %{"equipment_id" => uuid, "id" => repair_uuid} = params) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         %Backend.Equipment.Repair{} = repair <-
           Repairs.get_for_equipment(unit, repair_uuid),
         {:ok, updated} <-
           Repairs.complete(repair, Map.drop(params, ["equipment_id", "id"]), actor) do
      json(conn, %{repair: Payloads.equipment_repair(updated)})
    else
      nil -> not_found(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      {:error, reason} -> unprocessable(conn, "complete_failed", inspect(reason))
    end
  end

  def add_part(conn, %{"equipment_id" => uuid, "id" => repair_uuid} = params) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         %Backend.Equipment.Repair{} = repair <-
           Repairs.get_for_equipment(unit, repair_uuid),
         {:ok, part} <-
           Repairs.add_part(repair, Map.drop(params, ["equipment_id", "id"]), actor) do
      conn
      |> put_status(:created)
      |> json(%{part: Payloads.equipment_repair_part(part)})
    else
      nil -> not_found(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def remove_part(conn, %{"equipment_id" => uuid, "id" => repair_uuid, "part_id" => part_uuid}) do
    actor = conn.assigns.current_user
    _ = actor

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         %Backend.Equipment.Repair{} = repair <-
           Repairs.get_for_equipment(unit, repair_uuid),
         %Backend.Equipment.RepairPart{} = part <-
           Repairs.get_part(repair, part_uuid),
         {:ok, _} <- Repairs.remove_part(part) do
      send_resp(conn, :no_content, "")
    else
      nil -> not_found(conn)
      {:error, reason} -> unprocessable(conn, "delete_failed", inspect(reason))
    end
  end

  # ── helpers ──────────────────────────────────────────────────────

  defp not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", "Repair or equipment not found."))
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
