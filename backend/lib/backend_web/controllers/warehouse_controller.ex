defmodule BackendWeb.WarehouseController do
  @moduledoc """
  Warehouse CRUD. Permission-gated:

    * `:index`, `:show`    → `warehouses.view`
    * `:create`            → `warehouses.create`
    * `:update`            → `warehouses.edit`
    * `:delete`            → `warehouses.delete`
  """

  use BackendWeb, :controller

  alias Backend.Warehouses
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "warehouses.view" when action in [:index, :show]
  plug RequirePermission, "warehouses.create" when action in [:create]
  plug RequirePermission, "warehouses.edit" when action in [:update]
  plug RequirePermission, "warehouses.delete" when action in [:delete]

  action_fallback BackendWeb.FallbackController

  def index(conn, _params) do
    user = conn.assigns.current_user
    warehouses = Warehouses.list_for_company(user.company_id)
    json(conn, %{warehouses: Enum.map(warehouses, &Payloads.warehouse/1)})
  end

  def show(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    case Warehouses.get_for_company(user.company_id, id) do
      nil -> {:error, :not_found}
      warehouse -> json(conn, %{warehouse: Payloads.warehouse(warehouse)})
    end
  end

  def create(conn, params) do
    user = conn.assigns.current_user

    case Warehouses.create(user.company_id, params) do
      {:ok, warehouse} ->
        conn
        |> put_status(:created)
        |> json(%{warehouse: Payloads.warehouse(warehouse)})

      {:error, %Ecto.Changeset{} = cs} ->
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

  def update(conn, %{"id" => id} = params) do
    user = conn.assigns.current_user

    case Warehouses.get_for_company(user.company_id, id) do
      nil ->
        {:error, :not_found}

      warehouse ->
        case Warehouses.update(warehouse, Map.delete(params, "id")) do
          {:ok, updated} ->
            json(conn, %{warehouse: Payloads.warehouse(updated)})

          {:error, %Ecto.Changeset{} = cs} ->
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
  end

  def delete(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    case Warehouses.get_for_company(user.company_id, id) do
      nil ->
        {:error, :not_found}

      warehouse ->
        {:ok, _} = Warehouses.delete(warehouse)
        send_resp(conn, :no_content, "")
    end
  end
end
