defmodule BackendWeb.IntegrationMovementPhotoController do
  @moduledoc """
  Movement-photo file serving for the vita-performance integration.

  The UI-facing `/api/stock/movement-photos/:uuid/file` endpoint is
  behind `stock.view` (JWT). The kiosk tablet has no JWT — it
  authenticates to PSP via the machine-to-machine integration bearer.
  This controller mirrors the file-serving logic (try three known
  extensions, stream the bytes) but plugs into the integration
  pipeline instead.

  Scope: ``mo:read`` — the photos surface as thumbnails on the BOM
  parts card of an MO the caller is already reading. No separate
  ``stock:read`` scope needed for this narrow use case.
  """

  use BackendWeb, :controller

  import BackendWeb.IntegrationScopePlug

  plug :require_integration_scope, "mo:read" when action in [:serve_file]

  action_fallback BackendWeb.FallbackController

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
    end) || {:error, :not_found}
  end

  defp content_type_for(".jpg"), do: "image/jpeg"
  defp content_type_for(".png"), do: "image/png"
  defp content_type_for(".webp"), do: "image/webp"
  defp content_type_for(_), do: "application/octet-stream"
end
