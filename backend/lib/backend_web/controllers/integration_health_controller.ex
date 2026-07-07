defmodule BackendWeb.IntegrationHealthController do
  @moduledoc """
  `GET /api/integration/health` — smoke-test endpoint the caller hits
  to prove its token works. Returns the token's identity + granted
  scopes without exposing the raw token or hash. First and simplest
  endpoint on the integration pipeline.

  Deliberately not gated to a scope beyond auth — the smallest
  possible surface area an integration would ever legitimately need.
  """

  use BackendWeb, :controller

  def show(conn, _params) do
    token = conn.assigns.current_integration_token
    company = conn.assigns.current_company

    json(conn, %{
      ok: true,
      token: %{
        uuid: token.uuid,
        name: token.name,
        prefix: token.token_prefix,
        scopes: token.scopes,
        last_used_at: token.last_used_at
      },
      company: %{
        id: company.id,
        name: company.name
      }
    })
  end
end
