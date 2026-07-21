defmodule BackendWeb.IntegrationItemCertificateController do
  @moduledoc """
  Integration surface for attaching / detaching per-item certificates
  from an upstream R&D system (NPD). Mirrors
  `BackendWeb.ItemCertificateController` verbatim except actor
  resolution comes from the integration token's `created_by_id`.

  Certificates on PSP are M:N with a company-scoped registry — NPD
  picks a cert UUID from `GET /api/integration/certificates` and
  attaches it here. The attachment carries optional per-copy fields
  (`certificate_number`, `valid_from`, `valid_until`) that mirror
  what the PSP item form captures.

  Idempotency lives on the caller side: NPD tracks a `psp_attachment_uuid`
  per formulation certificate and only POSTs when it's null.

  Routes:

      POST   /api/integration/items/:item_uuid/certificates
      DELETE /api/integration/items/:item_uuid/certificates/:id
  """

  use BackendWeb, :controller

  import BackendWeb.IntegrationScopePlug
  import Ecto.Query

  alias Backend.{Certificates, Items, Repo}
  alias Backend.Accounts.User
  alias Backend.Certificates.Certificate
  alias BackendWeb.Payloads

  plug :require_integration_scope, "item:files:write"
       when action in [:create, :delete]

  action_fallback BackendWeb.FallbackController

  def create(conn, %{"item_uuid" => item_uuid} = params) do
    company_id = conn.assigns.current_company_id
    token = conn.assigns.current_integration_token

    with {:ok, %User{} = actor} <- fetch_actor(token),
         %{} = item <- Items.get_for_company(company_id, item_uuid),
         {:ok, cert_id} <- resolve_certificate_id(company_id, params),
         attach_attrs = build_attach_attrs(params, cert_id),
         {:ok, att} <- Certificates.attach(actor, item, attach_attrs) do
      conn
      |> put_status(:created)
      |> json(%{item_certificate: Payloads.item_certificate(att)})
    else
      nil ->
        error(conn, :not_found, "item_not_found", "no matching item for this company")

      {:error, :certificate_not_found} ->
        error(conn, :not_found, "certificate_not_found",
          "no active certificate found for the supplied uuid")

      {:error, :missing_certificate_uuid} ->
        error(conn, :bad_request, "missing_certificate_uuid",
          "certificate_uuid is required")

      {:error, %Ecto.Changeset{} = cs} ->
        error(conn, :unprocessable_entity, "validation_failed", format_changeset(cs))

      {:error, code, detail} when is_binary(code) ->
        error(conn, :unprocessable_entity, code, detail)
    end
  end

  def delete(conn, %{"item_uuid" => item_uuid, "id" => att_uuid}) do
    company_id = conn.assigns.current_company_id
    token = conn.assigns.current_integration_token

    with {:ok, %User{} = actor} <- fetch_actor(token),
         %{} = item <- Items.get_for_company(company_id, item_uuid),
         %{} = att <- Certificates.get_attachment_for_item(item.id, att_uuid),
         {:ok, _} <- Certificates.detach(actor, att) do
      send_resp(conn, :no_content, "")
    else
      nil ->
        error(conn, :not_found, "not_found", "no matching item or attachment")

      {:error, code, detail} when is_binary(code) ->
        error(conn, :unprocessable_entity, code, detail)

      _ ->
        error(conn, :internal_server_error, "detach_failed", nil)
    end
  end

  # ---- internals ----

  # NPD calls in with the certificate's UUID (not the internal integer
  # id). Look it up + resolve to the id `Certificates.attach/3` wants.
  # Guard on `company_id` so a caller can't attach another tenant's
  # certificate to their own item.
  defp resolve_certificate_id(company_id, %{"certificate_uuid" => uuid})
       when is_binary(uuid) and uuid != "" do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        case Repo.one(
               from c in Certificate,
                 where:
                   c.company_id == ^company_id and c.uuid == ^cast and c.is_active == true,
                 select: c.id
             ) do
          nil -> {:error, :certificate_not_found}
          id -> {:ok, id}
        end

      :error ->
        {:error, :certificate_not_found}
    end
  end

  defp resolve_certificate_id(_company_id, _params),
    do: {:error, :missing_certificate_uuid}

  # Optional fields — attach/2 tolerates nil, so pass through only what
  # the caller sent. Deliberately do NOT accept `document_url` from the
  # integration payload: NPD-side artefacts should route via the file
  # upload endpoint, not via a URL string.
  defp build_attach_attrs(params, cert_id) do
    base = %{"certificate_id" => cert_id}

    Enum.reduce(
      ["certificate_number", "valid_from", "valid_until", "notes"],
      base,
      fn key, acc ->
        case params[key] do
          nil -> acc
          "" -> acc
          v -> Map.put(acc, key, v)
        end
      end
    )
  end

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
