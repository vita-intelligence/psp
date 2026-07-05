defmodule BackendWeb.ItemFileController do
  @moduledoc """
  Item-scoped file uploads (spec sheets, food-contact DoCs, migration
  test reports, …). Same pattern as `BackendWeb.VendorController`'s
  `upload_file` + `serve_file`: bytes go into `Backend.Storage`, a
  metadata row backs them, the per-type compliance subtable carries
  an FK to the row this returns.

  RBAC:
    * `items.view` — serve (anyone who can read the item can fetch
      its evidence)
    * `items.edit` — upload
  """

  use BackendWeb, :controller

  alias Backend.{Items, Storage}
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  @allowed_evidence_mimes ~w(application/pdf image/jpeg image/png image/webp
                             application/msword
                             application/vnd.openxmlformats-officedocument.wordprocessingml.document
                             application/vnd.ms-excel
                             application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
                             text/plain)
  @max_evidence_bytes 20 * 1024 * 1024

  plug RequirePermission, "items.view" when action in [:serve_file]
  plug RequirePermission, "items.edit" when action in [:upload_file]

  action_fallback BackendWeb.FallbackController

  def upload_file(conn, %{"item_id" => uuid, "file" => %Plug.Upload{} = upload} = params) do
    actor = conn.assigns.current_user
    kind = params["kind"] || "other"

    with %{} = item <- Items.get_for_company(actor.company_id, uuid),
         :ok <- validate_evidence_mime(upload.content_type),
         {:ok, bytes} <- read_upload(upload),
         :ok <- validate_evidence_size(bytes),
         :ok <- Backend.Http.UploadValidation.verify_bytes(bytes, upload.content_type) do
      key = build_storage_key(item, kind, upload)

      case Storage.put(key, bytes, content_type: upload.content_type) do
        {:ok, blob_path} ->
          attrs = %{
            "kind" => kind,
            "filename" => upload.filename || "upload",
            "mime" => upload.content_type || "application/octet-stream",
            "byte_size" => byte_size(bytes),
            "blob_path" => blob_path
          }

          case Items.record_file(actor, item, attrs) do
            {:ok, file} ->
              conn
              |> put_status(:created)
              |> json(%{file: Payloads.item_file(file, item)})

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)
          end

        {:error, reason} ->
          unprocessable(conn, "storage_failed",
            "Couldn't store the file (#{inspect(reason)}).")
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

  # See vendor_controller.serve_file/2 for the safety rationale.
  def serve_file(conn, %{"item_id" => item_uuid, "id" => file_uuid}) do
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, item_uuid),
         %{} = file <- Items.get_file(item.id, file_uuid),
         abs_path = Backend.Storage.Local.absolute_path(file.blob_path),
         true <- File.exists?(abs_path) do
      conn
      |> put_resp_content_type(file.mime || "application/octet-stream")
      |> put_resp_header(
        "content-disposition",
        Backend.Http.ContentDisposition.header(:inline, file.filename)
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

  # File.read on upload.path — Plug.Upload's tmp path is server-owned.
  defp read_upload(%Plug.Upload{path: path}) do
    case File.read(path) do
      {:ok, bytes} -> {:ok, bytes}
      {:error, reason} -> {:error, {:read_failed, reason}}
    end
  end

  defp build_storage_key(item, kind, %Plug.Upload{filename: filename}) do
    "item_files/" <> item.uuid <> "/" <> kind <> "_" <>
      Ecto.UUID.generate() <> extension_for(filename)
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

    unprocessable(conn, "file_too_large",
      "File is #{mb} MB; max allowed is #{max_mb} MB.")
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: code, detail: detail})
  end

  defp changeset_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{
      error: "validation_failed",
      detail: "Please correct the highlighted fields.",
      fields: BackendWeb.Errors.changeset_fields(cs)
    })
  end
end
