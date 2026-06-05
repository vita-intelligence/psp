defmodule BackendWeb.ItemController do
  @moduledoc """
  Stock items — the parent record for raw materials, semi-finished,
  finished products, and packaging. Per-type compliance subtables are
  managed by the sibling controllers (Slices 2–4) and stitched into
  the read payload here.

  Routes:
    * `GET    /api/items?item_type=raw_material&search=…&sort=…&cursor=…`
    * `GET    /api/items/:uuid`
    * `POST   /api/items`
    * `PUT    /api/items/:uuid`
    * `DELETE /api/items/:uuid`

  RBAC: items.view / items.create / items.edit / items.delete.
  """

  use BackendWeb, :controller

  alias Backend.Items
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "items.view" when action in [:index, :show]
  plug RequirePermission, "items.create" when action in [:create]
  plug RequirePermission, "items.edit" when action in [:update, :update_full]
  plug RequirePermission, "items.delete" when action in [:delete]

  action_fallback BackendWeb.FallbackController

  def index(conn, params) do
    actor = conn.assigns.current_user
    opts = list_opts_from_params(params)
    {items, next_cursor} = Items.list_page(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.item/1),
      next_cursor: next_cursor
    })
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    # `_full` variant preloads the per-type compliance subtables so
    # the FE form can render the right sub-section on first paint.
    case Items.get_for_company_full(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      item -> json(conn, %{item: Payloads.item(item)})
    end
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Items.create(actor, actor.company_id, Map.drop(params, ["id"])) do
      {:ok, item} ->
        conn
        |> put_status(:created)
        |> json(%{item: Payloads.item(item)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      {:error, {:invalid_attributes, detail}} ->
        attribute_error(conn, detail)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, uuid) do
      case Items.update(actor, item, Map.drop(params, ["id"])) do
        {:ok, updated} ->
          json(conn, %{item: Payloads.item(updated)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)

        {:error, {:invalid_attributes, detail}} ->
          attribute_error(conn, detail)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  @doc """
  Atomic mega-save. Accepts:

      PUT /api/items/:uuid/full
      {
        "item": { "name": ..., "item_type": ..., "attributes": {...} },
        "raw_material_compliance": { ... } | null,
        "raw_material_risk": { ... } | null,
        "finished_product_spec": { ... } | null,
        "packaging_compliance": { ... } | null
      }

  Field errors come back keyed by `section.field` so the FE can
  highlight each message next to its owning field group.
  """
  def update_full(conn, %{"item_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, uuid) do
      case Items.update_full(actor, item, Map.drop(params, ["item_id", "id"])) do
        {:ok, reloaded} ->
          json(conn, %{item: Payloads.item(reloaded)})

        {:error, %{section: section, changeset: cs}} ->
          fields =
            cs
            |> Errors.changeset_fields()
            |> Map.new(fn {k, v} -> {"#{section}.#{k}", v} end)

          conn
          |> put_status(:unprocessable_entity)
          |> json(
            Errors.payload(
              "validation_failed",
              "Please correct the highlighted fields.",
              fields
            )
          )

        {:error, {:invalid_attributes, detail}} ->
          attribute_error(conn, detail)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, uuid),
         {:ok, _} <- Items.delete(actor, item) do
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
      item_type: params["item_type"]
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

  # Attribute-bag failures aren't field-shaped — surface as a banner
  # with the specific failing key in `detail` so the FE banner shows
  # exactly which attribute the user typed something wrong into.
  defp attribute_error(conn, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(
      Errors.payload(
        "invalid_attributes",
        detail
      )
    )
  end
end
