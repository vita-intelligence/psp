defmodule BackendWeb.ProcurementInvoiceController do
  @moduledoc """
  Vendor invoices against POs — the AP ledger.

  RBAC:
    * `procurement.invoice_view`    — list, show, serve_file
    * `procurement.invoice_manage`  — create, update, delete, dispute,
                                       void, attach_file, detach_file
    * `procurement.invoice_approve` — mark_paid
  """

  use BackendWeb, :controller

  alias Backend.Procurement
  alias Backend.Procurement.Invoice
  alias Backend.Purchasing
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  # PDFs + spreadsheets — same allow-list rationale as PO file uploads.
  @allowed_mimes ~w(application/pdf image/jpeg image/png image/webp
                    application/msword
                    application/vnd.openxmlformats-officedocument.wordprocessingml.document
                    application/vnd.ms-excel
                    application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
                    text/plain)
  @max_bytes 20 * 1024 * 1024

  plug RequirePermission, "procurement.invoice_view"
       when action in [
              :index_for_po,
              :index_global,
              :show,
              :serve_file
            ]

  plug RequirePermission, "procurement.invoice_manage"
       when action in [
              :create,
              :update,
              :delete,
              :mark_disputed,
              :mark_void,
              :attach_file,
              :detach_file
            ]

  plug RequirePermission, "procurement.invoice_approve"
       when action in [:mark_paid]

  action_fallback BackendWeb.FallbackController

  # ----- per-PO ----------------------------------------------------

  def index_for_po(conn, %{"purchase_order_id" => uuid}) do
    actor = conn.assigns.current_user

    case Purchasing.get_for_company(actor.company_id, uuid) do
      nil ->
        {:error, :not_found}

      po ->
        items = Procurement.list_for_po(po.id)
        json(conn, %{items: Enum.map(items, &Payloads.procurement_invoice/1)})
    end
  end

  def create(conn, %{"purchase_order_id" => po_uuid} = params) do
    actor = conn.assigns.current_user

    with %_{} = po <- Purchasing.get_for_company(actor.company_id, po_uuid),
         {:ok, invoice} <- Procurement.create(actor, po, Map.drop(params, ["purchase_order_id"])) do
      conn
      |> put_status(:created)
      |> json(%{invoice: Payloads.procurement_invoice(invoice)})
    else
      nil -> {:error, :not_found}
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  # ----- global ----------------------------------------------------

  def index_global(conn, params) do
    actor = conn.assigns.current_user

    opts =
      [
        cursor: params["cursor"],
        limit: params["limit"],
        search: params["search"],
        column_filter: params["column_filter"],
        status: params["status"],
        vendor_id: parse_int(params["vendor_id"]),
        purchase_order_id: parse_int(params["purchase_order_id"]),
        from_date: parse_date(params["from_date"]),
        to_date: parse_date(params["to_date"])
      ]
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)

    {items, next_cursor} = Procurement.list_page(actor.company_id, opts)
    totals = Procurement.totals_by_currency(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.procurement_invoice/1),
      totals: totals,
      next_cursor: next_cursor
    })
  end

  # ----- show / update / delete ------------------------------------

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Procurement.get_for_company(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      invoice -> json(conn, %{invoice: Payloads.procurement_invoice(invoice)})
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %Invoice{} = invoice <- Procurement.get_for_company(actor.company_id, uuid),
         {:ok, updated} <- Procurement.update_invoice(actor, invoice, Map.drop(params, ["id"])) do
      json(conn, %{invoice: Payloads.procurement_invoice(updated)})
    else
      nil -> {:error, :not_found}
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %Invoice{} = invoice <- Procurement.get_for_company(actor.company_id, uuid),
         {:ok, _} <- Procurement.delete(actor, invoice) do
      send_resp(conn, :no_content, "")
    else
      nil -> {:error, :not_found}
      {:error, _reason} -> {:error, :not_found}
    end
  end

  # ----- transitions -----------------------------------------------

  def mark_paid(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %Invoice{} = invoice <- Procurement.get_for_company(actor.company_id, uuid),
         {:ok, updated} <- Procurement.mark_paid(actor, invoice, params["paid_amount"]) do
      json(conn, %{invoice: Payloads.procurement_invoice(updated)})
    else
      nil -> {:error, :not_found}
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def mark_disputed(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %Invoice{} = invoice <- Procurement.get_for_company(actor.company_id, uuid),
         {:ok, updated} <- Procurement.mark_disputed(actor, invoice, params["notes"] || "") do
      json(conn, %{invoice: Payloads.procurement_invoice(updated)})
    else
      nil -> {:error, :not_found}
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def mark_void(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %Invoice{} = invoice <- Procurement.get_for_company(actor.company_id, uuid),
         {:ok, updated} <- Procurement.mark_void(actor, invoice, params["notes"]) do
      json(conn, %{invoice: Payloads.procurement_invoice(updated)})
    else
      nil -> {:error, :not_found}
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  # ----- file ------------------------------------------------------

  # File.read on upload.path — Plug.Upload places uploads in a
  # tmp dir it controls, not one derived from the request payload.
  # Safe by construction of Plug.Parsers.MULTIPART.
  def attach_file(conn, %{"id" => uuid, "file" => %Plug.Upload{} = upload}) do
    actor = conn.assigns.current_user

    with %Invoice{} = invoice <- Procurement.get_for_company(actor.company_id, uuid),
         :ok <- validate_mime(upload.content_type || "application/octet-stream"),
         {:ok, bytes} <- File.read(upload.path),
         :ok <- validate_size(bytes),
         :ok <- Backend.Http.UploadValidation.verify_bytes(bytes, upload.content_type),
         {:ok, updated} <-
           Procurement.attach_file(actor, invoice, %{
             filename: upload.filename,
             mime: upload.content_type || "application/octet-stream",
             bytes: bytes
           }) do
      json(conn, %{invoice: Payloads.procurement_invoice(updated)})
    else
      nil -> {:error, :not_found}
      {:error, :too_large} -> file_too_large(conn)
      {:error, :bad_mime} -> bad_mime(conn)
      {:error, {:invalid_mime, detail}} -> unprocessable(conn, "invalid_mime_type", detail)
      {:error, {:storage_failed, _}} -> storage_error(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def attach_file(conn, _params), do: unprocessable(conn, "missing_file", "Upload a file.")

  def detach_file(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %Invoice{} = invoice <- Procurement.get_for_company(actor.company_id, uuid),
         {:ok, updated} <- Procurement.detach_file(actor, invoice) do
      json(conn, %{invoice: Payloads.procurement_invoice(updated)})
    else
      nil -> {:error, :not_found}
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  # See vendor_controller.serve_file/2 for the safety rationale.
  def serve_file(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %Invoice{file_blob_path: blob} = invoice when not is_nil(blob) <-
           Procurement.get_for_company(actor.company_id, uuid),
         abs_path = Backend.Storage.Local.absolute_path(blob),
         true <- File.exists?(abs_path) do
      conn
      |> put_resp_content_type(invoice.file_mime || "application/octet-stream")
      |> put_resp_header(
        "content-disposition",
        Backend.Http.ContentDisposition.header(
          :inline,
          invoice.file_filename || "invoice.pdf"
        )
      )
      |> send_file(200, abs_path)
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- helpers ---------------------------------------------------

  defp validate_mime(mime) when mime in @allowed_mimes, do: :ok
  defp validate_mime(_), do: {:error, :bad_mime}

  defp validate_size(bytes) when byte_size(bytes) > @max_bytes, do: {:error, :too_large}
  defp validate_size(_), do: :ok

  defp parse_int(nil), do: nil
  defp parse_int(""), do: nil

  defp parse_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {n, _} -> n
      :error -> nil
    end
  end

  defp parse_int(v) when is_integer(v), do: v

  defp parse_date(nil), do: nil
  defp parse_date(""), do: nil

  defp parse_date(v) when is_binary(v) do
    case Date.from_iso8601(v) do
      {:ok, d} -> d
      _ -> nil
    end
  end

  defp parse_date(_), do: nil

  defp file_too_large(conn),
    do:
      conn
      |> put_status(:unprocessable_entity)
      |> json(Errors.payload("file_too_large", "File must be 20 MB or smaller."))

  defp bad_mime(conn),
    do:
      conn
      |> put_status(:unprocessable_entity)
      |> json(
        Errors.payload(
          "bad_mime",
          "Unsupported file type. PDFs, images, Word, Excel or plain text only."
        )
      )

  defp storage_error(conn),
    do:
      conn
      |> put_status(:bad_gateway)
      |> json(Errors.payload("storage_failed", "Couldn't save the file. Try again."))

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
