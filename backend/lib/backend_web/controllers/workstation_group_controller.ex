defmodule BackendWeb.WorkstationGroupController do
  @moduledoc """
  Workstation groups — clusters of identical workstations. CRUD with
  permission gates from the `production.workstation_group_*` family.
  """

  use BackendWeb, :controller

  alias Backend.Production
  alias Backend.Production.WorkstationGroup
  alias BackendWeb.Errors
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  action_fallback BackendWeb.FallbackController

  plug RequirePermission, "production.workstation_group_view" when action in [:index, :show]
  plug RequirePermission, "production.workstation_group_create" when action in [:create]
  plug RequirePermission, "production.workstation_group_edit" when action in [:update]
  plug RequirePermission, "production.workstation_group_delete" when action in [:delete]

  # GET /api/production/workstation-groups
  def index(conn, params) do
    actor = conn.assigns.current_user

    opts =
      [
        cursor: params["cursor"],
        limit: params["limit"],
        sort: parse_sort(params["sort"]),
        search: params["search"],
        column_filter: params["column_filter"],
        kind: params["kind"],
        is_active: params["is_active"]
      ]
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)

    {items, next_cursor} = Production.list_workstation_groups_page(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.workstation_group_summary/1),
      next_cursor: next_cursor
    })
  end

  # GET /api/production/workstation-groups/:id
  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_workstation_group(actor.company_id, uuid) do
      nil -> not_found(conn)
      %WorkstationGroup{} = group -> json(conn, %{group: Payloads.workstation_group(group)})
    end
  end

  # POST /api/production/workstation-groups
  def create(conn, params) do
    actor = conn.assigns.current_user

    case Production.create_workstation_group(actor, params) do
      {:ok, %WorkstationGroup{} = group} ->
        conn
        |> put_status(:created)
        |> json(%{group: Payloads.workstation_group(group)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  # PATCH /api/production/workstation-groups/:id
  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    case Production.get_workstation_group(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %WorkstationGroup{} = group ->
        case Production.update_workstation_group(actor, group, params) do
          {:ok, updated} -> json(conn, %{group: Payloads.workstation_group(updated)})
          {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
        end
    end
  end

  # DELETE /api/production/workstation-groups/:id
  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_workstation_group(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %WorkstationGroup{} = group ->
        case Production.delete_workstation_group(actor, group) do
          {:ok, _} -> send_resp(conn, :no_content, "")
          {:error, cs} -> changeset_error(conn, cs)
        end
    end
  end

  # ----- helpers --------------------------------------------------

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
    |> json(Errors.payload("not_found", "Workstation group not found.", %{}))
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
