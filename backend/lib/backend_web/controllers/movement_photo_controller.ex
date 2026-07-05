defmodule BackendWeb.MovementPhotoController do
  @moduledoc """
  Movement photo upload — the mobile move flow POSTs a photo here
  before submitting the move so the URL can land on the movement
  row as part of the atomic write.

  Decoupled from movements themselves: the photo lives independently
  in `Backend.Storage` and the URL is stamped on the movement at
  create time. Orphan photos (operator uploaded, then cancelled) are
  rare enough to ignore; a periodic prune is straightforward later.

  RBAC: `stock.move` — same gate as the move endpoint itself.
  """

  use BackendWeb, :controller

  alias Backend.Storage
  alias BackendWeb.Errors
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "stock.move" when action in [:create]
  plug RequirePermission, "stock.view" when action in [:serve_file]

  action_fallback BackendWeb.FallbackController

  @allowed_mimes ~w(image/jpeg image/png image/webp)
  @max_bytes 8 * 1024 * 1024

  def create(conn, %{"file" => %Plug.Upload{} = upload}) do
    with :ok <- validate_mime(upload.content_type),
         {:ok, bytes} <- read_upload(upload),
         :ok <- validate_size(bytes),
         :ok <- Backend.Http.UploadValidation.verify_bytes(bytes, upload.content_type) do
      key =
        "movement_photos/" <>
          Ecto.UUID.generate() <>
          extension_for(upload.content_type)

      case Storage.put(key, bytes, content_type: upload.content_type) do
        {:ok, blob_path} ->
          url = Storage.public_url(blob_path)

          conn
          |> put_status(:created)
          |> json(%{photo_url: url, blob_path: blob_path})

        {:error, reason} ->
          send_error(
            conn,
            :internal_server_error,
            "storage_failed",
            "Couldn't store the photo (#{inspect(reason)})."
          )
      end
    end
  end

  def create(conn, _params) do
    send_error(conn, :bad_request, "missing_file", "Send the photo under `file`.")
  end

  @doc """
  Stream the photo bytes back. Used by the lot detail / movement
  history UI when it wants to show the operator's snapshot. Filenames
  on disk match `movement_photos/<uuid>.<ext>` so we try the three
  known extensions before giving up.
  """
  def serve_file(conn, %{"uuid" => uuid}) do
    extensions = [".jpg", ".png", ".webp"]

    Enum.find_value(extensions, fn ext ->
      blob_path = "movement_photos/" <> uuid <> ext
      absolute = Backend.Storage.Local.absolute_path(blob_path)

      if File.exists?(absolute) do
        conn
        |> put_resp_content_type(content_type_for(ext))
        |> send_file(200, absolute)
      end
    end) || send_error(conn, :not_found, "photo_not_found", "Photo not found.")
  end

  defp content_type_for(".jpg"), do: "image/jpeg"
  defp content_type_for(".png"), do: "image/png"
  defp content_type_for(".webp"), do: "image/webp"
  defp content_type_for(_), do: "application/octet-stream"

  defp validate_mime(mime) when mime in @allowed_mimes, do: :ok

  defp validate_mime(mime) do
    {:error,
     {:invalid_mime,
      "Photo must be one of: #{Enum.join(@allowed_mimes, ", ")} (got #{mime || "unknown"})."}}
  end

  defp read_upload(%Plug.Upload{path: path}) do
    case File.read(path) do
      {:ok, bytes} -> {:ok, bytes}
      {:error, reason} -> {:error, {:read_failed, reason}}
    end
  end

  defp validate_size(bytes) when byte_size(bytes) > @max_bytes do
    {:error, {:too_large, byte_size(bytes)}}
  end

  defp validate_size(_bytes), do: :ok

  defp extension_for("image/jpeg"), do: ".jpg"
  defp extension_for("image/png"), do: ".png"
  defp extension_for("image/webp"), do: ".webp"
  defp extension_for(_), do: ""

  def action_fallback_for_error(conn, {:error, {:invalid_mime, detail}}),
    do: send_error(conn, :unprocessable_entity, "invalid_mime_type", detail)

  def action_fallback_for_error(conn, {:error, {:too_large, bytes}}) do
    mb = Float.round(bytes / 1024 / 1024, 1)
    max_mb = Float.round(@max_bytes / 1024 / 1024, 1)

    send_error(
      conn,
      :unprocessable_entity,
      "file_too_large",
      "Photo is #{mb} MB; max allowed is #{max_mb} MB."
    )
  end

  defp send_error(conn, status, code, detail) do
    conn
    |> put_status(status)
    |> json(Errors.payload(code, detail))
  end
end
