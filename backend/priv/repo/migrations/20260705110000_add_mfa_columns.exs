defmodule Backend.Repo.Migrations.AddMfaColumns do
  use Ecto.Migration

  @moduledoc """
  Adds Time-based One-Time Password (TOTP) fields to users, plus a
  company-wide "require MFA for everyone" toggle.

  Per-user columns:

    * `totp_secret` — RFC 6238 base32-encoded shared secret. `nil`
      when the user hasn't started enrollment.
    * `totp_confirmed_at` — set the first time the user proves they
      can compute a valid TOTP. Login treats `totp_confirmed_at IS
      NOT NULL` as "MFA is on for this account".
    * `recovery_codes` — bcrypt-hashed one-time backup codes. 10
      codes generated at confirm time; each consumed once.
    * `mfa_required_at` — stamped when the company toggles
      `require_mfa: true`. Users get a 7-day grace period before
      login refuses without MFA.

  Company column:

    * `require_mfa` — admin toggle. Flipping true stamps
      `mfa_required_at = now()` on every user without confirmed MFA.
  """

  def change do
    alter table(:users) do
      add :totp_secret, :string
      add :totp_confirmed_at, :utc_datetime
      add :recovery_codes, {:array, :string}, default: [], null: false
      add :mfa_required_at, :utc_datetime
    end

    alter table(:companies) do
      add :require_mfa, :boolean, default: false, null: false
    end
  end
end
