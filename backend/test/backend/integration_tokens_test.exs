defmodule Backend.IntegrationTokensTest do
  @moduledoc """
  Boundary tests for `Backend.IntegrationTokens`. Covers mint →
  verify → revoke lifecycle and every failure branch of `verify/1`.
  """

  use Backend.DataCase, async: false

  alias Backend.Accounts.{IntegrationToken, User}
  alias Backend.Companies.Company
  alias Backend.IntegrationTokens
  alias Backend.Repo

  # ----- fixtures --------------------------------------------------

  defp company_fixture(name \\ "IntegrationTokens-Test Co") do
    Repo.insert!(%Company{name: name})
  end

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

  defp valid_attrs, do: %{name: "vita-performance", scopes: ["mo:read", "workstation:read"]}

  # ----- create ----------------------------------------------------

  describe "create/3" do
    test "mints a raw token, persists a bcrypt hash, and never re-exposes plaintext" do
      c = company_fixture()
      u = user_fixture(c)

      assert {:ok, %{token: raw, record: record}} =
               IntegrationTokens.create(valid_attrs(), c.id, u.id)

      assert String.starts_with?(raw, "psp_live_")
      # 9 marker chars + 11 prefix hex + 21 secret hex = 41 total.
      assert byte_size(raw) == 41
      assert String.length(record.token_prefix) == 20
      assert String.starts_with?(record.token_prefix, "psp_live_")
      # The persisted hash must NOT equal the raw string (bcrypt makes
      # this trivially true, but assert it to catch a silly regression).
      refute record.token_hash == raw
      assert record.company_id == c.id
      assert record.created_by_id == u.id
      assert record.is_active
      assert record.scopes == ["mo:read", "workstation:read"]
    end

    test "rejects unknown scopes" do
      c = company_fixture()
      u = user_fixture(c)

      assert {:error, cs} =
               IntegrationTokens.create(
                 %{name: "bad", scopes: ["mo:read", "not_a_real_scope"]},
                 c.id,
                 u.id
               )

      assert %{scopes: ["has an invalid entry"]} = errors_on(cs)
    end

    test "requires at least one scope" do
      c = company_fixture()
      u = user_fixture(c)

      assert {:error, cs} =
               IntegrationTokens.create(%{name: "empty", scopes: []}, c.id, u.id)

      assert Enum.any?(errors_on(cs).scopes, &String.contains?(&1, "at least one"))
    end

    test "rejects duplicate name within a company" do
      c = company_fixture()
      u = user_fixture(c)

      assert {:ok, _} = IntegrationTokens.create(valid_attrs(), c.id, u.id)

      assert {:error, cs} = IntegrationTokens.create(valid_attrs(), c.id, u.id)
      assert %{name: [_]} = errors_on(cs)
    end
  end

  # ----- verify ----------------------------------------------------

  describe "verify/1" do
    test "returns the token record for a valid, active token and bumps last_used_at" do
      c = company_fixture()
      u = user_fixture(c)
      {:ok, %{token: raw, record: record}} =
        IntegrationTokens.create(valid_attrs(), c.id, u.id)

      assert is_nil(record.last_used_at)

      assert {:ok, verified} = IntegrationTokens.verify(raw)
      assert verified.id == record.id
      assert verified.company_id == c.id

      # Reload to see the persisted timestamp bump.
      reloaded = Repo.get!(IntegrationToken, record.id)
      refute is_nil(reloaded.last_used_at)
    end

    test "rejects a token whose prefix matches but whose secret tail is wrong" do
      c = company_fixture()
      u = user_fixture(c)
      {:ok, %{token: raw}} = IntegrationTokens.create(valid_attrs(), c.id, u.id)

      # Same prefix, corrupted tail.
      tampered = String.slice(raw, 0, 20) <> String.duplicate("f", 21)

      assert {:error, :invalid} = IntegrationTokens.verify(tampered)
    end

    test "rejects a revoked token" do
      c = company_fixture()
      u = user_fixture(c)
      {:ok, %{token: raw, record: record}} =
        IntegrationTokens.create(valid_attrs(), c.id, u.id)

      {:ok, _} = IntegrationTokens.revoke(record, u.id, "no longer needed")

      assert {:error, :not_found} = IntegrationTokens.verify(raw)
    end

    test "rejects a completely unknown token" do
      assert {:error, :not_found} =
               IntegrationTokens.verify("psp_live_" <> String.duplicate("a", 32))
    end

    test "rejects a malformed token" do
      assert {:error, :malformed} = IntegrationTokens.verify("not-a-token")
      assert {:error, :malformed} = IntegrationTokens.verify("")
      assert {:error, :malformed} = IntegrationTokens.verify(nil)
      # Wrong marker.
      assert {:error, :malformed} =
               IntegrationTokens.verify("psp_test_" <> String.duplicate("a", 32))
    end
  end

  # ----- has_scope? -----------------------------------------------

  describe "has_scope?/2" do
    test "grants when the scope is in the list" do
      token = %IntegrationToken{scopes: ["mo:read", "workstation:read"]}
      assert IntegrationTokens.has_scope?(token, "mo:read")
      assert IntegrationTokens.has_scope?(token, "workstation:read")
    end

    test "denies when the scope is missing" do
      token = %IntegrationToken{scopes: ["mo:read"]}
      refute IntegrationTokens.has_scope?(token, "mo:write:session")
    end
  end

  # ----- revoke ---------------------------------------------------

  describe "revoke/3" do
    test "marks the token inactive with an audit trail" do
      c = company_fixture()
      u = user_fixture(c)
      {:ok, %{record: record}} = IntegrationTokens.create(valid_attrs(), c.id, u.id)

      assert {:ok, revoked} = IntegrationTokens.revoke(record, u.id, "rotated")

      refute revoked.is_active
      refute is_nil(revoked.revoked_at)
      assert revoked.revoked_by_id == u.id
      assert revoked.revoke_reason == "rotated"
    end
  end

  # ----- list_for_company -----------------------------------------

  describe "list_for_company/1" do
    test "returns tokens for the given company, newest first" do
      c1 = company_fixture("Company One")
      c2 = company_fixture("Company Two")
      u1 = user_fixture(c1)
      u2 = user_fixture(c2)

      {:ok, _} = IntegrationTokens.create(%{name: "t1", scopes: ["mo:read"]}, c1.id, u1.id)
      {:ok, _} = IntegrationTokens.create(%{name: "t2", scopes: ["mo:read"]}, c1.id, u1.id)
      {:ok, _} = IntegrationTokens.create(%{name: "t3", scopes: ["mo:read"]}, c2.id, u2.id)

      c1_tokens = IntegrationTokens.list_for_company(c1.id)
      assert length(c1_tokens) == 2
      assert Enum.map(c1_tokens, & &1.name) == ["t2", "t1"]

      c2_tokens = IntegrationTokens.list_for_company(c2.id)
      assert length(c2_tokens) == 1
    end
  end
end
