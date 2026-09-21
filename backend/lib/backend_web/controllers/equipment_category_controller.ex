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

  plug RequirePermission,
       "equipment.view" when action in [:index, :list_form_assignments]

  # Category management is a settings-tier action — gate on the same
  # ``equipment.act`` permission the maintenance / repair mutators
  # use. If we later want a distinct ``equipment.settings`` grant,
  # swap this plug and add the perm to the RBAC catalog.
  plug RequirePermission,
       "equipment.act"
       when action in [:create, :update, :delete, :replace_form_assignments]

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

  @doc """
  List every form assignment on one equipment category. Powers the
  Forms card on the category detail page + the FE's "here are the
  forms every V-blender in the plant is running" view.
  """
  def list_form_assignments(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Categories.get_for_company(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %Backend.Equipment.Category{} = cat ->
        rows = Categories.list_form_assignments(cat)

        json(conn, %{
          items:
            Enum.map(rows, fn a ->
              %{
                uuid: a.uuid,
                slot: a.slot,
                sort_order: a.sort_order,
                form_template: a.form_template && form_template_summary(a.form_template)
              }
            end),
          total: length(rows)
        })
    end
  end

  @doc """
  Bulk-overwrite form assignments on one category. Body:

      { "assignments": [
          { "form_template_uuid": "<uuid>",
            "slot": "equipment_cleaning",
            "sort_order": 0 },
          ...
        ] }

  Missing rows = detached. Publishes the updated forms to
  vita-perf via the workstation-equipment publisher so every kiosk
  serving a machine in this category picks up the new / dropped
  forms on the next session start.
  """
  def replace_form_assignments(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user
    entries = params["assignments"] || []

    with %Backend.Equipment.Category{} = cat <-
           Categories.get_for_company(actor.company_id, uuid),
         {:ok, rows} <- Categories.replace_form_assignments(cat, entries, actor) do
      json(conn, %{
        items:
          Enum.map(rows, fn a ->
            %{
              uuid: a.uuid,
              slot: a.slot,
              sort_order: a.sort_order,
              form_template: a.form_template && form_template_summary(a.form_template)
            }
          end),
        total: length(rows)
      })
    else
      nil ->
        not_found(conn)

      {:error, :template_not_found, missing_uuid} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "form_template_not_found",
            "One of the referenced form templates isn't in this workspace.",
            %{"form_template_uuid" => missing_uuid}
          )
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  defp form_template_summary(%Backend.Forms.FormTemplate{} = t) do
    %{
      uuid: t.uuid,
      name: t.name,
      trigger: t.trigger,
      version: t.version,
      is_active: t.is_active
    }
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
