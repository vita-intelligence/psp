defmodule BackendWeb.IntegrationItemFileController do
  @moduledoc """
  Integration surface for pushing item files (compliance artifacts:
  spec sheets, DoCs, migration test reports, …) from an upstream R&D
  system. Mirrors `BackendWeb.ItemFileController` verbatim except
  actor resolution comes from the integration token's `created_by_id`.

  Idempotency lives on the caller side: NPD tracks a `psp_uuid` per
  formulation file and only POSTs when it's null.

  Routes:

      POST   /api/integration/items/:item_uuid/files   — multipart
      DELETE /api/integration/items/:item_uuid/files/:id
  """

  use BackendWeb, :controller

  import BackendWeb.IntegrationScopePlug

  alias Backend.{Items, Storage}
  alias Backend.Accounts.User
  alias Backend.Repo
  alias BackendWeb.Payloads

  @allowed_evidence_mimes ~w(application/pdf image/jpeg image/png image/webp
                             application/msword
                             application/vnd.openxmlformats-officedocument.wordprocessingml.document
                             application/vnd.ms-excel
                             application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
                             text/plain)
  @max_evidence_bytes 20 * 1024 * 1024

  plug :require_integration_scope, "item:files:write"
       when action in [:create, :delete]

  action_fallback BackendWeb.FallbackController

  def create(conn, %{"item_uuid" => item_uuid, "file" => %Plug.Upload{} = upload} = params) do
    company_id = conn.assigns.current_company_id
    token = conn.assigns.current_integration_token
    kind = params["kind"] || "other"

    with {:ok, %User{} = actor} <- fetch_actor(token),
         %{} = item <- Items.get_for_company(company_id, item_uuid),
         :ok <- validate_mime(upload.content_type),
         {:ok, bytes} <- read_upload(upload),
         :ok <- validate_size(bytes),
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
              error(conn, :unprocessable_entity, "validation_failed", format_changeset(cs))
          end

        {:error, reason} ->
          error(conn, :unprocessable_entity, "storage_failed", inspect(reason))
      end
    else
      nil ->
        error(conn, :not_found, "item_not_found", "no matching item for this company")

      {:error, code, detail} when is_binary(code) ->
        error(conn, :unprocessable_entity, code, detail)

      {:error, {:invalid_mime, detail}} ->
        error(conn, :unprocessable_entity, "invalid_mime_type", detail)

      {:error, {:too_large, bytes}} ->
        mb = Float.round(bytes / 1024 / 1024, 1)
        max_mb = Float.round(@max_evidence_bytes / 1024 / 1024, 1)

        error(conn, :unprocessable_entity, "file_too_large",
          "File is #{mb} MB; max allowed is #{max_mb} MB.")

      {:error, {:read_failed, reason}} ->
        error(conn, :unprocessable_entity, "read_failed", inspect(reason))
    end
  end

  def create(conn, _params) do
    error(conn, :bad_request, "missing_file",
      "Expected a `file` part in the multipart payload.")
  end

  def delete(conn, %{"item_uuid" => item_uuid, "id" => file_uuid}) do
    company_id = conn.assigns.current_company_id
    token = conn.assigns.current_integration_token

    with {:ok, %User{} = actor} <- fetch_actor(token),
         %{} = item <- Items.get_for_company(company_id, item_uuid),
         %{} = file <- Items.get_file(item.id, file_uuid),
         {:ok, _} <- Items.delete_file(actor, file) do
      send_resp(conn, :no_content, "")
    else
      nil ->
        error(conn, :not_found, "not_found", "no matching item or file")

      {:error, code, detail} when is_binary(code) ->
        error(conn, :unprocessable_entity, code, detail)

      _ ->
        error(conn, :internal_server_error, "delete_failed", nil)
    end
  end

  # ---- internals ----

  defp fetch_actor(%{created_by_id: nil}), do: {:error, "actor_missing", nil}

  defp fetch_actor(%{created_by_id: id}) do
    case Repo.get(User, id) do
      %User{} = user -> {:ok, user}
      _ -> {:error, "actor_missing", nil}
    end
  end

  defp validate_mime(mime) when mime in @allowed_evidence_mimes, do: :ok

  defp validate_mime(mime) do
    {:error,
     {:invalid_mime,
      "Unsupported file type (#{mime || "unknown"}). Allowed: PDF, images, Word, Excel, plain text."}}
  end

  defp validate_size(bytes) when byte_size(bytes) > @max_evidence_bytes do
    {:error, {:too_large, byte_size(bytes)}}
  end

  defp validate_size(_), do: :ok

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

  defp format_changeset(%Ecto.Changeset{errors: errors}) do
    errors
    |> Enum.map(fn {field, {msg, _}} -> "#{field}: #{msg}" end)
    |> Enum.join("; ")
  end

  defp error(conn, status, code, detail) do
    conn
    |> put_status(status)
    |> json(%{error: code, detail: detail})
  end
end
