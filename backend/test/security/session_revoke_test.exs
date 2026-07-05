defmodule Security.SessionRevokeTest do
  @moduledoc """
  Verifies the admin panic-button session revoke primitives (Phase 3
  #1). Two paths:

    * `revoke_sessions_for_user/1` — one user, next verify fails
    * `revoke_all_sessions_for_company/1` — every user in the tenant

  These operate on the same `token_version` mechanism that
  password change / reset already use, so the verification path
  under test is the same as `Security.TokenRevocationTest`.
  """

  use Backend.SecurityCase, async: false

  alias Backend.Accounts

  setup do
    tenant_a = insert_company!("Panic-button tenant A")
    tenant_b = insert_company!("Panic-button tenant B")

    alice = insert_user!(tenant_a.id, "alice-panic@vitamanufacture.co.uk")
    bob = insert_user!(tenant_a.id, "bob-panic@vitamanufacture.co.uk")
    carol = insert_user!(tenant_b.id, "carol-panic@vitamanufacture.co.uk")

    %{
      tenant_a: tenant_a,
      tenant_b: tenant_b,
      alice: alice,
      bob: bob,
      carol: carol
    }
  end

  describe "revoke_sessions_for_user/1" do
    test "invalidates the target user's outstanding tokens", %{alice: alice} do
      token = Accounts.sign_token(alice)
      assert {:ok, _} = Accounts.verify_token(token)

      {:ok, _updated} = Accounts.revoke_sessions_for_user(alice)

      assert {:error, :token_revoked} = Accounts.verify_token(token)
    end

    test "leaves other users' tokens alone", %{alice: alice, bob: bob} do
      bob_token = Accounts.sign_token(bob)

      {:ok, _} = Accounts.revoke_sessions_for_user(alice)

      assert {:ok, verified} = Accounts.verify_token(bob_token)
      assert verified.id == bob.id
    end

    test "a fresh token minted AFTER the revoke stays valid", %{alice: alice} do
      _stale = Accounts.sign_token(alice)
      {:ok, revoked_alice} = Accounts.revoke_sessions_for_user(alice)

      fresh = Accounts.sign_token(revoked_alice)
      assert {:ok, _} = Accounts.verify_token(fresh)
    end
  end

  describe "revoke_all_sessions_for_company/1" do
    test "invalidates every user in the tenant", %{
      tenant_a: tenant_a,
      alice: alice,
      bob: bob
    } do
      alice_token = Accounts.sign_token(alice)
      bob_token = Accounts.sign_token(bob)

      {count, _} = Accounts.revoke_all_sessions_for_company(tenant_a.id)
      assert count == 2

      assert {:error, :token_revoked} = Accounts.verify_token(alice_token)
      assert {:error, :token_revoked} = Accounts.verify_token(bob_token)
    end

    test "leaves other tenants alone", %{
      tenant_a: tenant_a,
      carol: carol
    } do
      carol_token = Accounts.sign_token(carol)

      Accounts.revoke_all_sessions_for_company(tenant_a.id)

      assert {:ok, verified} = Accounts.verify_token(carol_token)
      assert verified.id == carol.id
    end
  end
end
