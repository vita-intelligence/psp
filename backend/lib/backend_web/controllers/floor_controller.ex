defmodule BackendWeb.FloorController do
  @moduledoc """
  Nested under `/api/warehouses/:warehouse_id/floors`. Each floor
  belongs to one warehouse; the parent warehouse is resolved from the
  URL on every request and used to scope the lookup.

  RBAC:
    * `:index` / `:show`  → `warehouses.view`
    * `:create`           → `warehouses.edit` (creating a new floor
                             is part of editing the warehouse plan)
    * `:update`           → `warehouses.edit`
    * `:delete`           → `warehouses.edit`
  """

  use BackendWeb, :controller

  alias Backend.Warehouses
  alias Backend.Warehouses.Plans
  alias BackendWeb.{Errors, Payloads, WarehousePlanBroadcast}
  alias BackendWeb.Plugs.RequireWarehouseKindPermission

  plug RequireWarehouseKindPermission,
       [warehouse: "warehouses.view", production_facility: "production.facility_view"]
       when action in [:index, :show]

  plug RequireWarehouseKindPermission,
       [warehouse: "warehouses.edit", production_facility: "production.facility_edit"]
       when action in [:create, :update, :delete]

  action_fallback BackendWeb.FallbackController

  def index(conn, %{"warehouse_id" => warehouse_uuid}) do
    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid) do
      json(conn, %{
        items: warehouse |> Plans.list_floors() |> Enum.map(&Payloads.floor/1)
      })
    end
  end

  def show(conn, %{"warehouse_id" => warehouse_uuid, "id" => floor_uuid}) do
    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid),
         %{} = floor <- Plans.get_floor(warehouse, floor_uuid) do
      json(conn, %{floor: Payloads.floor(floor)})
    end
  end

  def create(conn, %{"warehouse_id" => warehouse_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid) do
      case Plans.create_floor(actor, warehouse, Map.drop(params, ["warehouse_id"])) do
        {:ok, floor} ->
          WarehousePlanBroadcast.invalidate(warehouse, floor.uuid,
            actor: actor,
            kind: "floor_added"
          )

          conn
          |> put_status(:created)
          |> json(%{floor: Payloads.floor(floor)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    end
  end

  def update(conn, %{"warehouse_id" => warehouse_uuid, "id" => floor_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid),
         %{} = floor <- Plans.get_floor(warehouse, floor_uuid) do
      case Plans.update_floor(actor, floor, Map.drop(params, ["warehouse_id", "id"])) do
        {:ok, updated} ->
          WarehousePlanBroadcast.invalidate(warehouse, updated.uuid,
            actor: actor,
            kind: "floor_saved"
          )

          json(conn, %{floor: Payloads.floor(updated)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    end
  end

  def delete(conn, %{"warehouse_id" => warehouse_uuid, "id" => floor_uuid}) do
    actor = conn.assigns.current_user

    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid),
         %{} = floor <- Plans.get_floor(warehouse, floor_uuid),
         {:ok, _} <- Plans.delete_floor(actor, floor) do
      WarehousePlanBroadcast.invalidate(warehouse, floor.uuid,
        actor: actor,
        kind: "floor_deleted"
      )

      send_resp(conn, :no_content, "")
    end
  end

  ## ------------------------------------------------------------------

  defp fetch_warehouse(conn, uuid) do
    user = conn.assigns.current_user

    case Warehouses.get_for_company(user.company_id, uuid) do
      nil ->
        {:error, :not_found}

      warehouse ->
        warehouse
    end
  end

  defp changeset_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(
      Errors.payload(
        "validation_failed",
        "Please correct the highlighted fields.",
        Errors.changeset_fields(cs)
      )
    )
  end
end
