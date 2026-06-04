defmodule BackendWeb.StorageCellController do
  @moduledoc """
  Cells of a storage location. Nested under the warehouse + location
  so the controllers stay parallel to the rest of the warehouse
  plan API.

  Routes:
    * `POST   /warehouses/:warehouse_id/storage-locations/:location_id/cells`
    * `PUT    /warehouses/:warehouse_id/storage-locations/:location_id/cells/:id`
    * `DELETE /warehouses/:warehouse_id/storage-locations/:location_id/cells/:id`

  Reads aren't exposed here — cells come along on the parent
  location's payload via `Plans.list_floors` / `Plans.get_floor`,
  same as before, so the UI never needs a separate fetch.

  RBAC: view = `warehouses.view`, mutate = `warehouses.edit`. Same
  contract as locations.
  """

  use BackendWeb, :controller

  alias Backend.Warehouses
  alias Backend.Warehouses.Plans
  alias BackendWeb.{Errors, Payloads, WarehousePlanBroadcast}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "warehouses.view" when action in [:show]
  plug RequirePermission, "warehouses.edit" when action in [:create, :update, :delete]

  action_fallback BackendWeb.FallbackController

  def show(conn, %{
        "warehouse_id" => warehouse_uuid,
        "location_id" => location_uuid,
        "id" => cell_uuid
      }) do
    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid),
         %{} = location <- Plans.get_location(warehouse, location_uuid),
         %{} = cell <- Plans.get_cell(location, cell_uuid) do
      json(conn, %{cell: Payloads.storage_cell(cell)})
    end
  end

  def create(conn, %{
        "warehouse_id" => warehouse_uuid,
        "location_id" => location_uuid
      } = params) do
    actor = conn.assigns.current_user

    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid),
         %{} = location <- Plans.get_location(warehouse, location_uuid) do
      attrs = Map.drop(params, ["warehouse_id", "location_id"])

      case Plans.create_cell(actor, location, attrs) do
        {:ok, cell} ->
          floor_uuid = floor_uuid_for_location(warehouse, location)

          WarehousePlanBroadcast.invalidate(warehouse, floor_uuid,
            actor: actor,
            kind: "cell_added"
          )

          conn
          |> put_status(:created)
          |> json(%{cell: Payloads.storage_cell(cell)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    end
  end

  def update(conn, %{
        "warehouse_id" => warehouse_uuid,
        "location_id" => location_uuid,
        "id" => cell_uuid
      } = params) do
    actor = conn.assigns.current_user

    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid),
         %{} = location <- Plans.get_location(warehouse, location_uuid),
         %{} = cell <- Plans.get_cell(location, cell_uuid) do
      attrs = Map.drop(params, ["warehouse_id", "location_id", "id"])

      case Plans.update_cell(actor, cell, attrs) do
        {:ok, updated} ->
          floor_uuid = floor_uuid_for_location(warehouse, location)

          WarehousePlanBroadcast.invalidate(warehouse, floor_uuid,
            actor: actor,
            kind: "cell_updated"
          )

          json(conn, %{cell: Payloads.storage_cell(updated)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    end
  end

  def delete(conn, %{
        "warehouse_id" => warehouse_uuid,
        "location_id" => location_uuid,
        "id" => cell_uuid
      }) do
    actor = conn.assigns.current_user

    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid),
         %{} = location <- Plans.get_location(warehouse, location_uuid),
         %{} = cell <- Plans.get_cell(location, cell_uuid),
         {:ok, _} <- Plans.delete_cell(actor, cell) do
      floor_uuid = floor_uuid_for_location(warehouse, location)

      WarehousePlanBroadcast.invalidate(warehouse, floor_uuid,
        actor: actor,
        kind: "cell_deleted"
      )

      send_resp(conn, :no_content, "")
    end
  end

  ## ------------------------------------------------------------------

  defp fetch_warehouse(conn, uuid) do
    user = conn.assigns.current_user

    case Warehouses.get_for_company(user.company_id, uuid) do
      nil -> {:error, :not_found}
      warehouse -> warehouse
    end
  end

  defp floor_uuid_for_location(warehouse, location) do
    case Plans.get_floor_by_id(warehouse, location.floor_id) do
      nil -> nil
      floor -> floor.uuid
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
