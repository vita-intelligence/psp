defmodule BackendWeb.NpdIntegrationSettingsController do
  @moduledoc """
  Reverse-integration config surface for the ``/settings/integrations``
  page. Mirrors the shape NPD exposes for PSP on its side.

  Three actions:

    * `show`             — read the current config. Token never
                           leaves the boundary; the payload sends
                           ``has_token: true|false`` so the FE knows
                           whether "clear + retype" is meaningful.
    * `update`           — write ``base_url`` / ``enabled`` / ``token``
                           in one shot. A blank / missing token means
                           "keep whatever's stored".
    * `test_connection`  — server-to-server ping against the configured
                           NPD endpoint using the stored token. Handy
                           for confirming a paste before saving.

  RBAC: ``integrations.manage`` — same capability that gates the
  outbound integration-token workbench.

  There used to be a pair of "R&D-in-development" proxy actions here
  that mirrored NPD formulations into a local ``rd_projects`` table.
  That mirror is gone — NPD now pushes a ``CustomerOrder`` per
  formulation via ``save_version`` so the R&D column on ``/projects``
  reads from the local CO table like every other phase.
  """

  use BackendWeb, :controller

  alias Backend.Companies
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission,
       "integrations.manage"
       when action in [:show, :update, :test_connection]

  action_fallback BackendWeb.FallbackController

  def show(conn, _params) do
    json(conn, %{npd_integration: Payloads.npd_integration(Companies.current())})
  end

  def update(conn, params) do
    attrs = %{
      "npd_integration_enabled" => params["enabled"],
      "npd_base_url" => params["base_url"],
      # An omitted / blank token means "keep the stored value"; the
      # changeset drops the change when it sees an empty string.
      "npd_integration_token" => params["token"]
    }

    case Companies.update_npd_integration(Companies.current(), attrs) do
      {:ok, company} ->
        json(conn, %{npd_integration: Payloads.npd_integration(company)})

      {:error, %Ecto.Changeset{} = cs} ->
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

  @doc """
  Fire a lightweight GET against the NPD endpoint we use in production
  (the R&D-in-development formulations list) and reduce the outcome to
  a boolean + short reason. Called from the settings page's "Test
  connection" button so an operator can validate the token + URL
  without saving-and-navigating.
  """
  def test_connection(conn, _params) do
    company = Companies.current()

    if Companies.npd_integration_live?(company) do
      case do_ping(company) do
        {:ok, count} ->
          json(conn, %{ok: true, in_development_count: count})

        {:error, reason} ->
          conn
          |> put_status(:bad_gateway)
          |> json(%{ok: false, reason: reason})
      end
    else
      conn
      |> put_status(:bad_request)
      |> json(%{ok: false, reason: "not_configured"})
    end
  end

  # ----- HTTP ping ------------------------------------------------

  @request_timeout_ms 4_000

  defp do_ping(company) do
    url =
      String.trim_trailing(company.npd_base_url, "/") <>
        "/api/psp-integration/formulations/in-development/"

    headers = [
      {~c"Authorization", ~c"Bearer " ++ String.to_charlist(company.npd_integration_token)},
      {~c"Accept", ~c"application/json"}
    ]

    request = {String.to_charlist(url), headers}

    http_opts = [timeout: @request_timeout_ms, connect_timeout: @request_timeout_ms]
    opts = [body_format: :binary]

    case :httpc.request(:get, request, http_opts, opts) do
      {:ok, {{_, 200, _}, _resp_headers, body}} ->
        case Jason.decode(body) do
          {:ok, %{"items" => items}} when is_list(items) ->
            {:ok, length(items)}

          _ ->
            {:error, "malformed_response"}
        end

      {:ok, {{_, 401, _}, _, _}} ->
        {:error, "invalid_token"}

      {:ok, {{_, 403, _}, _, _}} ->
        {:error, "invalid_token"}

      {:ok, {{_, status, _}, _, _}} ->
        {:error, "unexpected_status_#{status}"}

      {:error, reason} ->
        {:error, format_httpc_error(reason)}
    end
  end

  defp format_httpc_error({:failed_connect, _}), do: "cannot_connect"
  defp format_httpc_error(:timeout), do: "timeout"
  defp format_httpc_error(_), do: "request_failed"
end
