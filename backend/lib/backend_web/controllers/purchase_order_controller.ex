defmodule BackendWeb.PurchaseOrderController do
  @moduledoc """
  Purchase orders + lines + two-tier approval workflow.

  RBAC:
    * `procurement.po_view`              — index, show
    * `procurement.po_create`            — create, update header, lines, cancel
    * `procurement.po_submit`            — submit (draft → pending_approver)
    * `procurement.po_approve`           — sign_approver
    * `procurement.po_director_approve`  — sign_director, mark_ordered
  """

  use BackendWeb, :controller

  alias Backend.Purchasing
  alias Backend.Purchasing.VendorPrices
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "procurement.po_view" when action in [:index, :show]
  plug RequirePermission, "procurement.po_create"
       when action in [
              :create,
              :update,
              :delete,
              :add_line,
              :update_line,
              :delete_line,
              :cancel,
              :suggest_price
            ]
  plug RequirePermission, "procurement.po_submit" when action in [:submit]
  plug RequirePermission, "procurement.po_approve" when action in [:sign_approver]
  plug RequirePermission, "procurement.po_director_approve"
       when action in [:sign_director, :mark_ordered]
  plug RequirePermission, "procurement.po_receive" when action in [:receive]

  action_fallback BackendWeb.FallbackController

  # ----- list / get ------------------------------------------------

  def index(conn, params) do
    actor = conn.assigns.current_user

    opts = [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      search: params["search"],
      status: params["status"],
      vendor_id: params["vendor_id"]
    ]

    {items, next_cursor} = Purchasing.list_page(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.purchase_order/1),
      next_cursor: next_cursor
    })
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Purchasing.get_for_company(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      po -> json(conn, %{purchase_order: Payloads.purchase_order(po)})
    end
  end

  # ----- create / update / delete ----------------------------------

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Purchasing.create(actor, actor.company_id, Map.drop(params, ["id"])) do
      {:ok, po} ->
        conn
        |> put_status(:created)
        |> json(%{purchase_order: Payloads.purchase_order(po)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, uuid) do
      case Purchasing.update_header(actor, po, Map.drop(params, ["id"])) do
        {:ok, updated} -> json(conn, %{purchase_order: Payloads.purchase_order(updated)})
        {:error, :not_editable} -> conflict(conn, "po_locked", "PO is no longer editable.")
        {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, uuid),
         {:ok, _} <- Purchasing.delete(actor, po) do
      send_resp(conn, :no_content, "")
    else
      {:error, :not_deletable} ->
        conflict(conn, "po_locked", "Only draft POs can be deleted.")

      _ ->
        {:error, :not_found}
    end
  end

  # ----- lines -----------------------------------------------------

  def add_line(conn, %{"purchase_order_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, uuid),
         {:ok, line} <- Purchasing.add_line(actor, po, Map.drop(params, ["purchase_order_id"])) do
      conn
      |> put_status(:created)
      |> json(%{line: Payloads.purchase_order_line(line)})
    else
      {:error, :not_editable} -> conflict(conn, "po_locked", "PO is no longer editable.")
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      _ -> {:error, :not_found}
    end
  end

  def update_line(conn, %{"purchase_order_id" => po_uuid, "id" => line_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, po_uuid),
         %{} = line <- Purchasing.get_line(po.id, line_uuid),
         {:ok, updated} <-
           Purchasing.update_line(actor, line, Map.drop(params, ["purchase_order_id", "id"])) do
      json(conn, %{line: Payloads.purchase_order_line(updated)})
    else
      {:error, :not_editable} -> conflict(conn, "po_locked", "PO is no longer editable.")
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      _ -> {:error, :not_found}
    end
  end

  def delete_line(conn, %{"purchase_order_id" => po_uuid, "id" => line_uuid}) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, po_uuid),
         %{} = line <- Purchasing.get_line(po.id, line_uuid),
         {:ok, _} <- Purchasing.delete_line(actor, line) do
      send_resp(conn, :no_content, "")
    else
      {:error, :not_editable} -> conflict(conn, "po_locked", "PO is no longer editable.")
      _ -> {:error, :not_found}
    end
  end

  @doc """
  Last-paid price lookup for the add-line dialog. The FE fires this
  the moment the worker picks an item so unit_price can pre-fill —
  pulling the (vendor, item, currency) tuple from the parent PO and
  the chosen item.
  """
  def suggest_price(conn, %{"purchase_order_id" => po_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, po_uuid),
         {:ok, item_id} <- parse_item_id(params["item_id"]) do
      last_paid =
        VendorPrices.last_paid_for(
          po.company_id,
          po.vendor_id,
          item_id,
          po.currency_code
        )

      json(conn, %{last_paid: Payloads.vendor_item_price_suggestion(last_paid)})
    else
      {:error, :bad_item_id} ->
        unprocessable(conn, "bad_item_id", "item_id query parameter must be a positive integer.")

      _ ->
        {:error, :not_found}
    end
  end

  defp parse_item_id(nil), do: {:error, :bad_item_id}
  defp parse_item_id(""), do: {:error, :bad_item_id}
  defp parse_item_id(n) when is_integer(n) and n > 0, do: {:ok, n}

  defp parse_item_id(raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} when n > 0 -> {:ok, n}
      _ -> {:error, :bad_item_id}
    end
  end

  defp parse_item_id(_), do: {:error, :bad_item_id}

  # ----- state transitions ----------------------------------------

  def submit(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, uuid) do
      case Purchasing.submit(actor, po) do
        {:ok, updated} -> json(conn, %{purchase_order: Payloads.purchase_order(updated)})
        {:error, :bad_status} -> conflict(conn, "bad_status", "Only draft POs can be submitted.")
        {:error, :no_lines} -> unprocessable(conn, "no_lines", "Add at least one line first.")
        {:error, :vendor_not_approved} ->
          unprocessable(
            conn,
            "vendor_not_approved",
            "Vendor must be in approved status before a PO can be submitted."
          )

        {:error, {:item_not_approved, item_id}} ->
          unprocessable(
            conn,
            "item_not_approved",
            "Item ##{item_id} is not on the vendor's approved-supplier list."
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def sign_approver(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user
    opts = Map.take(params, ["notes", "signature_image"])

    with %{} = po <- Purchasing.get_for_company(actor.company_id, uuid) do
      case Purchasing.sign_approver(actor, po, opts) do
        {:ok, updated} -> json(conn, %{purchase_order: Payloads.purchase_order(updated)})
        {:error, :bad_status} -> conflict(conn, "bad_status", "PO is not awaiting approver sign-off.")
        {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def sign_director(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user
    opts = Map.take(params, ["notes", "signature_image"])

    with %{} = po <- Purchasing.get_for_company(actor.company_id, uuid) do
      case Purchasing.sign_director(actor, po, opts) do
        {:ok, updated} -> json(conn, %{purchase_order: Payloads.purchase_order(updated)})
        {:error, :bad_status} -> conflict(conn, "bad_status", "PO is not awaiting director sign-off.")
        {:error, :same_signer} ->
          conflict(
            conn,
            "same_signer",
            "Director sign-off must be a different user from the approver-tier signer."
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def mark_ordered(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, uuid) do
      case Purchasing.mark_ordered(actor, po) do
        {:ok, updated} -> json(conn, %{purchase_order: Payloads.purchase_order(updated)})
        {:error, :bad_status} ->
          conflict(conn, "bad_status", "Only approved POs can be marked as ordered.")

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def receive(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, uuid) do
      case Purchasing.receive_against_po(actor, po, Map.drop(params, ["id"])) do
        {:ok, updated} ->
          json(conn, %{purchase_order: Payloads.purchase_order(updated)})

        {:error, :bad_status} ->
          conflict(conn, "bad_status", "Only ordered POs can receive stock.")

        {:error, :no_lines} ->
          unprocessable(conn, "no_lines", "Add at least one receipt line.")

        {:error, {:line_not_found, uuid}} ->
          unprocessable(conn, "line_not_found", "Receipt line #{uuid} doesn't match the PO.")

        {:error, :bad_qty} ->
          unprocessable(conn, "bad_qty", "Each receipt qty must be a positive number.")

        {:error, :over_receipt} ->
          unprocessable(conn, "over_receipt", "Receipt qty exceeds remaining on the line.")

        {:error, {:lot_failed, line_uuid, reason}} ->
          unprocessable(
            conn,
            "lot_failed",
            "Couldn't create lot for line #{line_uuid}: #{inspect(reason)}"
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def cancel(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user
    reason = params["reason"] || ""

    cond do
      reason == "" ->
        unprocessable(conn, "reason_required", "Cancellation reason is required.")

      true ->
        with %{} = po <- Purchasing.get_for_company(actor.company_id, uuid) do
          case Purchasing.cancel(actor, po, reason) do
            {:ok, updated} -> json(conn, %{purchase_order: Payloads.purchase_order(updated)})
            {:error, :bad_status} ->
              conflict(conn, "bad_status", "Already terminal — can't cancel.")

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)
          end
        else
          _ -> {:error, :not_found}
        end
    end
  end

  # ----- helpers ---------------------------------------------------

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

  defp conflict(conn, code, detail) do
    conn
    |> put_status(:conflict)
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
