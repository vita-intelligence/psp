defmodule BackendWeb.Plugs.RequireIntegrationAuth do
  @moduledoc """
  Halts the request unless the caller presents a valid, active,
  correctly-scoped integration token in the `X-Integration-Token`
  header.

  Distinct from `RequireAuth`:

    * No `Authorization: Bearer …` — a shared header namespace with
      user sessions is confusing; a dedicated header makes access-log
      filtering trivial ("who used the integration path today?").
    * Scope-checked, not permission-checked. Configure the required
      scope with `plug BackendWeb.Plugs.RequireIntegrationAuth,
      scope: "mo:read"`.
    * Assigns `:current_integration_token`,
      `:current_company_id`, and `:current_company` so downstream
      controllers scope by tenant automatically.

  Failure modes and their status codes:

    * missing header → 401 `missing_integration_token`
    * malformed token → 401 `invalid_integration_token`
    * unknown / revoked → 401 `invalid_integration_token`
    * good token but scope not granted → 403 `insufficient_scope`
  """

  import Plug.Conn

  alias Backend.IntegrationTokens
  alias BackendWeb.Errors

  @header "x-integration-token"

  def init(opts) do
    scope = Keyword.get(opts, :scope, :any)
    %{scope: scope}
  end

  def call(conn, %{scope: required_scope}) do
    case get_req_header(conn, @header) do
      [raw] when is_binary(raw) and raw != "" ->
        authenticate(conn, raw, required_scope)

      _ ->
        deny(conn, 401, "missing_integration_token",
          "This endpoint requires an X-Integration-Token header.")
    end
  end

  defp authenticate(conn, raw, required_scope) do
    case IntegrationTokens.verify(raw) do
      {:ok, token} ->
        if scope_ok?(token, required_scope) do
          conn
          |> assign(:current_integration_token, token)
          |> assign(:current_company_id, token.company_id)
          |> assign(:current_company, token.company)
        else
          deny(conn, 403, "insufficient_scope",
            "This token is not authorised for scope '#{required_scope}'.")
        end

      {:error, reason} when reason in [:not_found, :invalid, :malformed] ->
        deny(conn, 401, "invalid_integration_token",
          "The integration token is invalid or has been revoked.")
    end
  end

  defp scope_ok?(_token, :any), do: true
  defp scope_ok?(token, required), do: IntegrationTokens.has_scope?(token, required)

  defp deny(conn, status, code, message) do
    body = Errors.payload(code, message)

    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(body))
    |> halt()
  end
end
