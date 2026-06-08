defmodule BackendWeb.StorageCellController do
  @moduledoc """
  Cells of a storage location. Nested under the warehouse + location
  so the controllers stay parallel to the rest of the warehouse
  plan API.

  Routes:
    * `POST   /warehouses/:warehouse_id/storage-locations/:storage_location_id/cells`
    * `PUT    /warehouses/:warehouse_id/storage-locations/:storage_location_id/cells/:id`
    * `DELETE /warehouses/:warehouse_id/storage-locations/:storage_location_id/cells/:id`

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

  plug RequirePermission,
       "warehouses.edit" when action in [:create, :update, :delete, :split, :sync_tags]

  action_fallback BackendWeb.FallbackController

  def show(conn, %{
        "warehouse_id" => warehouse_uuid,
        "storage_location_id" => location_uuid,
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
        "storage_location_id" => location_uuid
      } = params) do
    actor = conn.assigns.current_user

    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid),
         %{} = location <- Plans.get_location(warehouse, location_uuid) do
      attrs = Map.drop(params, ["warehouse_id", "storage_location_id"])

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
        "storage_location_id" => location_uuid,
        "id" => cell_uuid
      } = params) do
    actor = conn.assigns.current_user

    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid),
         %{} = location <- Plans.get_location(warehouse, location_uuid),
         %{} = cell <- Plans.get_cell(location, cell_uuid) do
      attrs = Map.drop(params, ["warehouse_id", "storage_location_id", "id"])

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
        "storage_location_id" => location_uuid,
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

  @doc """
  One-shot helper for the rack-setup UX: split a location into N
  levels with the supplied heights (metres). Lets the FE create
  a 3-level rack in one round-trip instead of three sequential
  POSTs racing the realtime broadcast.

  Body shape: `{ "heights_m": [1.5, 1.5] }`.
  """
  def split(conn, %{
        "warehouse_id" => warehouse_uuid,
        "storage_location_id" => location_uuid
      } = params) do
    actor = conn.assigns.current_user

    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid),
         %{} = location <- Plans.get_location(warehouse, location_uuid),
         {:ok, heights} <- parse_heights(params) do
      case Plans.split_cells(actor, location, heights) do
        {:ok, cells} ->
          floor_uuid = floor_uuid_for_location(warehouse, location)

          WarehousePlanBroadcast.invalidate(warehouse, floor_uuid,
            actor: actor,
            kind: "cells_split"
          )

          conn
          |> put_status(:created)
          |> json(%{cells: Enum.map(cells, &Payloads.storage_cell/1)})

        {:error, :no_levels} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(
            Errors.payload(
              "no_levels",
              "Pick at least one level to split the rack into.",
              %{}
            )
          )

        {:error, {:bad_height, value}} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(
            Errors.payload(
              "bad_height",
              "Each level height must be a positive number of metres.",
              %{value: value}
            )
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    end
  end

  defp parse_heights(%{"heights_m" => list}) when is_list(list) do
    if list == [] do
      {:error, :no_levels}
    else
      {:ok, list}
    end
  end

  defp parse_heights(_), do: {:error, :no_levels}

  @doc """
  Overwrite every existing cell's tag set with the parent rack's
  current tags. Fires after the FE's confirm prompt when the
  operator edits rack tags and chooses "yes, push to existing
  levels too".
  """
  def sync_tags(conn, %{
        "warehouse_id" => warehouse_uuid,
        "storage_location_id" => location_uuid
      }) do
    actor = conn.assigns.current_user

    with %{} = warehouse <- fetch_warehouse(conn, warehouse_uuid),
         %{} = location <- Plans.get_location(warehouse, location_uuid),
         {:ok, count} <- Plans.sync_tags_to_cells(actor, location) do
      floor_uuid = floor_uuid_for_location(warehouse, location)

      WarehousePlanBroadcast.invalidate(warehouse, floor_uuid,
        actor: actor,
        kind: "cells_sync_tags"
      )

      json(conn, %{updated: count})
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
