defmodule BackendWeb.CustomerInvoiceController do
  @moduledoc """
  Customer invoices — sell-side back-half of order-to-cash. Generated
  from confirmed COs (auto-copies unbilled qty) or created standalone
  against a customer.

  RBAC:
    * `customer_invoices.view` — index, show
    * `customer_invoices.create` — create + edit drafts + add/remove
      lines + cancel pre-payment
    * `customer_invoices.send` — flip draft → sent
    * `customer_invoices.record_payment` — record payments
    * `customer_invoices.delete` — delete drafts
  """

  use BackendWeb, :controller

  alias Backend.{CustomerInvoices, CustomerOrders, Documents, Numbering}
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "customer_invoices.view"
       when action in [:index, :show, :document_pdf]

  plug RequirePermission, "customer_invoices.create"
       when action in [
              :create,
              :create_from_co,
              :update,
              :add_line,
              :update_line,
              :delete_line,
              :cancel
            ]

  plug RequirePermission, "customer_invoices.send" when action in [:send]

  plug RequirePermission, "customer_invoices.record_payment"
       when action in [:record_payment]

  plug RequirePermission, "customer_invoices.delete" when action in [:delete]

  action_fallback BackendWeb.FallbackController

  # ----- list / get -----------------------------------------------

  def index(conn, params) do
    actor = conn.assigns.current_user
    opts = list_opts_from_params(params)
    {items, next_cursor} = CustomerInvoices.list_page(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.customer_invoice/1),
      next_cursor: next_cursor
    })
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case CustomerInvoices.get_for_company(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      inv -> json(conn, %{customer_invoice: Payloads.customer_invoice(inv)})
    end
  end

  # ----- create / update / delete ---------------------------------

  def create(conn, params) do
    actor = conn.assigns.current_user

    case CustomerInvoices.create(actor, actor.company_id, Map.drop(params, ["id"])) do
      {:ok, inv} ->
        conn
        |> put_status(:created)
        |> json(%{customer_invoice: Payloads.customer_invoice(inv)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  @doc """
  Generate an invoice from a confirmed CO. Auto-copies unbilled
  qty across all CO lines. Skips lines that are already fully
  invoiced. Inherits header rates from the CO.
  """
  def create_from_co(conn, %{"customer_order_id" => co_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = co <- CustomerOrders.get_for_company(actor.company_id, co_uuid) do
      case CustomerInvoices.create_from_co(actor, co, Map.drop(params, ["customer_order_id"])) do
        {:ok, inv} ->
          conn
          |> put_status(:created)
          |> json(%{customer_invoice: Payloads.customer_invoice(inv)})

        {:error, :co_not_confirmed} ->
          conflict(
            conn,
            "co_not_confirmed",
            "Only confirmed customer orders can be invoiced."
          )

        {:error, :nothing_to_invoice} ->
          unprocessable(
            conn,
            "nothing_to_invoice",
            "Every line on this CO has already been fully invoiced."
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = inv <- CustomerInvoices.get_for_company(actor.company_id, uuid) do
      case CustomerInvoices.update_header(actor, inv, Map.drop(params, ["id"])) do
        {:ok, updated} ->
          json(conn, %{customer_invoice: Payloads.customer_invoice(updated)})

        {:error, :bad_status} ->
          conflict(conn, "bad_status", "Only draft invoices can be edited.")

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = inv <- CustomerInvoices.get_for_company(actor.company_id, uuid),
         {:ok, _} <- CustomerInvoices.delete(actor, inv) do
      send_resp(conn, :no_content, "")
    else
      {:error, :bad_status} ->
        conflict(conn, "bad_status", "Only draft invoices can be deleted.")

      _ ->
        {:error, :not_found}
    end
  end

  # ----- lines ----------------------------------------------------

  def add_line(conn, %{"customer_invoice_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = inv <- CustomerInvoices.get_for_company(actor.company_id, uuid) do
      case CustomerInvoices.add_line(actor, inv, Map.drop(params, ["customer_invoice_id"])) do
        {:ok, line} ->
          conn
          |> put_status(:created)
          |> json(%{line: Payloads.customer_invoice_line(line)})

        {:error, :bad_status} ->
          conflict(conn, "bad_status", "Only draft invoices can take new lines.")

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def update_line(conn, %{"customer_invoice_id" => i_uuid, "id" => l_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = inv <- CustomerInvoices.get_for_company(actor.company_id, i_uuid),
         %{} = line <- CustomerInvoices.get_line(inv.id, l_uuid),
         {:ok, updated} <-
           CustomerInvoices.update_line(
             actor,
             line,
             Map.drop(params, ["customer_invoice_id", "id"])
           ) do
      json(conn, %{line: Payloads.customer_invoice_line(updated)})
    else
      {:error, :bad_status} ->
        conflict(conn, "bad_status", "Only draft invoices can have lines edited.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      _ ->
        {:error, :not_found}
    end
  end

  def delete_line(conn, %{"customer_invoice_id" => i_uuid, "id" => l_uuid}) do
    actor = conn.assigns.current_user

    with %{} = inv <- CustomerInvoices.get_for_company(actor.company_id, i_uuid),
         %{} = line <- CustomerInvoices.get_line(inv.id, l_uuid),
         {:ok, _} <- CustomerInvoices.delete_line(actor, line) do
      send_resp(conn, :no_content, "")
    else
      {:error, :bad_status} ->
        conflict(conn, "bad_status", "Only draft invoices can have lines removed.")

      _ ->
        {:error, :not_found}
    end
  end

  # ----- state machine --------------------------------------------

  def send(conn, %{"customer_invoice_id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = inv <- CustomerInvoices.get_for_company(actor.company_id, uuid) do
      case CustomerInvoices.mark_sent(actor, inv) do
        {:ok, updated} ->
          json(conn, %{customer_invoice: Payloads.customer_invoice(updated)})

        {:error, :bad_status} ->
          conflict(conn, "bad_status", "Only draft invoices can be sent.")

        {:error, :no_lines} ->
          unprocessable(conn, "no_lines", "Add at least one line first.")

        {:error, :customer_not_approved} ->
          unprocessable(
            conn,
            "customer_not_approved",
            "Customer must be effectively approved to receive an invoice."
          )

        {:error, :grand_total_must_be_positive} ->
          unprocessable(
            conn,
            "grand_total_must_be_positive",
            "Invoice total must be greater than zero."
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def cancel(conn, %{"customer_invoice_id" => uuid} = params) do
    actor = conn.assigns.current_user
    reason = params["reason"] || ""

    cond do
      reason == "" ->
        unprocessable(conn, "reason_required", "Cancellation reason is required.")

      true ->
        with %{} = inv <- CustomerInvoices.get_for_company(actor.company_id, uuid) do
          case CustomerInvoices.cancel(actor, inv, reason) do
            {:ok, updated} ->
              json(conn, %{customer_invoice: Payloads.customer_invoice(updated)})

            {:error, :bad_status} ->
              conflict(conn, "bad_status", "Paid or already-cancelled invoices can't be cancelled.")

            {:error, :payments_recorded} ->
              conflict(
                conn,
                "payments_recorded",
                "Payments have been recorded — issue a refund payment (negative amount) before cancelling."
              )

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)
          end
        else
          _ -> {:error, :not_found}
        end
    end
  end

  # ----- payments -------------------------------------------------

  def record_payment(conn, %{"customer_invoice_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = inv <- CustomerInvoices.get_for_company(actor.company_id, uuid) do
      case CustomerInvoices.record_payment(
             actor,
             inv,
             Map.drop(params, ["customer_invoice_id"])
           ) do
        {:ok, %{payment: payment, invoice: refreshed}} ->
          conn
          |> put_status(:created)
          |> json(%{
            payment: Payloads.customer_invoice_payment(payment),
            customer_invoice: Payloads.customer_invoice(refreshed)
          })

        {:error, :bad_status} ->
          conflict(
            conn,
            "bad_status",
            "Payments can only be recorded against sent / partially_paid / paid invoices."
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- PDF document ---------------------------------------------

  @doc """
  Render the invoice as a PDF. ChromicPDF via `Backend.Documents` —
  same posture as procurement PO documents.

  Inline disposition so the browser opens its built-in PDF viewer
  (with download / print / zoom controls), matching the PO toolbar
  pattern. A wrong-status invoice returns 404 — drafts CAN be
  rendered (they have a "DRAFT" banner) so the salesperson can
  preview before sending.
  """
  def document_pdf(conn, %{"customer_invoice_id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = inv <- CustomerInvoices.get_for_company(actor.company_id, uuid),
         {:ok, bytes} <- Documents.customer_invoice_pdf(inv) do
      company = Backend.Companies.current()
      code =
        Numbering.render(inv.id, company, "customer_invoice") || "INV-#{inv.id}"
      filename = "#{code}.pdf"

      conn
      |> put_resp_content_type("application/pdf")
      |> put_resp_header(
        "content-disposition",
        ~s(inline; filename="#{filename}")
      )
      |> send_resp(200, bytes)
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- helpers ---------------------------------------------------

  defp list_opts_from_params(params) do
    [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      search: params["search"],
      column_filter: params["column_filter"],
      status: params["status"],
      customer_id: params["customer_id"]
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

  defp conflict(conn, code, detail) do
    conn |> put_status(:conflict) |> json(Errors.payload(code, detail))
  end

  defp unprocessable(conn, code, detail) do
    conn |> put_status(:unprocessable_entity) |> json(Errors.payload(code, detail))
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
