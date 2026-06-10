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

  alias Backend.{Storage, Vendors}
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  @allowed_evidence_mimes ~w(application/pdf image/jpeg image/png image/webp
                             application/msword
                             application/vnd.openxmlformats-officedocument.wordprocessingml.document
                             application/vnd.ms-excel
                             application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
                             text/plain)
  @max_evidence_bytes 20 * 1024 * 1024

  plug RequirePermission, "vendors.view"
       when action in [:index, :show, :serve_file]
  plug RequirePermission, "vendors.create" when action in [:create]
  plug RequirePermission, "vendors.edit"
       when action in [
              :update,
              :update_qualification,
              :upload_file,
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

  def update_approval(conn, %{"vendor_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, uuid) do
      case Vendors.approve_vendor(actor, vendor, Map.drop(params, ["vendor_id"])) do
        {:ok, updated} ->
          json(conn, %{vendor: Payloads.vendor(updated)})

        {:error, {:qualification_incomplete, missing}} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{
            error: "qualification_incomplete",
            detail:
              "Vendor can't be approved yet — " <>
                Enum.map_join(missing, "; ", & &1.label),
            missing: missing
          })

        {:error, :same_signer_as_qualifier} ->
          conn
          |> put_status(:conflict)
          |> json(
            Errors.payload(
              "same_signer_as_qualifier",
              "Segregation of duties — the person who collected the qualification evidence can't also sign it off. Get a different reviewer."
            )
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def update_qualification(conn, %{"vendor_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, uuid) do
      case Vendors.update_qualification(actor, vendor, Map.drop(params, ["vendor_id"])) do
        {:ok, updated} -> json(conn, %{vendor: Payloads.vendor(updated)})
        {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- evidence file upload + serve ------------------------------

  @doc """
  Multipart upload for vendor evidence (SAQ / audit report / COA /
  cert PDF). Bytes go to `Backend.Storage`; we record a metadata row
  + the FE then writes the returned `file_id` onto whichever artifact
  field (`saq_file_id`, `audit_file_id`, `coa_file_id`,
  `document_file_id` on a cert).

  Stored separately on purpose: the upload happens first, the
  qualification / cert PUT happens second — that keeps the two
  endpoints idempotent and lets the FE retry a failed wire without
  losing the bytes.
  """
  def upload_file(conn, %{"vendor_id" => uuid, "file" => %Plug.Upload{} = upload} = params) do
    actor = conn.assigns.current_user
    kind = params["kind"] || "other"

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, uuid),
         :ok <- validate_evidence_mime(upload.content_type),
         {:ok, bytes} <- read_upload(upload),
         :ok <- validate_evidence_size(bytes) do
      key = build_storage_key(vendor, kind, upload)

      case Storage.put(key, bytes, content_type: upload.content_type) do
        {:ok, blob_path} ->
          attrs = %{
            "kind" => kind,
            "filename" => upload.filename || "upload",
            "mime" => upload.content_type || "application/octet-stream",
            "byte_size" => byte_size(bytes),
            "blob_path" => blob_path
          }

          case Vendors.record_file(actor, vendor, attrs) do
            {:ok, file} ->
              conn
              |> put_status(:created)
              |> json(%{file: Payloads.vendor_file(file, vendor)})

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)
          end

        {:error, reason} ->
          unprocessable(
            conn,
            "storage_failed",
            "Couldn't store the file (#{inspect(reason)})."
          )
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

  @doc """
  Stream an evidence file back. Reuses the local-adapter path
  resolver — the cloud adapter would short-circuit to a signed URL
  upstream and this route would be hit only for local dev.
  """
  def serve_file(conn, %{"vendor_id" => vendor_uuid, "id" => file_uuid}) do
    actor = conn.assigns.current_user

    with %{} = vendor <- Vendors.get_for_company(actor.company_id, vendor_uuid),
         %{} = file <- Vendors.get_file(vendor.id, file_uuid),
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

  defp build_storage_key(vendor, kind, %Plug.Upload{filename: filename}) do
    "vendor_files/" <>
      vendor.uuid <>
      "/" <>
      kind <>
      "_" <>
      Ecto.UUID.generate() <>
      extension_for(filename)
  end

  defp extension_for(nil), do: ""

  defp extension_for(filename) when is_binary(filename) do
    case Path.extname(filename) do
      "" -> ""
      ext -> String.downcase(ext)
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
