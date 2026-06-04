defmodule BackendWeb.StorageLocationController do
  @moduledoc """
  Storage location CRUD, nested under the warehouse for URL scoping
  but accepting `floor_uuid` in the body (or path on create) since a
  location can be moved between floors on update.

  Routes:
    * `POST   /warehouses/:warehouse_id/storage-locations` (body must
       carry `floor_uuid` so we know which floor to attach to)
    * `PUT    /warehouses/:warehouse_id/storage-locations/:id`
    * `DELETE /warehouses/:warehouse_id/storage-locations/:id`

  RBAC mirrors floors — view = `warehouses.view`, mutate =
  `warehouses.edit`.
  """

  use BackendWeb, :controller

  alias Backend.Warehouses
  alias Backend.Warehouses.Plans
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "warehouses.view" when action in [:show]
  plug RequirePermission, "warehouses.edit" when action in [:create, :update, :delete]

  action_fallback BackendWeb.FallbackController

  def show(conn, %{"warehouse_id" => warehouse_uuid, "id" => location_uuid}) do
    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid),
         %{} = location <- Plans.get_location(warehouse, location_uuid) do
      json(conn, %{storage_location: Payloads.storage_location(location)})
    end
  end

  def create(conn, %{"warehouse_id" => warehouse_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid),
         floor_uuid when is_binary(floor_uuid) <- params["floor_uuid"],
         %{} = floor <- Plans.get_floor(warehouse, floor_uuid) do
      attrs = Map.drop(params, ["warehouse_id", "floor_uuid"])

      case Plans.create_location(actor, floor, attrs) do
        {:ok, location} ->
          conn
          |> put_status(:created)
          |> json(%{storage_location: Payloads.storage_location(location)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      nil ->
        {:error, :not_found}

      _missing_floor_uuid ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "floor_uuid_required",
            "Specify which floor the location belongs to.",
            %{floor_uuid: ["Required."]}
          )
        )
    end
  end

  def update(conn, %{"warehouse_id" => warehouse_uuid, "id" => location_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid),
         %{} = location <- Plans.get_location(warehouse, location_uuid),
         {:ok, attrs} <- resolve_floor_id(warehouse, params, location.floor_id) do
      case Plans.update_location(actor, location, attrs) do
        {:ok, updated} ->
          json(conn, %{storage_location: Payloads.storage_location(updated)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      nil ->
        {:error, :not_found}

      {:error, :unknown_floor} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "unknown_floor",
            "Couldn't find the target floor for this location.",
            %{floor_uuid: ["Unknown."]}
          )
        )
    end
  end

  def delete(conn, %{"warehouse_id" => warehouse_uuid, "id" => location_uuid}) do
    actor = conn.assigns.current_user

    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid),
         %{} = location <- Plans.get_location(warehouse, location_uuid),
         {:ok, _} <- Plans.delete_location(actor, location) do
      send_resp(conn, :no_content, "")
    end
  end

  ## ------------------------------------------------------------------

  defp fetch_warehouse(conn, uuid) do
    user = conn.assigns.current_user

    case Warehouses.get_for_company(user.company_id, uuid) do
      nil -> nil
      warehouse -> warehouse
    end
  end

  # Moving a location between floors is allowed — the request body
  # may carry `floor_uuid`. Convert that to the integer FK, dropping
  # the uuid key. When absent, keep the current floor.
  defp resolve_floor_id(warehouse, params, current_floor_id) do
    case params["floor_uuid"] do
      nil ->
        {:ok, Map.drop(params, ["warehouse_id", "id"])}

      floor_uuid when is_binary(floor_uuid) ->
        case Plans.get_floor(warehouse, floor_uuid) do
          nil ->
            {:error, :unknown_floor}

          floor ->
            attrs =
              params
              |> Map.drop(["warehouse_id", "id", "floor_uuid"])
              |> Map.put("floor_id", floor.id)

            {:ok, attrs}
        end

      _ ->
        # Bad shape — fall back to leaving the floor alone.
        {:ok,
         params
         |> Map.drop(["warehouse_id", "id", "floor_uuid"])
         |> Map.put("floor_id", current_floor_id)}
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
