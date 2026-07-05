defmodule BackendWeb.ProductFamilyController do
  @moduledoc """
  Marketing-level grouping of variant SKUs.

  RBAC: read borrows from `items.view` (so item-form pickers work for
  any user who can read items); write is gated by the dedicated
  `product_families.manage`.
  """

  use BackendWeb, :controller

  alias Backend.Catalogs
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "items.view" when action in [:index, :show]
  plug RequirePermission, "product_families.manage"
       when action in [:create, :update, :delete]

  action_fallback BackendWeb.FallbackController

  def index(conn, params) do
    actor = conn.assigns.current_user

    # Two shapes — list (DataTable) vs picker. The picker variant
    # returns every active row, no pagination, so the items form's
    # combobox can show them all.
    case params["picker"] do
      "true" ->
        items = Catalogs.list_families_for_company(actor.company_id)
        json(conn, %{items: Enum.map(items, &Payloads.product_family/1)})

      _ ->
        opts = list_opts_from_params(params)
        {items, next_cursor} = Catalogs.list_families_page(actor.company_id, opts)

        json(conn, %{
          items: Enum.map(items, &Payloads.product_family/1),
          next_cursor: next_cursor
        })
    end
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Catalogs.get_family_for_company(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      family -> json(conn, %{family: Payloads.product_family(family)})
    end
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Catalogs.create_family(actor, actor.company_id, Map.drop(params, ["id"])) do
      {:ok, family} ->
        conn
        |> put_status(:created)
        |> json(%{family: Payloads.product_family(family)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = family <- Catalogs.get_family_for_company(actor.company_id, uuid) do
      case Catalogs.update_family(actor, family, Map.drop(params, ["id"])) do
        {:ok, updated} -> json(conn, %{family: Payloads.product_family(updated)})
        {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = family <- Catalogs.get_family_for_company(actor.company_id, uuid),
         {:ok, _} <- Catalogs.delete_family(actor, family) do
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
