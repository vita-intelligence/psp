defmodule BackendWeb.IntegrationTokenController do
  @moduledoc """
  Human-user CRUD for machine-to-machine bearer tokens.

  This controller powers `/settings/integrations` in the frontend
  where an operator mints and revokes tokens the external systems
  will present via `X-Integration-Token`. Distinct from
  `IntegrationHealthController` (and any future integration
  endpoints) which are the machine-facing surface behind the
  `RequireIntegrationAuth` plug.

  RBAC: `integrations.manage` for every action. There is no
  separate `.view` scope because seeing a token's name is fine and
  the raw secret is never returned again after mint.
  """

  use BackendWeb, :controller

  alias Backend.Accounts.IntegrationToken
  alias Backend.IntegrationTokens
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "integrations.manage"

  action_fallback BackendWeb.FallbackController

  def index(conn, _params) do
    actor = conn.assigns.current_user

    tokens = IntegrationTokens.list_for_company(actor.company_id)

    json(conn, %{
      items: Enum.map(tokens, &Payloads.integration_token/1),
      known_scopes: IntegrationToken.known_scopes()
    })
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    attrs = %{
      name: params["name"],
      scopes: params["scopes"] || []
    }

    case IntegrationTokens.create(attrs, actor.company_id, actor.id) do
      {:ok, %{token: raw, record: record}} ->
        # `raw` is included exactly once on this response — the
        # frontend shows it in a modal with a copy button and warns
        # the operator that it won't be shown again.
        conn
        |> put_status(:created)
        |> json(%{
          integration_token: Payloads.integration_token(preload(record)),
          raw_token: raw
        })

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def revoke(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user
    reason = params["reason"]

    with %IntegrationToken{} = token <- IntegrationTokens.get_by_uuid(uuid, actor.company_id),
         true <- token.is_active or {:error, :already_revoked},
         {:ok, revoked} <- IntegrationTokens.revoke(token, actor.id, reason) do
      json(conn, %{integration_token: Payloads.integration_token(preload(revoked))})
    else
      nil -> {:error, :not_found}
      {:error, :already_revoked} ->
        conn
        |> put_status(:conflict)
        |> json(Errors.payload("already_revoked", "This token has already been revoked."))

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  # ---- helpers ----

  defp preload(%IntegrationToken{} = token) do
    Backend.Repo.preload(token, [:created_by, :revoked_by])
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
