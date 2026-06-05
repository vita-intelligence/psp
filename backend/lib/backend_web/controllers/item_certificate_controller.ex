defmodule BackendWeb.ItemCertificateController do
  @moduledoc """
  Per-item certificate attachments.

  Routes (nested under items):
    * `POST   /api/items/:item_uuid/certificates` — attach a new cert
    * `PUT    /api/items/:item_uuid/certificates/:id` — edit (renew etc.)
    * `DELETE /api/items/:item_uuid/certificates/:id` — detach

  RBAC: `items.edit` for all three. The cert registry itself is
  gated separately by `certificates.manage`.
  """

  use BackendWeb, :controller

  alias Backend.{Certificates, Items}
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "items.edit"

  action_fallback BackendWeb.FallbackController

  def create(conn, %{"item_id" => item_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, item_uuid),
         {:ok, att} <-
           Certificates.attach(actor, item, Map.drop(params, ["item_id", "id"])) do
      conn
      |> put_status(:created)
      |> json(%{item_certificate: Payloads.item_certificate(att)})
    else
      nil -> {:error, :not_found}
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def update(conn, %{"item_id" => item_uuid, "id" => att_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, item_uuid),
         %{} = att <- Certificates.get_attachment_for_item(item.id, att_uuid),
         {:ok, updated} <-
           Certificates.update_attachment(
             actor,
             att,
             Map.drop(params, ["item_id", "id"])
           ) do
      json(conn, %{item_certificate: Payloads.item_certificate(updated)})
    else
      nil -> {:error, :not_found}
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def delete(conn, %{"item_id" => item_uuid, "id" => att_uuid}) do
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, item_uuid),
         %{} = att <- Certificates.get_attachment_for_item(item.id, att_uuid),
         {:ok, _} <- Certificates.detach(actor, att) do
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
end
