defmodule BackendWeb.PricelistController do
  @moduledoc """
  Pricelist registry — the sell-side selling-price quotes that
  customer-order line forms read.

  RBAC:
    * `pricelists.view`   — index, show, picker
    * `pricelists.create` — create
    * `pricelists.edit`   — update + add_line + update_line + remove_line + set_default
    * `pricelists.delete` — delete

  No dedicated approval gate by design (the user picked "save = live"):
  every write fans out to the audit log so a future "who changed
  what" question is answerable.
  """

  use BackendWeb, :controller

  alias Backend.Pricelists
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "pricelists.view" when action in [:index, :show]

  plug RequirePermission, "pricelists.create" when action in [:create]

  plug RequirePermission, "pricelists.edit"
       when action in [
              :update,
              :set_default,
              :add_line,
              :update_line,
              :remove_line
            ]

  plug RequirePermission, "pricelists.delete" when action in [:delete]

  action_fallback BackendWeb.FallbackController

  def index(conn, params) do
    actor = conn.assigns.current_user

    case params["picker"] do
      "true" ->
        items = Pricelists.list_for_company(actor.company_id)
        json(conn, %{items: Enum.map(items, &Payloads.pricelist_summary/1)})

      _ ->
        opts = list_opts_from_params(params)
        {items, next_cursor} = Pricelists.list_page(actor.company_id, opts)

        json(conn, %{
          items: Enum.map(items, &Payloads.pricelist/1),
          next_cursor: next_cursor
        })
    end
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Pricelists.get_for_company(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      pricelist -> json(conn, %{pricelist: Payloads.pricelist(pricelist)})
    end
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Pricelists.create(actor, actor.company_id, Map.drop(params, ["id"])) do
      {:ok, pricelist} ->
        conn
        |> put_status(:created)
        |> json(%{pricelist: Payloads.pricelist(pricelist)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = pricelist <- Pricelists.get_for_company(actor.company_id, uuid) do
      case Pricelists.update(actor, pricelist, Map.drop(params, ["id"])) do
        {:ok, updated} -> json(conn, %{pricelist: Payloads.pricelist(updated)})
        {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = pricelist <- Pricelists.get_for_company(actor.company_id, uuid),
         {:ok, _} <- Pricelists.delete(actor, pricelist) do
      send_resp(conn, :no_content, "")
    else
      _ -> {:error, :not_found}
    end
  end

  def set_default(conn, %{"pricelist_id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = pricelist <- Pricelists.get_for_company(actor.company_id, uuid),
         {:ok, updated} <- Pricelists.set_default(actor, pricelist) do
      json(conn, %{pricelist: Payloads.pricelist(updated)})
    else
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      _ -> {:error, :not_found}
    end
  end

  # ----- line items -----------------------------------------------

  def add_line(conn, %{"pricelist_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = pricelist <- Pricelists.get_for_company(actor.company_id, uuid) do
      case Pricelists.add_line(actor, pricelist, Map.drop(params, ["pricelist_id"])) do
        {:ok, row} ->
          conn
          |> put_status(:created)
          |> json(%{item: Payloads.pricelist_item(row)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def update_line(conn, %{"pricelist_id" => p_uuid, "id" => row_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = pricelist <- Pricelists.get_for_company(actor.company_id, p_uuid),
         %{} = row <- Pricelists.get_line(pricelist.id, row_uuid),
         {:ok, updated} <-
           Pricelists.update_line(actor, row, Map.drop(params, ["pricelist_id", "id"])) do
      json(conn, %{item: Payloads.pricelist_item(updated)})
    else
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      _ -> {:error, :not_found}
    end
  end

  def remove_line(conn, %{"pricelist_id" => p_uuid, "id" => row_uuid}) do
    actor = conn.assigns.current_user

    with %{} = pricelist <- Pricelists.get_for_company(actor.company_id, p_uuid),
         %{} = row <- Pricelists.get_line(pricelist.id, row_uuid),
         {:ok, _} <- Pricelists.remove_line(actor, row) do
      send_resp(conn, :no_content, "")
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- helpers ----------------------------------------------------

  defp list_opts_from_params(params) do
    [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      search: params["search"],
      is_active: params["is_active"]
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
