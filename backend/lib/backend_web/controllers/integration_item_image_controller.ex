defmodule BackendWeb.IntegrationItemImageController do
  @moduledoc """
  Integration surface for pushing item photos from an upstream R&D
  system. Mirrors `BackendWeb.ItemImageController` verbatim except
  actor resolution comes from the integration token's `created_by_id`
  instead of a browser session.

  Idempotency lives on the caller side: NPD tracks a `psp_uuid` per
  formulation photo and only POSTs when it's null. Repeated pushes
  without dedupe would create duplicate rows — that's a caller bug,
  not a server-side concern.

  Routes:

      POST   /api/integration/items/:item_uuid/images   — multipart
      DELETE /api/integration/items/:item_uuid/images/:id
  """

  use BackendWeb, :controller

  import BackendWeb.IntegrationScopePlug

  alias Backend.Accounts.User
  alias Backend.Items
  alias Backend.Items.Images
  alias Backend.Repo
  alias BackendWeb.Payloads

  plug :require_integration_scope, "item:files:write"
       when action in [:create, :delete]

  action_fallback BackendWeb.FallbackController

  def create(conn, %{"item_uuid" => item_uuid} = params) do
    company_id = conn.assigns.current_company_id
    token = conn.assigns.current_integration_token

    with {:ok, %User{} = actor} <- fetch_actor(token),
         %{} = item <- Items.get_for_company(company_id, item_uuid),
         %Plug.Upload{} = upload <- Map.get(params, "file") do
      case Images.attach(actor, item, upload) do
        {:ok, image} ->
          conn
          |> put_status(:created)
          |> json(%{image: Payloads.item_image(image)})

        {:error, :too_many} ->
          error(conn, :unprocessable_entity, "too_many_images",
            "Up to #{Images.max_per_item()} images per item.")

        {:error, {:invalid_mime, mime}} ->
          error(conn, :unprocessable_entity, "invalid_mime_type",
            "Unsupported file type#{if mime, do: " (#{mime})", else: ""}.")

        {:error, {:too_large, bytes}} ->
          mb = Float.round(bytes / 1024 / 1024, 1)
          max_mb = Float.round(Images.max_bytes() / 1024 / 1024, 1)

          error(conn, :unprocessable_entity, "file_too_large",
            "File is #{mb} MB; max allowed is #{max_mb} MB.")

        {:error, %Ecto.Changeset{} = cs} ->
          error(conn, :unprocessable_entity, "validation_failed", format_changeset(cs))

        {:error, other} ->
          error(conn, :internal_server_error, "upload_failed", inspect(other))
      end
    else
      nil ->
        error(conn, :not_found, "item_not_found", "no matching item for this company")

      {:error, code, detail} ->
        error(conn, :unprocessable_entity, code, detail)

      _ ->
        error(conn, :bad_request, "missing_file",
          "Expected a `file` part in the multipart payload.")
    end
  end

  def delete(conn, %{"item_uuid" => item_uuid, "id" => image_uuid}) do
    company_id = conn.assigns.current_company_id
    token = conn.assigns.current_integration_token

    with {:ok, %User{} = actor} <- fetch_actor(token),
         %{} = item <- Items.get_for_company(company_id, item_uuid),
         %{} = image <- Images.get_for_item(item.id, image_uuid),
         {:ok, _} <- Images.delete(actor, image) do
      send_resp(conn, :no_content, "")
    else
      nil ->
        error(conn, :not_found, "not_found", "no matching item or image")

      {:error, code, detail} ->
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
