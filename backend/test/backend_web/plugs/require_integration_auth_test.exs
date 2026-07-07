defmodule BackendWeb.Plugs.RequireIntegrationAuthTest do
  @moduledoc """
  Unit tests for the integration-token plug. Uses a synthetic conn
  rather than the router so we can assert on halted state, status
  codes, and every failure mode directly.
  """

  use BackendWeb.ConnCase, async: false

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.IntegrationTokens
  alias Backend.Repo
  alias BackendWeb.Plugs.RequireIntegrationAuth

  defp company_fixture, do: Repo.insert!(%Company{name: "PlugTest Co"})

  defp user_fixture(company) do
    n = System.unique_integer([:positive])

    Repo.insert!(%User{
      company_id: company.id,
      email: "ops-#{n}@example.com",
      name: "Ops #{n}",
      hashed_password: "$2b$12$placeholder",
      is_active: true,
      confirmed_at: DateTime.utc_now() |> DateTime.truncate(:second)
    })
  end

  defp token_fixture(scopes) do
    c = company_fixture()
    u = user_fixture(c)
    {:ok, %{token: raw, record: record}} =
      IntegrationTokens.create(%{name: "vita-performance", scopes: scopes}, c.id, u.id)

    %{company: c, user: u, raw: raw, record: record}
  end

  defp call(header_value, plug_opts) do
    conn =
      Phoenix.ConnTest.build_conn(:get, "/api/integration/anything")
      |> maybe_put_header(header_value)

    RequireIntegrationAuth.call(conn, RequireIntegrationAuth.init(plug_opts))
  end

  defp maybe_put_header(conn, nil), do: conn
  defp maybe_put_header(conn, ""), do: conn
  defp maybe_put_header(conn, value), do: Plug.Conn.put_req_header(conn, "x-integration-token", value)

  # ----- missing / bad header --------------------------------------

  test "401 when the header is missing" do
    conn = call(nil, scope: :any)

    assert conn.halted
    assert conn.status == 401
    assert Jason.decode!(conn.resp_body)["error"] == "missing_integration_token"
  end

  test "401 when the header value is malformed" do
    conn = call("garbage", scope: :any)

    assert conn.halted
    assert conn.status == 401
    assert Jason.decode!(conn.resp_body)["error"] == "invalid_integration_token"
  end

  test "401 when the token has been revoked" do
    %{raw: raw, record: record, user: u} = token_fixture(["mo:read"])
    {:ok, _} = IntegrationTokens.revoke(record, u.id, nil)

    conn = call(raw, scope: :any)

    assert conn.halted
    assert conn.status == 401
    assert Jason.decode!(conn.resp_body)["error"] == "invalid_integration_token"
  end

  # ----- scope enforcement -----------------------------------------

  test "403 when the token lacks the required scope" do
    %{raw: raw} = token_fixture(["workstation:read"])

    conn = call(raw, scope: "mo:read")

    assert conn.halted
    assert conn.status == 403
    assert Jason.decode!(conn.resp_body)["error"] == "insufficient_scope"
  end

  test "passes when the required scope is granted" do
    %{raw: raw, company: c, record: record} = token_fixture(["mo:read"])

    conn = call(raw, scope: "mo:read")

    refute conn.halted
    assert conn.assigns.current_integration_token.id == record.id
    assert conn.assigns.current_company_id == c.id
    assert conn.assigns.current_company.id == c.id
  end

  test "scope :any passes for any active token" do
    %{raw: raw} = token_fixture(["mo:read"])

    conn = call(raw, scope: :any)

    refute conn.halted
    assert conn.assigns.current_integration_token
  end
end
