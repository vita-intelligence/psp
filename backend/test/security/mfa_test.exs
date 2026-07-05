defmodule Security.MfaTest do
  @moduledoc """
  Backend.MFA — enrollment, verify, disable, and the grace-period
  policy for admin-enforced MFA.
  """

  use Backend.SecurityCase, async: false

  alias Backend.{Accounts, MFA}
  alias Backend.Accounts.User

  setup do
    company = insert_company!("MFA test co")
    user = insert_user!(company.id, "mfa@vitamanufacture.co.uk")

    %{user: user, company: company}
  end

  describe "enroll/1" do
    test "issues a base32 secret + otpauth URI and persists the secret",
         %{user: user} do
      {:ok, %{secret_base32: secret, otpauth_uri: uri}, updated} = MFA.enroll(user)

      assert String.match?(secret, ~r/^[A-Z2-7]+$/)
      assert String.starts_with?(uri, "otpauth://totp/PSP:mfa@vitamanufacture.co.uk")
      assert String.contains?(uri, "issuer=PSP")

      assert updated.totp_secret == secret
      assert is_nil(updated.totp_confirmed_at)
    end

    test "re-enrolling on a confirmed user overwrites the secret", %{user: user} do
      {:ok, _, enrolled} = MFA.enroll(user)
      {:ok, _, confirmed, _codes} = confirm_via_valid_totp(enrolled)

      {:ok, %{secret_base32: new_secret}, re_enrolled} = MFA.enroll(confirmed)

      assert new_secret != confirmed.totp_secret
      # confirmation cleared → user is back in "not confirmed" state
      assert is_nil(re_enrolled.totp_confirmed_at)
      assert re_enrolled.recovery_codes == []
    end
  end

  describe "confirm/2" do
    test "valid code marks MFA active + mints hashed recovery codes",
         %{user: user} do
      {:ok, _, enrolled} = MFA.enroll(user)
      {:ok, code} = current_code(enrolled)

      {:ok, updated, plaintext_codes} = MFA.confirm(enrolled, code)

      assert %DateTime{} = updated.totp_confirmed_at
      assert length(plaintext_codes) == 10
      assert length(updated.recovery_codes) == 10

      # DB row holds bcrypt hashes, not plaintext.
      for stored <- updated.recovery_codes do
        assert String.starts_with?(stored, "$2b$")
      end
    end

    test "bumps token_version so pre-MFA session tokens die", %{user: user} do
      old_token = Accounts.sign_token(user)
      assert {:ok, _} = Accounts.verify_token(old_token)

      {:ok, _, enrolled} = MFA.enroll(user)
      {:ok, code} = current_code(enrolled)
      {:ok, _updated, _codes} = MFA.confirm(enrolled, code)

      assert {:error, :token_revoked} = Accounts.verify_token(old_token)
    end

    test "invalid code refuses to activate", %{user: user} do
      {:ok, _, enrolled} = MFA.enroll(user)
      assert {:error, :invalid_code} = MFA.confirm(enrolled, "000000")
    end

    test "confirming without enrolling first fails", %{user: user} do
      assert {:error, :not_enrolled} = MFA.confirm(user, "000000")
    end
  end

  describe "verify/2" do
    setup %{user: user} do
      {:ok, _, enrolled} = MFA.enroll(user)
      {:ok, code} = current_code(enrolled)
      {:ok, confirmed, plaintext_codes} = MFA.confirm(enrolled, code)

      %{
        confirmed: confirmed,
        recovery_codes: plaintext_codes
      }
    end

    test "valid live TOTP code passes", %{confirmed: user} do
      {:ok, code} = current_code(user)
      assert :ok = MFA.verify(user, code)
    end

    test "recovery code passes AND is consumed", %{
      confirmed: user,
      recovery_codes: [first | _]
    } do
      assert {:recovery_used, updated} = MFA.verify(user, first)
      assert length(updated.recovery_codes) == 9

      # Second use of the same recovery code fails.
      assert {:error, :invalid_code} = MFA.verify(updated, first)
    end

    test "unknown code fails", %{confirmed: user} do
      assert {:error, :invalid_code} = MFA.verify(user, "not-a-code")
    end

    test "verify on an unconfirmed user is refused", %{user: user} do
      assert {:error, :not_confirmed} = MFA.verify(user, "000000")
    end
  end

  describe "disable/1" do
    test "clears MFA state and bumps token_version", %{user: user} do
      {:ok, _, enrolled} = MFA.enroll(user)
      {:ok, code} = current_code(enrolled)
      {:ok, confirmed, _codes} = MFA.confirm(enrolled, code)

      live_token = Accounts.sign_token(confirmed)
      assert {:ok, _} = Accounts.verify_token(live_token)

      {:ok, disabled} = MFA.disable(confirmed)

      assert is_nil(disabled.totp_secret)
      assert is_nil(disabled.totp_confirmed_at)
      assert disabled.recovery_codes == []
      assert {:error, :token_revoked} = Accounts.verify_token(live_token)
    end
  end

  describe "mfa_required?/1" do
    test "confirmed users always require MFA", %{user: user} do
      {:ok, _, enrolled} = MFA.enroll(user)
      {:ok, code} = current_code(enrolled)
      {:ok, confirmed, _codes} = MFA.confirm(enrolled, code)

      assert MFA.mfa_required?(confirmed)
    end

    test "un-enrolled users don't require MFA by default", %{user: user} do
      refute MFA.mfa_required?(user)
    end

    test "un-enrolled but within grace window are excused" do
      just_enforced = %User{
        mfa_required_at: DateTime.utc_now() |> DateTime.add(-60, :second)
      }

      refute MFA.mfa_required?(just_enforced)
    end

    test "un-enrolled past grace are required" do
      long_enforced = %User{
        mfa_required_at: DateTime.utc_now() |> DateTime.add(-8 * 24 * 3600, :second)
      }

      assert MFA.mfa_required?(long_enforced)
    end
  end

  describe "verify_mfa_challenge/1" do
    test "round-trips a signed mfa_token to the user", %{user: user} do
      token = Accounts.sign_mfa_challenge(user)
      assert {:ok, verified} = Accounts.verify_mfa_challenge(token)
      assert verified.id == user.id
    end

    test "expired / invalid mfa_tokens are rejected" do
      assert {:error, _} = Accounts.verify_mfa_challenge("not-a-token")
      assert {:error, :missing} = Accounts.verify_mfa_challenge(nil)
    end

    test "an mfa_token signed against an older token_version is refused",
         %{user: user} do
      token = Accounts.sign_mfa_challenge(user)
      {:ok, _} = Accounts.revoke_sessions_for_user(user)

      assert {:error, :invalid_mfa_challenge} = Accounts.verify_mfa_challenge(token)
    end
  end

  # ----- helpers --------------------------------------------------

  defp current_code(user) do
    with secret_base32 when is_binary(secret_base32) <- user.totp_secret,
         {:ok, secret} <- Base.decode32(secret_base32, padding: false) do
      {:ok, NimbleTOTP.verification_code(secret)}
    else
      _ -> {:error, :no_secret}
    end
  end

  defp confirm_via_valid_totp(enrolled_user) do
    {:ok, code} = current_code(enrolled_user)
    {:ok, updated, codes} = MFA.confirm(enrolled_user, code)
    {:ok, code, updated, codes}
  end
end
