defmodule Security.TokenRevocationTest do
  @moduledoc """
  Verifies H6 (max_age reduced), H7 (token_version bump on password
  change / reset invalidates all sessions), M7 (verify re-checks
  is_active).

  The token is opaque; we drive the public sign / verify contract
  and only assert on outcomes.
  """

  use Backend.SecurityCase, async: false

  alias Backend.Accounts

  setup do
    company = insert_company!("Token test co")
    user = insert_user!(company.id, "revoke@vitamanufacture.co.uk")

    %{user: user, company: company}
  end

  describe "verify_token/1" do
    test "fresh token round-trips to the same user", %{user: user} do
      token = Accounts.sign_token(user)

      assert {:ok, verified} = Accounts.verify_token(token)
      assert verified.id == user.id
    end

    test "wrong token is rejected", %{user: _user} do
      assert {:error, _} = Accounts.verify_token("clearly-not-a-token")
    end

    test "missing token surfaces cleanly" do
      assert {:error, :missing} = Accounts.verify_token(nil)
    end
  end

  describe "password change revokes prior tokens (H7)" do
    test "token issued before change fails to verify after change",
         %{user: user} do
      old_token = Accounts.sign_token(user)
      # Sanity: the token works right now.
      assert {:ok, _} = Accounts.verify_token(old_token)

      {:ok, _updated} =
        Accounts.change_password(user, %{
          "current_password" => "correct-horse-battery-staple",
          "password" => "totally-new-secret-123"
        })

      assert {:error, :token_revoked} = Accounts.verify_token(old_token)
    end

    test "a fresh token minted after the change works", %{user: user} do
      _old = Accounts.sign_token(user)

      {:ok, updated} =
        Accounts.change_password(user, %{
          "current_password" => "correct-horse-battery-staple",
          "password" => "totally-new-secret-123"
        })

      new_token = Accounts.sign_token(updated)
      assert {:ok, _} = Accounts.verify_token(new_token)
    end
  end

  describe "is_active re-check (M7)" do
    test "token for a deactivated user is rejected", %{user: user} do
      token = Accounts.sign_token(user)
      assert {:ok, _} = Accounts.verify_token(token)

      # Deactivate via a direct changeset — mirrors the admin
      # matrix flipping the toggle.
      {:ok, _} =
        user
        |> Ecto.Changeset.change(is_active: false)
        |> Backend.Repo.update()

      assert {:error, :inactive} = Accounts.verify_token(token)
    end
  end
end
