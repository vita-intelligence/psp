defmodule BackendWeb.VendorController do
  @moduledoc """
  Vendor (supplier) registry + per-vendor approved-item list +
  per-vendor certificate attachments.

  Approval is a dedicated `update_approval` action so admins can
  delegate the qualification gate (`vendors.approve`) separately
  from generic edit access (`vendors.edit`).

  RBAC:
    * `vendors.view`    — index, show, picker
    * `vendors.create`  — create
    * `vendors.edit`    — update + approved-item + certificate writes
    * `vendors.approve` — update_approval
    * `vendors.delete`  — delete
  """

  use BackendWeb, :controller

  alias Backend.Vendors
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "vendors.view" when action in [:index, :show]
  plug RequirePermission, "vendors.create" when action in [:create]
  plug RequirePermission, "vendors.edit"
       when action in [
              :update,
              :add_approved_item,
              :remove_approved_item,
              :add_certificate,
              :update_certificate,
              :remove_certificate
            ]
  plug RequirePermission, "vendors.approve" when action in [:update_approval]
  plug RequirePermission, "vendors.delete" when action in [:delete]

  action_fallback BackendWeb.FallbackController

  # ----- registry list / get ---------------------------------------

  def index(conn, params) do
    actor = conn.assigns.current_user

    case params["picker"] do
      "true" ->
        items = Vendors.list_for_company(actor.company_id)
        json(conn, %{items: Enum.map(items, &Payloads.vendor_summary/1)})

      _ ->
        opts = list_opts_from_params(params)
        {items, next_cursor} = Vendors.list_page(actor.company_id, opts)

        json(conn, %{
          items: Enum.map(items, &Payloads.vendor/1),
          next_cursor: next_cursor
        })
    end
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Vendors.get_for_company(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      vendor -> json(conn, %{vendor: Payloads.vendor(vendor)})
    end
  end

  # ----- create / update / delete ----------------------------------

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Vendors.create(actor, actor.company_id, Map.drop(params, ["id"])) do
      {:ok, vendor} ->
        conn
        |> put_status(:created)
        |> json(%{vendor: Payloads.vendor(vendor)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, uuid) do
      case Vendors.update(actor, vendor, Map.drop(params, ["id"])) do
        {:ok, updated} -> json(conn, %{vendor: Payloads.vendor(updated)})
        {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, uuid),
         {:ok, _} <- Vendors.delete(actor, vendor) do
      send_resp(conn, :no_content, "")
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- approval transition ---------------------------------------

  def update_approval(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, uuid) do
      case Vendors.approve_vendor(actor, vendor, Map.drop(params, ["id"])) do
        {:ok, updated} -> json(conn, %{vendor: Payloads.vendor(updated)})
        {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- approved-item edges ---------------------------------------

  def add_approved_item(conn, %{"vendor_id" => uuid, "item_id" => raw_item_id} = params) do
    actor = conn.assigns.current_user

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, uuid),
         {item_id, _} <- Integer.parse(to_string(raw_item_id)),
         {:ok, row} <-
           Vendors.add_approved_item(actor, vendor, item_id, Map.drop(params, ["vendor_id", "item_id"])) do
      conn
      |> put_status(:created)
      |> json(%{approved_item: Payloads.vendor_approved_item(row)})
    else
      :error ->
        unprocessable(conn, "bad_item_id", "Invalid item id.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      _ ->
        {:error, :not_found}
    end
  end

  def remove_approved_item(conn, %{"vendor_id" => vendor_uuid, "id" => row_uuid}) do
    actor = conn.assigns.current_user

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, vendor_uuid),
         %{} = row <- Vendors.get_approved_item(vendor.id, row_uuid),
         {:ok, _} <- Vendors.remove_approved_item(actor, row) do
      send_resp(conn, :no_content, "")
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- certificate attachments -----------------------------------

  def add_certificate(conn, %{"vendor_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, uuid) do
      case Vendors.add_certificate(actor, vendor, Map.drop(params, ["vendor_id"])) do
        {:ok, row} ->
          conn
          |> put_status(:created)
          |> json(%{certificate: Payloads.vendor_certificate(row)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def update_certificate(conn, %{"vendor_id" => vendor_uuid, "id" => row_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, vendor_uuid),
         %{} = row <- Vendors.get_certificate(vendor.id, row_uuid),
         {:ok, updated} <-
           Vendors.update_certificate(actor, row, Map.drop(params, ["vendor_id", "id"])) do
      json(conn, %{certificate: Payloads.vendor_certificate(updated)})
    else
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      _ -> {:error, :not_found}
    end
  end

  def remove_certificate(conn, %{"vendor_id" => vendor_uuid, "id" => row_uuid}) do
    actor = conn.assigns.current_user

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, vendor_uuid),
         %{} = row <- Vendors.get_certificate(vendor.id, row_uuid),
         {:ok, _} <- Vendors.remove_certificate(actor, row) do
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
      approval_status: params["approval_status"],
      vendor_risk: params["vendor_risk"],
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

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail))
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
