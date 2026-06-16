defmodule BackendWeb.WorkstationController do
  @moduledoc """
  Workstations CRUD. Permission-gated by the
  `production.workstation_*` family.

  Default workers (M2M) are sent on the `default_worker_ids` key of
  the create/update payload; the context layer replaces the set
  wholesale inside the same transaction as the row write.
  """

  use BackendWeb, :controller

  alias Backend.Production
  alias Backend.Production.Workstation
  alias BackendWeb.Errors
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  action_fallback BackendWeb.FallbackController

  plug RequirePermission, "production.workstation_view" when action in [:index, :show]
  plug RequirePermission, "production.workstation_create" when action in [:create]
  plug RequirePermission, "production.workstation_edit" when action in [:update]
  plug RequirePermission, "production.workstation_delete" when action in [:delete]

  # GET /api/production/workstations
  def index(conn, params) do
    actor = conn.assigns.current_user

    opts =
      [
        cursor: params["cursor"],
        limit: params["limit"],
        sort: parse_sort(params["sort"]),
        search: params["search"],
        workstation_group_id: params["workstation_group_id"],
        warehouse_id: params["warehouse_id"],
        is_active: params["is_active"]
      ]
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)

    {items, next_cursor} = Production.list_workstations_page(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.workstation_summary/1),
      next_cursor: next_cursor
    })
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_workstation(actor.company_id, uuid) do
      nil -> not_found(conn)
      %Workstation{} = ws -> json(conn, %{workstation: Payloads.workstation(ws)})
    end
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Production.create_workstation(actor, params) do
      {:ok, ws} ->
        conn
        |> put_status(:created)
        |> json(%{workstation: Payloads.workstation(ws)})

      {:error, :warehouse_required} ->
        unprocessable(conn, "warehouse_required", "Pick a production site.")

      {:error, :workstation_group_required} ->
        unprocessable(conn, "workstation_group_required", "Pick a workstation group (Type).")

      {:error, :site_must_be_production_facility} ->
        unprocessable(
          conn,
          "site_must_be_production_facility",
          "Workstations live on production sites — warehouse-kind storage doesn't host them."
        )

      {:error, :warehouse_not_found} ->
        unprocessable(conn, "warehouse_not_found", "Selected site doesn't exist.")

      {:error, :workstation_group_not_found} ->
        unprocessable(
          conn,
          "workstation_group_not_found",
          "Selected workstation group doesn't exist."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    case Production.get_workstation(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %Workstation{} = ws ->
        case Production.update_workstation(actor, ws, params) do
          {:ok, updated} ->
            json(conn, %{workstation: Payloads.workstation(updated)})

          {:error, :site_must_be_production_facility} ->
            unprocessable(
              conn,
              "site_must_be_production_facility",
              "Workstations live on production sites only."
            )

          {:error, :warehouse_not_found} ->
            unprocessable(conn, "warehouse_not_found", "Selected site doesn't exist.")

          {:error, :workstation_group_not_found} ->
            unprocessable(
              conn,
              "workstation_group_not_found",
              "Selected workstation group doesn't exist."
            )

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)
        end
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_workstation(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %Workstation{} = ws ->
        case Production.delete_workstation(actor, ws) do
          {:ok, _} -> send_resp(conn, :no_content, "")
          {:error, cs} -> changeset_error(conn, cs)
        end
    end
  end

  # ----- helpers ---------------------------------------------------

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

  defp not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", "Workstation not found.", %{}))
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail, %{}))
  end

  defp changeset_error(conn, cs) do
    payload =
      Errors.payload(
        "validation_failed",
        "One or more fields failed validation.",
        Errors.changeset_fields(cs)
      )

    conn
    |> put_status(:unprocessable_entity)
    |> json(payload)
  end
end
