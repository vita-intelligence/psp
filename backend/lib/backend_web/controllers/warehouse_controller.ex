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

  def index(conn, params) do
    user = conn.assigns.current_user
    opts = list_opts_from_params(params)

    {items, next_cursor} = Warehouses.list_for_company(user.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.warehouse/1),
      next_cursor: next_cursor
    })
  end

  ## ------------------------------------------------------------------

  defp list_opts_from_params(params) do
    [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      filters: parse_filters(params["filter"]),
      search: params["search"]
    ]
  end

  # `?sort=field:asc` or `?sort=field` (defaults to asc). Returns `nil`
  # when the param is missing — the context layer will fall back to its
  # default sort.
  defp parse_sort(nil), do: nil
  defp parse_sort(""), do: nil

  defp parse_sort(spec) when is_binary(spec) do
    case String.split(spec, ":", parts: 2) do
      [field] -> {field, :asc}
      [field, "desc"] -> {field, :desc}
      [field, _] -> {field, :asc}
    end
  end

  defp parse_sort(_), do: nil

  # Phoenix parses `?filter[k]=v` as `%{"filter" => %{"k" => "v"}}`.
  defp parse_filters(nil), do: %{}
  defp parse_filters(map) when is_map(map), do: map
  defp parse_filters(_), do: %{}

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
