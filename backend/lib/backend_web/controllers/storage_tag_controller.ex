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

  RBAC: viewing (and therefore picking from the warehouse-plan tag
  picker) requires `warehouses.view`; managing the vocabulary
  (create / update / delete) requires the admin-level
  `storage_tags.manage`. The split exists so a warehouse operator
  can pick tags without being able to redefine the vocabulary
  everyone else uses.
  """

  use BackendWeb, :controller

  alias Backend.Warehouses.StorageTags
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "warehouses.view" when action in [:index, :show]
  plug RequirePermission, "storage_tags.manage" when action in [:create, :update, :delete]

  action_fallback BackendWeb.FallbackController

  def index(conn, params) do
    actor = conn.assigns.current_user

    # Two shapes — picker (server component fetches all matching
    # `kind`) vs admin table (cursor-paginated, searchable, sortable).
    # Picker hits this with `?kind=location|cell`; admin table hits
    # with the standard list params and no kind filter.
    if is_binary(params["kind"]) do
      items =
        StorageTags.list_for_company(actor.company_id,
          kind: params["kind"]
        )

      json(conn, %{items: Enum.map(items, &Payloads.storage_tag/1)})
    else
      opts = list_opts_from_params(params)
      {items, next_cursor} = StorageTags.list_page(actor.company_id, opts)

      json(conn, %{
        items: Enum.map(items, &Payloads.storage_tag/1),
        next_cursor: next_cursor
      })
    end
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

  defp list_opts_from_params(params) do
    [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      search: params["search"],
      column_filter: params["column_filter"]
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
