defmodule BackendWeb.ItemImageController do
  @moduledoc """
  Per-item image attachments.

  Routes (nested under items):
    * `POST   /api/items/:item_uuid/images`               — multipart upload
    * `GET    /api/items/:item_uuid/images`               — list
    * `GET    /api/items/:item_uuid/images/:id/file`      — stream bytes
    * `PUT    /api/items/:item_uuid/images/:id`           — caption / sort_order
    * `PUT    /api/items/:item_uuid/images/:id/primary`   — mark as primary
    * `DELETE /api/items/:item_uuid/images/:id`           — delete (+ blob cleanup)

  RBAC: `items.view` for reads, `items.edit` for writes.
  """

  use BackendWeb, :controller

  alias Backend.Items
  alias Backend.Items.Images
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "items.view"
       when action in [:index, :serve_file]

  plug RequirePermission, "items.edit"
       when action in [:create, :update, :set_primary, :delete]

  action_fallback BackendWeb.FallbackController

  def index(conn, %{"item_id" => uuid}) do
    actor = conn.assigns.current_user

    case Items.get_for_company(actor.company_id, uuid) do
      nil ->
        {:error, :not_found}

      item ->
        images = Images.list_for_item(item.id)
        json(conn, %{items: Enum.map(images, &Payloads.item_image/1)})
    end
  end

  def create(conn, %{"item_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, uuid),
         %Plug.Upload{} = upload <- Map.get(params, "file") do
      case Images.attach(actor, item, upload) do
        {:ok, image} ->
          conn
          |> put_status(:created)
          |> json(%{image: Payloads.item_image(image)})

        {:error, :too_many} ->
          send_error(
            conn,
            :unprocessable_entity,
            "too_many_images",
            "Up to #{Images.max_per_item()} images per item. Delete one first."
          )

        {:error, {:invalid_mime, mime}} ->
          send_error(
            conn,
            :unprocessable_entity,
            "invalid_mime_type",
            "Unsupported file type#{if mime, do: " (#{mime})", else: ""}. Allowed: #{Enum.join(Images.allowed_mimes(), ", ")}."
          )

        {:error, {:too_large, bytes}} ->
          mb = Float.round(bytes / 1024 / 1024, 1)
          max_mb = Float.round(Images.max_bytes() / 1024 / 1024, 1)

          send_error(
            conn,
            :unprocessable_entity,
            "file_too_large",
            "File is #{mb} MB; max allowed is #{max_mb} MB."
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)

        {:error, other} ->
          send_error(
            conn,
            :internal_server_error,
            "upload_failed",
            "Couldn't save the upload: #{inspect(other)}."
          )
      end
    else
      nil ->
        {:error, :not_found}

      _ ->
        send_error(
          conn,
          :bad_request,
          "missing_file",
          "Expected a `file` part in the multipart payload."
        )
    end
  end

  def serve_file(conn, %{"item_id" => item_uuid, "id" => image_uuid}) do
    require Logger
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, item_uuid),
         %{} = image <- Images.get_for_item(item.id, image_uuid) do
      path = Backend.Storage.Local.absolute_path(image.blob_path)
      exists = File.exists?(path)

      Logger.info(
        "item_image serve_file: blob_path=#{inspect(image.blob_path)} resolved=#{inspect(path)} exists=#{exists}"
      )

      if exists do
        conn
        |> put_resp_header("content-type", image.content_type || "application/octet-stream")
        |> put_resp_header("cache-control", "private, max-age=300")
        |> send_file(200, path)
      else
        {:error, :not_found}
      end
    else
      nil ->
        Logger.warning(
          "item_image serve_file: lookup miss. item_uuid=#{inspect(item_uuid)} image_uuid=#{inspect(image_uuid)}"
        )

        {:error, :not_found}
    end
  end

  def update(conn, %{"item_id" => item_uuid, "id" => image_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, item_uuid),
         %{} = image <- Images.get_for_item(item.id, image_uuid),
         {:ok, updated} <-
           Images.update_metadata(actor, image, Map.drop(params, ["item_id", "id"])) do
      json(conn, %{image: Payloads.item_image(updated)})
    else
      nil ->
        {:error, :not_found}

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def set_primary(conn, %{"item_id" => item_uuid, "id" => image_uuid}) do
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, item_uuid),
         %{} = image <- Images.get_for_item(item.id, image_uuid),
         {:ok, updated} <- Images.set_primary(actor, image) do
      json(conn, %{image: Payloads.item_image(updated)})
    else
      _ -> {:error, :not_found}
    end
  end

  def delete(conn, %{"item_id" => item_uuid, "id" => image_uuid}) do
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, item_uuid),
         %{} = image <- Images.get_for_item(item.id, image_uuid),
         {:ok, _} <- Images.delete(actor, image) do
      send_resp(conn, :no_content, "")
    else
      _ -> {:error, :not_found}
    end
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

  defp send_error(conn, status, code, detail) do
    conn
    |> put_status(status)
    |> json(Errors.payload(code, detail))
  end
end
