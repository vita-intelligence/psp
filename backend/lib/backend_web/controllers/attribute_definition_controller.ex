defmodule BackendWeb.AttributeDefinitionController do
  @moduledoc """
  Admin-extensible typed custom fields per item type. The items form
  reads `?scope=raw_material` to know which dynamic fields to render.

  RBAC: read is permissive (`items.view`) so the items form's
  consumers can fetch their dynamic field schema; write is gated by
  `attribute_definitions.manage`.
  """

  use BackendWeb, :controller

  alias Backend.Catalogs
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "items.view" when action in [:index, :show]
  plug RequirePermission, "attribute_definitions.manage"
       when action in [:create, :update, :delete]

  action_fallback BackendWeb.FallbackController

  def index(conn, params) do
    actor = conn.assigns.current_user

    case {params["scope"], params["picker"]} do
      {scope, "true"} when is_binary(scope) ->
        # Picker variant — active definitions for one scope.
        items = Catalogs.active_attribute_definitions_for_scope(actor.company_id, scope)
        json(conn, %{items: Enum.map(items, &Payloads.attribute_definition/1)})

      _ ->
        opts = list_opts_from_params(params)
        {items, next_cursor} = Catalogs.list_attribute_definitions_page(actor.company_id, opts)

        json(conn, %{
          items: Enum.map(items, &Payloads.attribute_definition/1),
          next_cursor: next_cursor
        })
    end
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Catalogs.get_attribute_definition_for_company(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      def_ -> json(conn, %{attribute_definition: Payloads.attribute_definition(def_)})
    end
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Catalogs.create_attribute_definition(actor, actor.company_id, Map.drop(params, ["id"])) do
      {:ok, def_} ->
        conn
        |> put_status(:created)
        |> json(%{attribute_definition: Payloads.attribute_definition(def_)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = def_ <- Catalogs.get_attribute_definition_for_company(actor.company_id, uuid) do
      case Catalogs.update_attribute_definition(actor, def_, Map.drop(params, ["id"])) do
        {:ok, updated} ->
          json(conn, %{attribute_definition: Payloads.attribute_definition(updated)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = def_ <- Catalogs.get_attribute_definition_for_company(actor.company_id, uuid),
         {:ok, _} <- Catalogs.delete_attribute_definition(actor, def_) do
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
      scope: params["scope"]
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
