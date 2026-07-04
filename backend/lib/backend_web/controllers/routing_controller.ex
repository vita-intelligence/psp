defmodule BackendWeb.RoutingController do
  @moduledoc """
  Routings CRUD. Wholesale-replace on save: the FE PATCHes the full
  step list (with per-step `default_worker_ids`), the context layer
  wipes + reinserts inside a single transaction. Permission family
  is `production.routing_*`.
  """

  use BackendWeb, :controller

  alias Backend.Production
  alias Backend.Production.Routing
  alias BackendWeb.Errors
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  action_fallback BackendWeb.FallbackController

  plug RequirePermission, "production.routing_view" when action in [:index, :show]
  plug RequirePermission, "production.routing_create" when action in [:create]
  plug RequirePermission, "production.routing_edit" when action in [:update]
  plug RequirePermission, "production.routing_delete" when action in [:delete]

  # GET /api/production/routings
  def index(conn, params) do
    actor = conn.assigns.current_user

    opts =
      [
        cursor: params["cursor"],
        limit: params["limit"],
        sort: parse_sort(params["sort"]),
        search: params["search"],
        column_filter: params["column_filter"],
        item_id: params["item_id"],
        bom_id: params["bom_id"],
        is_active: params["is_active"]
      ]
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)

    {items, next_cursor} = Production.list_routings_page(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.routing_summary/1),
      next_cursor: next_cursor
    })
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_routing(actor.company_id, uuid) do
      nil -> not_found(conn)
      %Routing{} = r -> json(conn, %{routing: Payloads.routing(r)})
    end
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Production.create_routing(actor, params) do
      {:ok, %Routing{} = r} ->
        conn
        |> put_status(:created)
        |> json(%{routing: Payloads.routing(r)})

      {:error, :item_required} ->
        unprocessable(conn, "item_required", "Pick an output item.")

      {:error, :item_not_found} ->
        not_found(conn)

      {:error, :item_not_in_company} ->
        forbidden(conn, "Item belongs to a different company.")

      {:error, :bom_not_allowed_for_item_type} ->
        unprocessable(
          conn,
          "bom_not_allowed_for_item_type",
          "Routings can only target finished or semi-finished items."
        )

      {:error, :bom_not_found} ->
        unprocessable(conn, "bom_not_found", "Connected BOM doesn't exist.")

      {:error, :bom_item_mismatch} ->
        unprocessable(
          conn,
          "bom_item_mismatch",
          "Connected BOM is for a different item — pick a BOM that builds the same product."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      {:error, {:step_failed, idx, cs}} ->
        changeset_error(conn, cs, %{step_index: idx})
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    case Production.get_routing(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %Routing{} = r ->
        case Production.update_routing(actor, r, params) do
          {:ok, updated} -> json(conn, %{routing: Payloads.routing(updated)})

          {:error, :bom_not_found} ->
            unprocessable(conn, "bom_not_found", "Connected BOM doesn't exist.")

          {:error, :bom_item_mismatch} ->
            unprocessable(
              conn,
              "bom_item_mismatch",
              "Connected BOM is for a different item."
            )

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)

          {:error, {:step_failed, idx, cs}} ->
            changeset_error(conn, cs, %{step_index: idx})
        end
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_routing(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %Routing{} = r ->
        case Production.delete_routing(actor, r) do
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
    |> json(Errors.payload("not_found", "Routing not found.", %{}))
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail, %{}))
  end

  defp forbidden(conn, detail) do
    conn
    |> put_status(:forbidden)
    |> json(Errors.payload("forbidden", detail, %{}))
  end

  defp changeset_error(conn, cs, extras \\ %{}) do
    payload =
      Errors.payload(
        "validation_failed",
        "One or more fields failed validation.",
        Errors.changeset_fields(cs)
      )
      |> Map.merge(extras)

    conn
    |> put_status(:unprocessable_entity)
    |> json(payload)
  end
end
