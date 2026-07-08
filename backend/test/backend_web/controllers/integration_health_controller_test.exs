defmodule BackendWeb.IntegrationHealthControllerTest do
  @moduledoc """
  End-to-end route test for the health endpoint — proves the pipeline
  wiring is correct (header → plug → controller → JSON) without
  exercising higher-scope endpoints.
  """

  use BackendWeb.ConnCase, async: false

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.IntegrationTokens
  alias Backend.Repo

  defp setup_token(_context) do
    company = Repo.insert!(%Company{name: "HealthTest Co"})

    user =
      Repo.insert!(%User{
        company_id: company.id,
        email: "ops-#{System.unique_integer([:positive])}@example.com",
        name: "Ops",
        hashed_password: "$2b$12$placeholder",
        is_active: true,
        confirmed_at: DateTime.utc_now() |> DateTime.truncate(:second)
      })

    {:ok, %{token: raw, record: record}} =
      IntegrationTokens.create(
        %{name: "vita-performance", scopes: ["mo:read", "workstation:read"]},
        company.id,
        user.id
      )

    %{company: company, raw: raw, record: record}
  end

  setup [:setup_token]

  test "GET /api/integration/health returns token + company identity", %{
    conn: conn,
    raw: raw,
    record: record,
    company: company
  } do
    result =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/health")
      |> json_response(200)

    assert result["ok"] == true
    assert result["token"]["uuid"] == record.uuid
    assert result["token"]["name"] == "vita-performance"
    assert result["token"]["prefix"] == record.token_prefix
    assert result["token"]["scopes"] == ["mo:read", "workstation:read"]
    assert result["company"]["id"] == company.id
    assert result["company"]["name"] == "HealthTest Co"
    # Raw token must NOT be echoed back — it never leaves the server
    # after the initial mint.
    refute String.contains?(inspect(result), String.slice(raw, 20, 21))
  end

  test "GET /api/integration/health rejects missing header", %{conn: conn} do
    result =
      conn
      |> get(~p"/api/integration/health")
      |> json_response(401)

    assert result["error"] == "missing_integration_token"
  end

  test "GET /api/integration/health rejects bad token", %{conn: conn} do
    result =
      conn
      |> put_req_header("x-integration-token", "psp_live_" <> String.duplicate("a", 32))
      |> get(~p"/api/integration/health")
      |> json_response(401)

    assert result["error"] == "invalid_integration_token"
  end
end
