defmodule BackendWeb.ShipmentController do
  @moduledoc """
  Outbound shipments — customer-facing dispatch record.

  Mount: `/api/shipments`.

    * `POST /`                  create draft from a lot uuid
    * `GET  /`                  paginated list
    * `GET  /:uuid`             single shipment (full detail)
    * `PATCH /:uuid`            edit draft / ready fields
    * `POST /:uuid/mark-ready`  draft → ready
    * `POST /:uuid/mark-draft`  ready → draft
    * `POST /:uuid/pickup`      ready → picked_up (placeholder)
    * `POST /:uuid/cancel`      cancel with reason
  """

  use BackendWeb, :controller

  alias Backend.Shipments
  alias Backend.Shipments.Shipment
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  # Split per persona:
  # - view (index / show): shipments.view — broad audience.
  # - edit (create + update + mark_ready + mark_draft + cancel):
  #   shipments.edit — paperwork side, shipping coordinator.
  # - pickup: shipments.pickup — physical truck-arrival event
  #   (placeholder button today; mobile arrival form lands here later).
  plug RequirePermission,
       "shipments.view"
       when action in [
              :index,
              :show,
              :list_pickup_files,
              :serve_pickup_file,
              :list_delivery_files,
              :serve_delivery_file
            ]

  plug RequirePermission,
       "shipments.edit"
       when action in [
              :create,
              :update,
              :mark_ready,
              :mark_draft,
              :cancel
            ]

  plug RequirePermission,
       "shipments.pickup" when action in [:pickup, :upload_pickup_file, :delete_pickup_file, :dispatch_push]

  plug RequirePermission,
       "shipments.confirm_delivery"
       when action in [
              :confirm_delivery,
              :upload_delivery_file,
              :delete_delivery_file
            ]

  action_fallback BackendWeb.FallbackController

  # -----------------------------------------------------------------
  # Create
  # -----------------------------------------------------------------
  def create(conn, %{"lot_uuid" => lot_uuid}) do
    actor = conn.assigns.current_user

    case Shipments.create_from_lot(actor, lot_uuid) do
      {:ok, shipment} ->
        preloaded = Shipments.get_shipment(actor.company_id, shipment.uuid)
        json(conn, %{shipment: Payloads.shipment(preloaded)})

      {:error, reason} ->
        shipment_error(conn, reason)
    end
  end

  def create(conn, _params),
    do: unprocessable(conn, "missing_field", "lot_uuid is required.")

  # -----------------------------------------------------------------
  # List
  # -----------------------------------------------------------------
  def index(conn, params) do
    actor = conn.assigns.current_user

    opts = [
      status: Map.get(params, "status", "all"),
      limit: parse_int(Map.get(params, "limit"), 25),
      cursor: Map.get(params, "cursor"),
      search: Map.get(params, "search"),
      column_filter: Map.get(params, "column_filter")
    ]

    {items, next_cursor} = Shipments.list_shipments(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.shipment/1),
      next_cursor: next_cursor
    })
  end

  # -----------------------------------------------------------------
  # Show
  # -----------------------------------------------------------------
  def show(conn, %{"uuid" => uuid}) do
    actor = conn.assigns.current_user

    case Shipments.get_shipment(actor.company_id, uuid) do
      nil -> not_found(conn, "Shipment not found.")
      shipment -> json(conn, %{shipment: Payloads.shipment(shipment)})
    end
  end

  # -----------------------------------------------------------------
  # Update
  # -----------------------------------------------------------------
  def update(conn, %{"uuid" => uuid} = params) do
    actor = conn.assigns.current_user
    attrs = Map.drop(params, ["uuid"])

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, uuid),
         {:ok, updated} <- Shipments.update(actor, shipment, attrs) do
      preloaded = Shipments.get_shipment(actor.company_id, updated.uuid)
      json(conn, %{shipment: Payloads.shipment(preloaded)})
    else
      nil -> not_found(conn, "Shipment not found.")
      {:error, reason} -> shipment_error(conn, reason)
    end
  end

  # -----------------------------------------------------------------
  # Lifecycle actions
  # -----------------------------------------------------------------
  def mark_ready(conn, %{"uuid" => uuid}) do
    lifecycle(conn, uuid, &Shipments.mark_ready/2)
  end

  def mark_draft(conn, %{"uuid" => uuid}) do
    lifecycle(conn, uuid, &Shipments.mark_draft/2)
  end

  def pickup(conn, %{"uuid" => uuid} = params) do
    actor = conn.assigns.current_user
    attrs = Map.drop(params, ["uuid"])

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, uuid),
         {:ok, updated} <- Shipments.confirm_pickup(actor, shipment, attrs) do
      preloaded = Shipments.get_shipment(actor.company_id, updated.uuid)
      json(conn, %{shipment: Payloads.shipment(preloaded)})
    else
      nil -> not_found(conn, "Shipment not found.")
      {:error, reason} -> shipment_error(conn, reason)
    end
  end

  # -----------------------------------------------------------------
  # Pickup file uploads (mobile dispatch form)
  # -----------------------------------------------------------------
  @pickup_allowed_mimes ~w(image/jpeg image/png image/webp image/heic image/heif)
  @pickup_max_bytes 15 * 1024 * 1024

  def upload_pickup_file(conn, %{"uuid" => uuid, "file" => %Plug.Upload{} = upload}) do
    actor = conn.assigns.current_user

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, uuid),
         :ok <- validate_pickup_mime(upload.content_type),
         {:ok, bytes} <- read_upload(upload),
         :ok <- validate_pickup_size(bytes),
         :ok <- Backend.Http.UploadValidation.verify_bytes(bytes, upload.content_type) do
      key = build_pickup_storage_key(shipment, upload)

      case Backend.Storage.put(key, bytes, content_type: upload.content_type) do
        {:ok, blob_path} ->
          attrs = %{
            "kind" => "photo",
            "filename" => upload.filename || "photo.jpg",
            "mime" => upload.content_type || "application/octet-stream",
            "byte_size" => byte_size(bytes),
            "blob_path" => blob_path
          }

          case Shipments.record_pickup_file(actor, shipment, attrs) do
            {:ok, file} ->
              conn
              |> put_status(:created)
              |> json(%{file: Payloads.shipment_pickup_file(file, shipment)})

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)
          end

        {:error, reason} ->
          unprocessable(conn, "storage_failed", "Couldn't store the photo (#{inspect(reason)}).")
      end
    else
      nil -> not_found(conn, "Shipment not found.")
      {:error, {:invalid_mime, detail}} -> unprocessable(conn, "invalid_mime_type", detail)
      {:error, {:too_large, bytes}} -> file_too_large(conn, bytes)
      {:error, {:read_failed, reason}} ->
        unprocessable(conn, "read_failed", "Couldn't read the upload: #{inspect(reason)}.")
    end
  end

  def upload_pickup_file(conn, _params) do
    unprocessable(conn, "missing_file", "Send the file under `file` (multipart).")
  end

  def list_pickup_files(conn, %{"uuid" => uuid}) do
    actor = conn.assigns.current_user

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, uuid) do
      files = Shipments.list_pickup_files(shipment)
      json(conn, %{files: Enum.map(files, &Payloads.shipment_pickup_file(&1, shipment))})
    else
      _ -> not_found(conn, "Shipment not found.")
    end
  end

  def serve_pickup_file(conn, %{"uuid" => shipment_uuid, "file_uuid" => file_uuid}) do
    actor = conn.assigns.current_user

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, shipment_uuid),
         %Backend.Shipments.ShipmentPickupFile{} = file <-
           Shipments.get_pickup_file(shipment.id, file_uuid),
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
      _ -> not_found(conn, "Photo not found.")
    end
  end

  # Desktop → phone push. The dispatch form only makes sense on a
  # phone (camera, on-the-dock ergonomics), so the desktop button
  # fans a `navigate` event out to every paired device the actor
  # owns. `MobileDeviceChannelProvider` in the `/m` layout is already
  # subscribed and calls `router.replace(payload.path)` — same wiring
  # the "Send to device" flow uses for POs / lots.
  def dispatch_push(conn, %{"uuid" => uuid}) do
    actor = conn.assigns.current_user

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, uuid),
         path = "/m/shipments/#{shipment.uuid}/dispatch",
         {:ok, devices} <- Backend.Devices.push_navigate_to_user(actor, path) do
      json(conn, %{ok: true, device_count: length(devices)})
    else
      nil -> not_found(conn, "Shipment not found.")
      {:error, :unsafe_path} ->
        unprocessable(conn, "invalid_path", "Refused to send an off-app path to the device.")

      {:error, other} ->
        unprocessable(conn, "dispatch_push_failed", inspect(other))
    end
  end

  def delete_pickup_file(conn, %{"uuid" => shipment_uuid, "file_uuid" => file_uuid}) do
    actor = conn.assigns.current_user

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, shipment_uuid),
         %Backend.Shipments.ShipmentPickupFile{} = file <-
           Shipments.get_pickup_file(shipment.id, file_uuid),
         {:ok, _} <- Shipments.delete_pickup_file(actor, file) do
      json(conn, %{ok: true})
    else
      _ -> not_found(conn, "Photo not found.")
    end
  end

  # -----------------------------------------------------------------
  # Delivery confirmation
  # -----------------------------------------------------------------
  def confirm_delivery(conn, %{"uuid" => uuid} = params) do
    actor = conn.assigns.current_user
    attrs = Map.drop(params, ["uuid"])

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, uuid),
         {:ok, updated} <- Shipments.confirm_delivery(actor, shipment, attrs) do
      preloaded = Shipments.get_shipment(actor.company_id, updated.uuid)
      json(conn, %{shipment: Payloads.shipment(preloaded)})
    else
      nil -> not_found(conn, "Shipment not found.")
      {:error, reason} -> shipment_error(conn, reason)
    end
  end

  # -----------------------------------------------------------------
  # Delivery-confirmation file uploads (POD, signed docket, damage)
  # -----------------------------------------------------------------
  @delivery_allowed_mimes ~w(image/jpeg image/png image/webp image/heic image/heif application/pdf)
  @delivery_max_bytes 20 * 1024 * 1024

  def upload_delivery_file(conn, %{"uuid" => uuid, "file" => %Plug.Upload{} = upload}) do
    actor = conn.assigns.current_user

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, uuid),
         :ok <- validate_delivery_mime(upload.content_type),
         {:ok, bytes} <- read_upload(upload),
         :ok <- validate_delivery_size(bytes),
         :ok <- Backend.Http.UploadValidation.verify_bytes(bytes, upload.content_type) do
      key = build_delivery_storage_key(shipment, upload)

      case Backend.Storage.put(key, bytes, content_type: upload.content_type) do
        {:ok, blob_path} ->
          attrs = %{
            "kind" => "photo",
            "filename" => upload.filename || "delivery",
            "mime" => upload.content_type || "application/octet-stream",
            "byte_size" => byte_size(bytes),
            "blob_path" => blob_path
          }

          case Shipments.record_delivery_file(actor, shipment, attrs) do
            {:ok, file} ->
              conn
              |> put_status(:created)
              |> json(%{file: Payloads.shipment_delivery_file(file, shipment)})

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)
          end

        {:error, reason} ->
          unprocessable(conn, "storage_failed", "Couldn't store the file (#{inspect(reason)}).")
      end
    else
      nil -> not_found(conn, "Shipment not found.")
      {:error, {:invalid_mime, detail}} -> unprocessable(conn, "invalid_mime_type", detail)
      {:error, {:too_large, bytes}} -> delivery_file_too_large(conn, bytes)
      {:error, {:read_failed, reason}} ->
        unprocessable(conn, "read_failed", "Couldn't read the upload: #{inspect(reason)}.")
    end
  end

  def upload_delivery_file(conn, _params) do
    unprocessable(conn, "missing_file", "Send the file under `file` (multipart).")
  end

  def list_delivery_files(conn, %{"uuid" => uuid}) do
    actor = conn.assigns.current_user

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, uuid) do
      files = Shipments.list_delivery_files(shipment)
      json(conn, %{files: Enum.map(files, &Payloads.shipment_delivery_file(&1, shipment))})
    else
      _ -> not_found(conn, "Shipment not found.")
    end
  end

  def serve_delivery_file(conn, %{"uuid" => shipment_uuid, "file_uuid" => file_uuid}) do
    actor = conn.assigns.current_user

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, shipment_uuid),
         %Backend.Shipments.ShipmentDeliveryFile{} = file <-
           Shipments.get_delivery_file(shipment.id, file_uuid),
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
      _ -> not_found(conn, "File not found.")
    end
  end

  def delete_delivery_file(conn, %{"uuid" => shipment_uuid, "file_uuid" => file_uuid}) do
    actor = conn.assigns.current_user

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, shipment_uuid),
         %Backend.Shipments.ShipmentDeliveryFile{} = file <-
           Shipments.get_delivery_file(shipment.id, file_uuid),
         {:ok, _} <- Shipments.delete_delivery_file(actor, file) do
      json(conn, %{ok: true})
    else
      _ -> not_found(conn, "File not found.")
    end
  end

  defp validate_delivery_mime(mime) when mime in @delivery_allowed_mimes, do: :ok

  defp validate_delivery_mime(mime) do
    {:error,
     {:invalid_mime,
      "Only images or PDFs are allowed for delivery (got #{mime || "unknown"})."}}
  end

  defp validate_delivery_size(bytes) when byte_size(bytes) > @delivery_max_bytes do
    {:error, {:too_large, byte_size(bytes)}}
  end

  defp validate_delivery_size(_), do: :ok

  defp build_delivery_storage_key(%Shipment{} = shipment, %Plug.Upload{filename: filename}) do
    "shipment_delivery_files/" <> shipment.uuid <> "/pod_" <>
      Ecto.UUID.generate() <> extension_for(filename)
  end

  defp delivery_file_too_large(conn, bytes) do
    mb = Float.round(bytes / 1024 / 1024, 1)
    max_mb = Float.round(@delivery_max_bytes / 1024 / 1024, 1)

    unprocessable(conn, "file_too_large", "File is #{mb} MB; max allowed is #{max_mb} MB.")
  end

  defp validate_pickup_mime(mime) when mime in @pickup_allowed_mimes, do: :ok

  defp validate_pickup_mime(mime) do
    {:error,
     {:invalid_mime,
      "Only images are allowed (got #{mime || "unknown"}). Take a photo with your camera."}}
  end

  defp validate_pickup_size(bytes) when byte_size(bytes) > @pickup_max_bytes do
    {:error, {:too_large, byte_size(bytes)}}
  end

  defp validate_pickup_size(_), do: :ok

  defp read_upload(%Plug.Upload{path: path}) do
    case File.read(path) do
      {:ok, bytes} -> {:ok, bytes}
      {:error, reason} -> {:error, {:read_failed, reason}}
    end
  end

  defp build_pickup_storage_key(%Shipment{} = shipment, %Plug.Upload{filename: filename}) do
    "shipment_pickup_files/" <> shipment.uuid <> "/photo_" <>
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
    max_mb = Float.round(@pickup_max_bytes / 1024 / 1024, 1)

    unprocessable(conn, "file_too_large", "Photo is #{mb} MB; max allowed is #{max_mb} MB.")
  end

  def cancel(conn, %{"uuid" => uuid} = params) do
    actor = conn.assigns.current_user

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, uuid),
         {:ok, updated} <- Shipments.cancel(actor, shipment, params["reason"]) do
      preloaded = Shipments.get_shipment(actor.company_id, updated.uuid)
      json(conn, %{shipment: Payloads.shipment(preloaded)})
    else
      nil -> not_found(conn, "Shipment not found.")
      {:error, reason} -> shipment_error(conn, reason)
    end
  end

  defp lifecycle(conn, uuid, fun) do
    actor = conn.assigns.current_user

    with %Shipment{} = shipment <- Shipments.get_shipment(actor.company_id, uuid),
         {:ok, updated} <- fun.(actor, shipment) do
      preloaded = Shipments.get_shipment(actor.company_id, updated.uuid)
      json(conn, %{shipment: Payloads.shipment(preloaded)})
    else
      nil -> not_found(conn, "Shipment not found.")
      {:error, reason} -> shipment_error(conn, reason)
    end
  end

  # -----------------------------------------------------------------
  # Error surface
  # -----------------------------------------------------------------
  defp shipment_error(conn, reason) do
    case reason do
      :forbidden ->
        conn
        |> put_status(:forbidden)
        |> json(Errors.payload("forbidden", "You lack production.final_release.", %{}))

      :lot_not_found ->
        not_found(conn, "Lot not found.")

      :pickup_photo_required ->
        unprocessable(conn, "pickup_photo_required",
          "At least one photo of the goods on the truck is required before confirming pickup.")

      :lot_not_in_dispatch ->
        unprocessable(conn, "lot_not_in_dispatch",
          "The lot isn't currently in a dispatch cell. Move it there before creating a shipment.")

      :already_open ->
        unprocessable(conn, "already_open",
          "There's already an open shipment on this lot. Finish or cancel it first.")

      :not_editable ->
        unprocessable(conn, "not_editable",
          "This shipment is already picked up or cancelled.")

      :not_cancelable ->
        unprocessable(conn, "not_cancelable",
          "Picked-up shipments can't be cancelled.")

      {:bad_status, got: got, expected: expected} ->
        unprocessable(conn, "bad_status",
          "This action needs status = #{expected}; the shipment is #{got}.")

      %Ecto.Changeset{} = cs ->
        changeset_error(conn, cs)

      other ->
        unprocessable(conn, "shipment_failed", inspect(other))
    end
  end

  # -----------------------------------------------------------------
  # Small helpers
  # -----------------------------------------------------------------
  defp not_found(conn, detail) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", detail, %{}))
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail, %{}))
  end

  defp changeset_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(
      Errors.payload(
        "validation_failed",
        "One or more fields failed validation.",
        %{fields: format_errors(cs)}
      )
    )
  end

  defp format_errors(cs) do
    Ecto.Changeset.traverse_errors(cs, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end

  defp parse_int(nil, default), do: default

  defp parse_int(v, default) when is_binary(v) do
    case Integer.parse(v) do
      {n, ""} -> n
      _ -> default
    end
  end

  defp parse_int(v, _default) when is_integer(v), do: v
  defp parse_int(_, default), do: default
end
