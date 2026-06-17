defmodule BackendWeb.ManufacturingOrderController do
  @moduledoc """
  Manufacturing orders CRUD + status transitions.

  Permission gates:
    * `:index`, `:show`        → `production.mo_view`
    * `:create`                → `production.mo_create`
    * `:update`                → `production.mo_edit`
    * `:delete`                → `production.mo_delete`
    * `:transition` to approved   → `production.mo_approve`
    * `:transition` other states  → `production.mo_execute`

  Transitions live on `/api/production/manufacturing-orders/:id/transition`
  with a `{to: "approved" | ...}` body. The context layer enforces
  the allowed state-pair table.
  """

  use BackendWeb, :controller

  alias Backend.Production
  alias Backend.Production.ManufacturingOrder
  alias Backend.RBAC
  alias BackendWeb.Errors
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  action_fallback BackendWeb.FallbackController

  plug RequirePermission, "production.mo_view" when action in [:index, :show]
  plug RequirePermission, "production.mo_create" when action in [:create]
  plug RequirePermission, "production.mo_edit" when action in [:update]
  plug RequirePermission, "production.mo_delete" when action in [:delete]

  def index(conn, params) do
    actor = conn.assigns.current_user

    opts =
      [
        cursor: params["cursor"],
        limit: params["limit"],
        sort: parse_sort(params["sort"]),
        search: params["search"],
        status: params["status"],
        item_id: params["item_id"],
        warehouse_id: params["warehouse_id"]
      ]
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)

    {items, next_cursor} =
      Production.list_manufacturing_orders_page(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.manufacturing_order_summary/1),
      next_cursor: next_cursor
    })
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil -> not_found(conn)
      %ManufacturingOrder{} = mo -> json(conn, %{mo: Payloads.manufacturing_order(mo)})
    end
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Production.create_manufacturing_order(actor, params) do
      {:ok, mo} ->
        conn
        |> put_status(:created)
        |> json(%{mo: Payloads.manufacturing_order(mo)})

      {:error, code} when is_atom(code) ->
        creation_error(conn, code)

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        case Production.update_manufacturing_order(actor, mo, params) do
          {:ok, updated} ->
            json(conn, %{mo: Payloads.manufacturing_order(updated)})

          {:error, code} when is_atom(code) ->
            creation_error(conn, code)

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)
        end
    end
  end

  # POST /api/production/manufacturing-orders/:id/transition
  def transition(conn, %{"id" => uuid, "to" => to}) when is_binary(to) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        case Map.fetch(Production.mo_transitions(), {mo.status, to}) do
          :error ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(
              Errors.payload(
                "invalid_transition",
                "Can't move from #{mo.status} to #{to}.",
                %{from: mo.status, to: to}
              )
            )

          {:ok, perm} ->
            if RBAC.has_permission?(actor, perm) do
              case Production.transition_mo(actor, mo, to) do
                {:ok, updated} ->
                  json(conn, %{mo: Payloads.manufacturing_order(updated)})

                {:error, :invalid_transition, current} ->
                  conn
                  |> put_status(:unprocessable_entity)
                  |> json(
                    Errors.payload(
                      "invalid_transition",
                      "MO is in #{current}; can't move to #{to}.",
                      %{from: current, to: to}
                    )
                  )

                {:error, :children_not_complete} ->
                  conn
                  |> put_status(:unprocessable_entity)
                  |> json(
                    Errors.payload(
                      "children_not_complete",
                      "Finish or cancel every sub-production MO before starting this one.",
                      %{}
                    )
                  )

                {:error, %Ecto.Changeset{} = cs} ->
                  changeset_error(conn, cs)
              end
            else
              forbidden(conn, "Missing #{perm} permission for this transition.")
            end
        end
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        case Production.delete_manufacturing_order(actor, mo) do
          {:ok, _} -> send_resp(conn, :no_content, "")
          {:error, cs} -> changeset_error(conn, cs)
        end
    end
  end

  # ----- helpers ---------------------------------------------------

  defp creation_error(conn, code) do
    case code do
      :warehouse_required ->
        unprocessable(conn, "warehouse_required", "Pick a production site.")

      :warehouse_not_found ->
        unprocessable(conn, "warehouse_not_found", "Site doesn't exist.")

      :site_must_be_production_facility ->
        unprocessable(
          conn,
          "site_must_be_production_facility",
          "MOs run on production sites, not warehouse-kind storage."
        )

      :bom_required ->
        unprocessable(conn, "bom_required", "Pick a Bill of Materials.")

      :bom_not_found ->
        unprocessable(conn, "bom_not_found", "Selected BOM doesn't exist.")

      :bom_item_mismatch ->
        unprocessable(
          conn,
          "bom_item_mismatch",
          "BOM builds a different item — pick a BOM for the same product."
        )

      other ->
        unprocessable(conn, to_string(other), "Validation failed: #{other}")
    end
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

  defp not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", "Manufacturing order not found.", %{}))
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
