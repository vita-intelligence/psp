defmodule BackendWeb.UnitOfMeasurementController do
  @moduledoc """
  Company-scoped units-of-measurement registry. Pickers (item form,
  recipe form) read the list; admins manage it at
  `/settings/units-of-measurement`.

  Routes:
    * `GET    /api/units-of-measurement?dimension=mass` — list, optional
      dimension filter for pickers
    * `GET    /api/units-of-measurement/:uuid`
    * `POST   /api/units-of-measurement`
    * `PUT    /api/units-of-measurement/:uuid`
    * `DELETE /api/units-of-measurement/:uuid`

  RBAC: `units.view` for reads, `units.manage` for writes.
  """

  use BackendWeb, :controller

  alias Backend.Units
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "units.view" when action in [:index, :show]
  plug RequirePermission, "units.manage" when action in [:create, :update, :delete]

  action_fallback BackendWeb.FallbackController

  def index(conn, params) do
    actor = conn.assigns.current_user

    if is_binary(params["dimension"]) do
      items =
        Units.list_for_company(actor.company_id,
          dimension: params["dimension"]
        )

      json(conn, %{items: Enum.map(items, &Payloads.unit_of_measurement/1)})
    else
      opts = list_opts_from_params(params)
      {items, next_cursor} = Units.list_page(actor.company_id, opts)

      json(conn, %{
        items: Enum.map(items, &Payloads.unit_of_measurement/1),
        next_cursor: next_cursor
      })
    end
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Units.get_for_company(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      unit -> json(conn, %{unit: Payloads.unit_of_measurement(unit)})
    end
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Units.create(actor, actor.company_id, Map.drop(params, ["id"])) do
      {:ok, unit} ->
        conn
        |> put_status(:created)
        |> json(%{unit: Payloads.unit_of_measurement(unit)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = unit <- Units.get_for_company(actor.company_id, uuid) do
      case Units.update(actor, unit, Map.drop(params, ["id"])) do
        {:ok, updated} ->
          json(conn, %{unit: Payloads.unit_of_measurement(updated)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = unit <- Units.get_for_company(actor.company_id, uuid),
         {:ok, _} <- Units.delete(actor, unit) do
      send_resp(conn, :no_content, "")
    else
      _ -> {:error, :not_found}
    end
  end

  defp list_opts_from_params(params) do
    [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      search: params["search"]
    ]
  end

  defp parse_sort(nil), do: nil
  defp parse_sort(""), do: nil

  defp parse_sort(s) when is_binary(s) do
    case String.split(s, ":", parts: 2) do
      [field, "asc"] -> {String.to_existing_atom(field), :asc}
      [field, "desc"] -> {String.to_existing_atom(field), :desc}
      _ -> nil
    end
  rescue
    ArgumentError -> nil
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
