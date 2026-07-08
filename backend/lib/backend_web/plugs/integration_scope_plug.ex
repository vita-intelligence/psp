defmodule BackendWeb.IntegrationScopePlug do
  @moduledoc """
  Per-action scope gate for controllers behind `:api_integration`.
  The pipeline plug (`RequireIntegrationAuth` with `scope: :any`)
  proves the token is valid; this helper enforces the specific
  scope each action needs.

  Import + use inside a controller:

      import BackendWeb.IntegrationScopePlug

      plug :require_integration_scope, "mo:read" when action in [:index, :show]

  On scope mismatch, halts the connection with 403.
  """

  import Plug.Conn

  alias Backend.IntegrationTokens
  alias BackendWeb.Errors

  def require_integration_scope(conn, scope) when is_binary(scope) do
    token = conn.assigns[:current_integration_token]

    if token && IntegrationTokens.has_scope?(token, scope) do
      conn
    else
      body =
        Errors.payload(
          "insufficient_scope",
          "This token is not authorised for scope '#{scope}'."
        )

      conn
      |> put_resp_content_type("application/json")
      |> send_resp(403, Jason.encode!(body))
      |> halt()
    end
  end
end
