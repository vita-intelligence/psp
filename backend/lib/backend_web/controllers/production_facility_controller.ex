defmodule BackendWeb.ProductionFacilityController do
  @moduledoc """
  Production-facility CRUD. Sibling of `WarehouseController` — both
  surfaces back the same underlying `warehouses` table, distinguished
  by the `kind` discriminator.

    * `:index`, `:show` → `production.facility_view`
    * `:create`         → `production.facility_create`
    * `:update`         → `production.facility_edit`
    * `:delete`         → `production.facility_delete`

  Forces `kind = "production_facility"` on every create + scopes every
  list / show / update / delete to that kind so the surfaces are
  truly separated end-to-end; a caller on this endpoint can never see
  or touch a warehouse-kind row.
  """

  use BackendWeb, :controller

  alias Backend.Warehouses
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "production.facility_view" when action in [:index, :show]
  plug RequirePermission, "production.facility_create" when action in [:create]
  plug RequirePermission, "production.facility_edit" when action in [:update]
  plug RequirePermission, "production.facility_delete" when action in [:delete]

  action_fallback BackendWeb.FallbackController

  def index(conn, params) do
    user = conn.assigns.current_user
    opts = Keyword.put(list_opts_from_params(params), :kind, "production_facility")

    {items, next_cursor} = Warehouses.list_for_company(user.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.warehouse/1),
      next_cursor: next_cursor
    })
  end

  def show(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    case Warehouses.get_for_company_kind(user.company_id, id, "production_facility") do
      nil -> {:error, :not_found}
      facility -> json(conn, %{warehouse: Payloads.warehouse(facility)})
    end
  end

  def create(conn, params) do
    user = conn.assigns.current_user
    attrs = Map.put(params, "kind", "production_facility")

    case Warehouses.create(user, user.company_id, attrs) do
      {:ok, facility} ->
        conn
        |> put_status(:created)
        |> json(%{warehouse: Payloads.warehouse(facility)})

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

    case Warehouses.get_for_company_kind(user.company_id, id, "production_facility") do
      nil ->
        {:error, :not_found}

      facility ->
        # `kind` is immutable post-create; strip from the payload so a
        # craftier client can't try to flip the discriminator.
        attrs = params |> Map.delete("id") |> Map.delete("kind")

        case Warehouses.update(user, facility, attrs) do
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

    case Warehouses.get_for_company_kind(user.company_id, id, "production_facility") do
      nil ->
        {:error, :not_found}

      facility ->
        {:ok, _} = Warehouses.delete(user, facility)
        send_resp(conn, :no_content, "")
    end
  end

  # ----- helpers ----------------------------------------------------

  defp list_opts_from_params(params) do
    [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      filters: parse_filters(params["filter"]),
      search: params["search"]
    ]
  end

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

  defp parse_filters(nil), do: %{}
  defp parse_filters(map) when is_map(map), do: map
  defp parse_filters(_), do: %{}
end
