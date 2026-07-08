defmodule BackendWeb.IntegrationTokenControllerTest do
  @moduledoc """
  End-to-end tests for the human-user CRUD endpoints for integration
  tokens. Covers the mint response format (including the one-shot raw
  token exposure), the list shape, and the revoke lifecycle. RBAC
  gating is exercised via the "no permission → 403" case.
  """

  use BackendWeb.ConnCase, async: false

  alias Backend.Accounts
  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.IntegrationTokens
  alias Backend.Repo

  defp company_fixture, do: Repo.insert!(%Company{name: "IntegrationCtl Co"})

  defp user_fixture(company, permissions) do
    n = System.unique_integer([:positive])

    Repo.insert!(%User{
      company_id: company.id,
      email: "operator-#{n}@example.com",
      name: "Operator #{n}",
      hashed_password: "$2b$12$placeholder",
      is_active: true,
      confirmed_at: DateTime.utc_now() |> DateTime.truncate(:second),
      permissions: permissions
    })
  end

  defp with_auth(conn, user) do
    token = Accounts.sign_token(user)
    put_req_header(conn, "authorization", "Bearer " <> token)
  end

  setup do
    company = company_fixture()
    admin = user_fixture(company, ["integrations.manage"])
    viewer = user_fixture(company, [])
    %{company: company, admin: admin, viewer: viewer}
  end

  describe "index / create / revoke happy path" do
    test "mints a token, exposes the raw string once, then lists it as active", %{
      conn: conn,
      admin: admin
    } do
      created =
        conn
        |> with_auth(admin)
        |> post(~p"/api/integration-tokens", %{
          "name" => "vita-performance",
          "scopes" => ["mo:read", "workstation:read"]
        })
        |> json_response(201)

      assert String.starts_with?(created["raw_token"], "psp_live_")
      assert created["integration_token"]["name"] == "vita-performance"
      assert created["integration_token"]["scopes"] == ["mo:read", "workstation:read"]
      assert created["integration_token"]["is_active"]
      # Prefix is safe to persist / display; the tail is not returned
      # in the token payload — only on the top-level `raw_token`.
      prefix = created["integration_token"]["prefix"]
      refute String.contains?(inspect(created["integration_token"]), created["raw_token"])
      assert String.length(prefix) == 20

      # Listing includes the new row and echoes the known-scope catalogue
      # so the frontend can render its multi-select from a single fetch.
      listed =
        conn
        |> with_auth(admin)
        |> get(~p"/api/integration-tokens")
        |> json_response(200)

      assert Enum.any?(listed["items"], &(&1["name"] == "vita-performance"))
      assert "mo:read" in listed["known_scopes"]
      assert "hr:write:pin" in listed["known_scopes"]
    end

    test "revoke marks the token inactive with audit fields", %{conn: conn, admin: admin, company: company} do
      {:ok, %{record: token}} =
        IntegrationTokens.create(
          %{name: "to-revoke", scopes: ["mo:read"]},
          company.id,
          admin.id
        )

      revoked =
        conn
        |> with_auth(admin)
        |> post(~p"/api/integration-tokens/#{token.uuid}/revoke", %{"reason" => "not needed"})
        |> json_response(200)

      refute revoked["integration_token"]["is_active"]
      assert revoked["integration_token"]["revoke_reason"] == "not needed"
      refute is_nil(revoked["integration_token"]["revoked_at"])
      assert revoked["integration_token"]["revoked_by"]["id"] == admin.id
    end

    test "double-revoke returns 409", %{conn: conn, admin: admin, company: company} do
      {:ok, %{record: token}} =
        IntegrationTokens.create(%{name: "once", scopes: ["mo:read"]}, company.id, admin.id)

      _ =
        conn
        |> with_auth(admin)
        |> post(~p"/api/integration-tokens/#{token.uuid}/revoke", %{})
        |> json_response(200)

      body =
        conn
        |> with_auth(admin)
        |> post(~p"/api/integration-tokens/#{token.uuid}/revoke", %{})
        |> json_response(409)

      assert body["error"] == "already_revoked"
    end
  end

  describe "RBAC gate" do
    test "403 when the caller lacks integrations.manage", %{conn: conn, viewer: viewer} do
      body =
        conn
        |> with_auth(viewer)
        |> get(~p"/api/integration-tokens")
        |> json_response(403)

      assert body["error"] in ["forbidden", "insufficient_permission"]
    end

    test "401 when unauthenticated", %{conn: conn} do
      conn
      |> get(~p"/api/integration-tokens")
      |> json_response(401)
    end
  end

  describe "validation" do
    test "422 on unknown scope", %{conn: conn, admin: admin} do
      body =
        conn
        |> with_auth(admin)
        |> post(~p"/api/integration-tokens", %{
          "name" => "bad",
          "scopes" => ["not_a_real_scope"]
        })
        |> json_response(422)

      assert body["error"] == "validation_failed"
      assert body["fields"]["scopes"]
    end

    test "422 on empty scope list", %{conn: conn, admin: admin} do
      body =
        conn
        |> with_auth(admin)
        |> post(~p"/api/integration-tokens", %{"name" => "empty", "scopes" => []})
        |> json_response(422)

      assert body["error"] == "validation_failed"
      assert body["fields"]["scopes"]
    end
  end
end
