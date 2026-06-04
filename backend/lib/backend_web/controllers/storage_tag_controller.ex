defmodule BackendWeb.StorageTagController do
  @moduledoc """
  Company-scoped tag vocabulary. The picker on the warehouse plan
  editor reads from here; admins manage entries at
  `/settings/storage-tags`.

  Routes:
    * `GET    /api/storage-tags?kind=location|cell` — list (filter by
      applicability; tags marked `both` always show)
    * `GET    /api/storage-tags/:id`
    * `POST   /api/storage-tags`
    * `PUT    /api/storage-tags/:id`
    * `DELETE /api/storage-tags/:id`

  RBAC: viewing (and therefore picking) requires `warehouses.view`;
  managing (create / update / delete) requires `warehouses.edit`,
  matching the rest of the warehouse plan editor surface.
  """

  use BackendWeb, :controller

  alias Backend.Warehouses.StorageTags
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "warehouses.view" when action in [:index, :show]
  plug RequirePermission, "warehouses.edit" when action in [:create, :update, :delete]

  action_fallback BackendWeb.FallbackController

  def index(conn, params) do
    actor = conn.assigns.current_user

    items =
      StorageTags.list_for_company(actor.company_id,
        kind: params["kind"]
      )

    json(conn, %{items: Enum.map(items, &Payloads.storage_tag/1)})
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case StorageTags.get_for_company(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      tag -> json(conn, %{tag: Payloads.storage_tag(tag)})
    end
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case StorageTags.create(actor, actor.company_id, Map.drop(params, ["id"])) do
      {:ok, tag} ->
        conn
        |> put_status(:created)
        |> json(%{tag: Payloads.storage_tag(tag)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = tag <- StorageTags.get_for_company(actor.company_id, uuid) do
      case StorageTags.update(actor, tag, Map.drop(params, ["id"])) do
        {:ok, updated} ->
          json(conn, %{tag: Payloads.storage_tag(updated)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = tag <- StorageTags.get_for_company(actor.company_id, uuid),
         {:ok, _} <- StorageTags.delete(actor, tag) do
      send_resp(conn, :no_content, "")
    else
      _ -> {:error, :not_found}
    end
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
