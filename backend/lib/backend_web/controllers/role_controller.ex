defmodule BackendWeb.RoleController do
  @moduledoc """
  Permission templates — saved permission-code bundles admins can
  apply to a user matrix with one click. DB table is still `roles` for
  stability; the user-facing term is "template".

  RBAC:

    * `:index` / `:show`  → `roles.view`
    * `:create`           → `roles.create`
    * `:update`           → `roles.edit`
    * `:delete`           → `roles.delete`

  System rows (`is_system: true`) are reserved for future demo
  templates and refuse update / delete. Today none are seeded.
  """

  use BackendWeb, :controller

  alias Backend.RBAC
  alias BackendWeb.{Errors, Plugs.RequirePermission}

  plug RequirePermission, "roles.view" when action in [:index, :show]
  plug RequirePermission, "roles.create" when action in [:create]
  plug RequirePermission, "roles.edit" when action in [:update]
  plug RequirePermission, "roles.delete" when action in [:delete]

  action_fallback BackendWeb.FallbackController

  def index(conn, params) do
    user = conn.assigns.current_user
    opts = list_opts_from_params(params)

    {items, next_cursor} = RBAC.list_templates(user.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &payload/1),
      next_cursor: next_cursor
    })
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

  defp parse_sort(spec) when is_binary(spec) do
    case String.split(spec, ":", parts: 2) do
      [field] -> {field, :asc}
      [field, "desc"] -> {field, :desc}
      [field, _] -> {field, :asc}
    end
  end

  defp parse_sort(_), do: nil

  def show(conn, %{"id" => id}) do
    actor = conn.assigns.current_user

    with %{} = template <- RBAC.get_template(id),
         true <- template.company_id == actor.company_id do
      json(conn, %{template: payload(template)})
    else
      _ -> {:error, :not_found}
    end
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case RBAC.create_template(actor, params) do
      {:ok, template} ->
        conn
        |> put_status(:created)
        |> json(%{template: payload(template)})

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
    actor = conn.assigns.current_user

    with %{} = template <- RBAC.get_template(id),
         true <- template.company_id == actor.company_id,
         {:ok, updated} <- RBAC.update_template(actor, template, params) do
      json(conn, %{template: payload(updated)})
    else
      nil ->
        {:error, :not_found}

      false ->
        {:error, :not_found}

      {:error, :system_template} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "system_template",
            "This is a built-in template and can't be edited."
          )
        )

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

  def delete(conn, %{"id" => id}) do
    actor = conn.assigns.current_user

    with %{} = template <- RBAC.get_template(id),
         true <- template.company_id == actor.company_id,
         {:ok, _} <- RBAC.delete_template(actor, template) do
      send_resp(conn, :no_content, "")
    else
      nil ->
        {:error, :not_found}

      false ->
        {:error, :not_found}

      {:error, :system_template} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "system_template",
            "This is a built-in template and can't be deleted."
          )
        )
    end
  end

  defp payload(template) do
    %{
      id: template.id,
      uuid: template.uuid,
      code: BackendWeb.Payloads.render_entity_code(template, "template"),
      name: template.name,
      slug: template.slug,
      description: template.description,
      is_system: template.is_system,
      permissions: template.permissions,
      inserted_at: template.inserted_at,
      updated_at: template.updated_at,
      created_by: actor(template, :created_by),
      updated_by: actor(template, :updated_by)
    }
  end

  defp actor(record, field) do
    case Map.get(record, field) do
      %Ecto.Association.NotLoaded{} -> nil
      nil -> nil
      user -> BackendWeb.Payloads.audit_actor(user)
    end
  end
end
