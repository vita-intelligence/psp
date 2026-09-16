defmodule BackendWeb.EquipmentCategoryController do
  @moduledoc """
  Equipment category CRUD.

    * `GET  /api/equipment-categories`
    * `POST /api/equipment-categories`
    * `PATCH /api/equipment-categories/:id`
    * `DELETE /api/equipment-categories/:id`   (soft — flips is_active)
  """

  use BackendWeb, :controller

  alias Backend.Equipment.Categories
  alias BackendWeb.Errors
  alias BackendWeb.FallbackController
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "equipment.view" when action in [:index]

  # Category management is a settings-tier action — gate on the same
  # ``equipment.act`` permission the maintenance / repair mutators
  # use. If we later want a distinct ``equipment.settings`` grant,
  # swap this plug and add the perm to the RBAC catalog.
  plug RequirePermission,
       "equipment.act"
       when action in [:create, :update, :delete]

  action_fallback FallbackController

  def index(conn, params) do
    actor = conn.assigns.current_user

    include_inactive? =
      case params["include_inactive"] do
        v when v in ["1", "true", true] -> true
        _ -> false
      end

    rows =
      if include_inactive? do
        Categories.list_for_company(actor.company_id)
      else
        Categories.list_active_for_company(actor.company_id)
      end

    json(conn, %{
      items: Enum.map(rows, &Payloads.equipment_category/1),
      total: length(rows)
    })
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Categories.create(actor.company_id, params, actor) do
      {:ok, cat} ->
        conn
        |> put_status(:created)
        |> json(%{category: Payloads.equipment_category(cat)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Category{} = cat <-
           Categories.get_for_company(actor.company_id, uuid),
         {:ok, updated} <- Categories.update(cat, Map.drop(params, ["id"]), actor) do
      json(conn, %{category: Payloads.equipment_category(updated)})
    else
      nil -> not_found(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Category{} = cat <-
           Categories.get_for_company(actor.company_id, uuid),
         {:ok, updated} <- Categories.deactivate(cat, actor) do
      json(conn, %{category: Payloads.equipment_category(updated)})
    else
      nil -> not_found(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  defp not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", "Category not found."))
  end

  defp changeset_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{errors: BackendWeb.ChangesetJSON.error(%{changeset: cs})})
  end
end
