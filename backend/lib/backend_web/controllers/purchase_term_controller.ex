defmodule BackendWeb.PurchaseTermController do
  @moduledoc """
  CRUD for vendor-quoted purchase terms — the commercial baseline
  that backs the PO "suggest unit price" fallback and the item's
  default cost when no PO history exists.

  Nested under BOTH `/api/vendors/:vendor_id/purchase-terms` and
  `/api/items/:item_id/purchase-terms`. The vendor-nested routes are
  the CRUD path (buyer edits terms from the vendor detail page); the
  item-nested route is a read-only list for the item detail page.

  Approval coupling: create/update fails with a domain error when
  the vendor isn't on the item's approved-supplier list. Delete has
  no such gate — you can revoke a term at any time.

  RBAC:
    * `vendors.view`  — list_for_vendor / list_for_item
    * `vendors.edit`  — create / update / delete
  """

  use BackendWeb, :controller

  alias Backend.{Purchasing.PurchaseTerm, Purchasing.PurchaseTerms, Vendors, Items}
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "vendors.view"
       when action in [:list_for_vendor, :list_for_item]
  plug RequirePermission, "vendors.edit"
       when action in [:create, :update, :delete]

  action_fallback BackendWeb.FallbackController

  # ----- reads ------------------------------------------------------

  def list_for_vendor(conn, %{"vendor_id" => vendor_uuid}) do
    actor = conn.assigns.current_user

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, vendor_uuid) do
      rows = PurchaseTerms.list_for_vendor(actor.company_id, vendor.id)
      json(conn, %{purchase_terms: Enum.map(rows, &Payloads.purchase_term/1)})
    else
      _ -> {:error, :not_found}
    end
  end

  def list_for_item(conn, %{"item_id" => item_uuid}) do
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, item_uuid) do
      rows = PurchaseTerms.list_for_item(actor.company_id, item.id)
      json(conn, %{purchase_terms: Enum.map(rows, &Payloads.purchase_term/1)})
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- writes -----------------------------------------------------

  def create(conn, %{"vendor_id" => vendor_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, vendor_uuid),
         {:ok, item_id} <- resolve_item(actor.company_id, params["item_id"] || params["item_uuid"]),
         attrs <- build_attrs(actor, vendor, item_id, params),
         {:ok, term} <- PurchaseTerms.upsert(attrs) do
      conn
      |> put_status(:created)
      |> json(%{purchase_term: Payloads.purchase_term(term)})
    else
      :error ->
        unprocessable(conn, "bad_item", "Item not found or not accessible.")

      {:error, :requires_approval} ->
        unprocessable(
          conn,
          "requires_approval",
          "Vendor must be approved for this item before saving a purchase term. Approve on the vendor's approved-items list, then retry."
        )

      {:error, :missing_scope} ->
        unprocessable(conn, "missing_scope", "vendor_id and item_id are required.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      _ ->
        {:error, :not_found}
    end
  end

  def update(conn, %{"vendor_id" => vendor_uuid, "id" => term_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, vendor_uuid),
         %PurchaseTerm{} = existing <- PurchaseTerms.get(actor.company_id, term_uuid),
         true <- existing.vendor_id == vendor.id,
         attrs <- build_attrs(actor, vendor, existing.item_id, params),
         {:ok, term} <- PurchaseTerms.upsert(attrs) do
      json(conn, %{purchase_term: Payloads.purchase_term(term)})
    else
      false -> {:error, :not_found}
      nil -> {:error, :not_found}
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      {:error, :requires_approval} ->
        unprocessable(
          conn,
          "requires_approval",
          "Vendor is no longer approved for this item. Restore approval or delete the term."
        )
      _ -> {:error, :not_found}
    end
  end

  def delete(conn, %{"vendor_id" => vendor_uuid, "id" => term_uuid}) do
    actor = conn.assigns.current_user

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, vendor_uuid),
         %PurchaseTerm{} = term <- PurchaseTerms.get(actor.company_id, term_uuid),
         true <- term.vendor_id == vendor.id,
         {:ok, _} <- PurchaseTerms.delete(term) do
      send_resp(conn, :no_content, "")
    else
      false -> {:error, :not_found}
      _ -> {:error, :not_found}
    end
  end

  # ----- helpers ----------------------------------------------------

  defp resolve_item(_company_id, nil), do: :error
  defp resolve_item(_company_id, ""), do: :error

  defp resolve_item(company_id, raw) when is_binary(raw) do
    # Accept either the internal numeric id (from picker responses) or
    # the item's public UUID (canonical FE payload shape). Uses whichever
    # form the caller happened to send.
    case Integer.parse(raw) do
      {n, ""} when n > 0 -> {:ok, n}
      _ ->
        case Items.get_for_company(company_id, raw) do
          %{id: id} -> {:ok, id}
          _ -> :error
        end
    end
  end

  defp resolve_item(_company_id, n) when is_integer(n) and n > 0, do: {:ok, n}
  defp resolve_item(_company_id, _), do: :error

  # Whitelist the fields we accept from the payload and stamp the
  # scope (company / vendor / item) + actor. Anything else the caller
  # sends is silently dropped so a fat-fingered payload can't set
  # audit fields it shouldn't.
  defp build_attrs(actor, vendor, item_id, params) do
    %{
      "company_id" => actor.company_id,
      "vendor_id" => vendor.id,
      "item_id" => item_id,
      "updated_by_id" => actor.id,
      "vendor_part_no" => params["vendor_part_no"],
      "lead_time_days" => params["lead_time_days"],
      "price" => params["price"],
      "currency_code" => params["currency_code"] || vendor.currency_code,
      "min_quantity" => params["min_quantity"],
      "min_quantity_uom" => params["min_quantity_uom"],
      "priority" => params["priority"] || 1,
      "valid_from" => params["valid_from"],
      "valid_until" => params["valid_until"],
      "notes" => params["notes"]
    }
    |> Enum.reject(fn {_k, v} -> is_nil(v) end)
    |> Enum.into(%{})
  end

  defp unprocessable(conn, code, message) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: code, message: message})
  end

  defp changeset_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{errors: translate_errors(cs)})
  end

  defp translate_errors(%Ecto.Changeset{} = cs) do
    Ecto.Changeset.traverse_errors(cs, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end
end
