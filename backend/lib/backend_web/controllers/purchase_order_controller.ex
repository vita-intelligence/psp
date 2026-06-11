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

  # Same allow list as the vendor evidence upload — PDF, images,
  # Word, Excel, plain text. PO quotes are usually PDFs from the
  # supplier; spec sheets sometimes ship as Word / Excel.
  @allowed_evidence_mimes ~w(application/pdf image/jpeg image/png image/webp
                             application/msword
                             application/vnd.openxmlformats-officedocument.wordprocessingml.document
                             application/vnd.ms-excel
                             application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
                             text/plain)
  @max_evidence_bytes 20 * 1024 * 1024

  plug RequirePermission, "procurement.po_view"
       when action in [:index, :show, :serve_file]
  plug RequirePermission, "procurement.po_create"
       when action in [
              :create,
              :update,
              :delete,
              :add_line,
              :update_line,
              :delete_line,
              :cancel,
              :suggest_price,
              :upload_file,
              :delete_file
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

  @doc """
  Create a PO. The single-page create form posts the header + an
  optional `lines: [...]` array in one shot — we route through
  `Purchasing.create_with_lines/3` so the whole thing lands atomically
  and totals get recomputed at the end. Without `lines` (or an empty
  list) we fall back to the v1 behaviour: an empty draft.
  """
  def create(conn, params) do
    actor = conn.assigns.current_user
    {lines_attrs, header_attrs} = Map.pop(Map.drop(params, ["id"]), "lines")

    case create_dispatch(actor, header_attrs, lines_attrs) do
      {:ok, po} ->
        conn
        |> put_status(:created)
        |> json(%{purchase_order: Payloads.purchase_order(po)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  defp create_dispatch(actor, header_attrs, nil),
    do: Purchasing.create(actor, actor.company_id, header_attrs)

  defp create_dispatch(actor, header_attrs, []),
    do: Purchasing.create(actor, actor.company_id, header_attrs)

  defp create_dispatch(actor, header_attrs, lines_attrs) when is_list(lines_attrs) do
    attrs = Map.put(header_attrs, "company_id", actor.company_id)
    Purchasing.create_with_lines(actor, attrs, lines_attrs)
  end

  defp create_dispatch(actor, header_attrs, _),
    do: Purchasing.create(actor, actor.company_id, header_attrs)

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

  def submit(conn, %{"purchase_order_id" => uuid}) do
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

  def sign_approver(conn, %{"purchase_order_id" => uuid} = params) do
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

  def sign_director(conn, %{"purchase_order_id" => uuid} = params) do
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

  def mark_ordered(conn, %{"purchase_order_id" => uuid}) do
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

  def receive(conn, %{"purchase_order_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, uuid) do
      case Purchasing.receive_against_po(actor, po, Map.drop(params, ["purchase_order_id"])) do
        {:ok, updated} ->
          json(conn, %{purchase_order: Payloads.purchase_order(updated)})

        {:error, :bad_status} ->
          conflict(conn, "bad_status", "Only ordered POs can receive stock.")

        {:error, :no_lines} ->
          unprocessable(conn, "no_lines", "Send at least one line entry (even if its packs list is empty).")

        {:error, :warehouse_required} ->
          unprocessable(conn, "warehouse_required", "warehouse_id is required on the receive payload.")

        {:error, :legacy_shape_unsupported} ->
          unprocessable(
            conn,
            "legacy_shape_unsupported",
            "Receive payload must use the per-pack shape: lines: [{line_uuid, packs: [...]}]."
          )

        {:error, {:bad_line_uuid, line_uuid}} ->
          unprocessable(conn, "bad_line_uuid", "Line #{line_uuid || "(unknown)"} doesn't belong to this PO.")

        {:error, {:line_locked, line_uuid}} ->
          unprocessable(conn, "line_locked", "Line #{line_uuid} is already received or cancelled.")

        {:error, {:over_receipt, line_uuid}} ->
          unprocessable(
            conn,
            "over_receipt",
            "Sum of pack qtys for line #{line_uuid} exceeds the line's remaining qty."
          )

        {:error, {:non_positive_qty, idx}} ->
          unprocessable(
            conn,
            "non_positive_qty",
            "Pack ##{idx + 1} has a non-positive qty — qty must be > 0."
          )

        {:error, {:non_positive_dim, idx}} ->
          unprocessable(
            conn,
            "non_positive_dim",
            "Pack ##{idx + 1} has a non-positive packaging dimension — length, width, height, weight, units_per_package, stack_factor must all be > 0."
          )

        {:error, {:lot_create_failed, line_uuid, idx, reason}} ->
          unprocessable(
            conn,
            "lot_create_failed",
            "Couldn't create lot for line #{line_uuid} pack ##{idx + 1}: #{inspect(reason)}"
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def cancel(conn, %{"purchase_order_id" => uuid} = params) do
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

  # ----- file attachments ------------------------------------------

  @doc """
  Multipart upload for a PO evidence file (vendor quote, spec sheet).
  Bytes go to `Backend.Storage`; we record a metadata row + return
  the file shape the FE renders in the attachments card.
  """
  def upload_file(conn, %{"purchase_order_id" => uuid, "file" => %Plug.Upload{} = upload} = params) do
    actor = conn.assigns.current_user
    kind = params["kind"] || "other"

    with %{} = po <- Purchasing.get_for_company(actor.company_id, uuid),
         :ok <- validate_evidence_mime(upload.content_type),
         {:ok, bytes} <- read_upload(upload),
         :ok <- validate_evidence_size(bytes) do
      attrs = %{
        "kind" => kind,
        "filename" => upload.filename || "upload",
        "mime" => upload.content_type || "application/octet-stream",
        "byte_size" => byte_size(bytes)
      }

      case Purchasing.upload_file(actor, po, attrs, bytes) do
        {:ok, file} ->
          conn
          |> put_status(:created)
          |> json(%{file: Payloads.po_file(file, po)})

        {:error, {:storage_failed, reason}} ->
          unprocessable(
            conn,
            "storage_failed",
            "Couldn't store the file (#{inspect(reason)})."
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      nil -> {:error, :not_found}
      {:error, {:invalid_mime, detail}} -> unprocessable(conn, "invalid_mime_type", detail)
      {:error, {:too_large, bytes}} -> file_too_large(conn, bytes)
      {:error, {:read_failed, reason}} ->
        unprocessable(conn, "read_failed", "Couldn't read the upload: #{inspect(reason)}.")
    end
  end

  def upload_file(conn, _params) do
    unprocessable(conn, "missing_file", "Send the file under `file` (multipart).")
  end

  def delete_file(conn, %{"purchase_order_id" => po_uuid, "id" => file_uuid}) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, po_uuid),
         %{} = file <- Purchasing.get_file(po.id, file_uuid),
         {:ok, _} <- Purchasing.delete_file(actor, po, file) do
      send_resp(conn, :no_content, "")
    else
      _ -> {:error, :not_found}
    end
  end

  @doc """
  Stream a PO file back. Same path-resolver as the vendor evidence
  serve — local adapter reads from disk, cloud adapters would
  short-circuit to a signed URL upstream.
  """
  def serve_file(conn, %{"purchase_order_id" => po_uuid, "id" => file_uuid}) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, po_uuid),
         %{} = file <- Purchasing.get_file(po.id, file_uuid),
         abs_path = Backend.Storage.Local.absolute_path(file.blob_path),
         true <- File.exists?(abs_path) do
      conn
      |> put_resp_content_type(file.mime || "application/octet-stream")
      |> put_resp_header(
        "content-disposition",
        ~s|inline; filename="#{file.filename}"|
      )
      |> send_file(200, abs_path)
    else
      _ -> {:error, :not_found}
    end
  end

  defp validate_evidence_mime(mime) when mime in @allowed_evidence_mimes, do: :ok

  defp validate_evidence_mime(mime) do
    {:error,
     {:invalid_mime,
      "Unsupported file type (#{mime || "unknown"}). Allowed: PDF, images, Word, Excel, plain text."}}
  end

  defp validate_evidence_size(bytes) when byte_size(bytes) > @max_evidence_bytes do
    {:error, {:too_large, byte_size(bytes)}}
  end

  defp validate_evidence_size(_), do: :ok

  defp read_upload(%Plug.Upload{path: path}) do
    case File.read(path) do
      {:ok, bytes} -> {:ok, bytes}
      {:error, reason} -> {:error, {:read_failed, reason}}
    end
  end

  defp file_too_large(conn, bytes) do
    mb = Float.round(bytes / 1024 / 1024, 1)
    max_mb = Float.round(@max_evidence_bytes / 1024 / 1024, 1)

    unprocessable(
      conn,
      "file_too_large",
      "File is #{mb} MB; max allowed is #{max_mb} MB."
    )
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
