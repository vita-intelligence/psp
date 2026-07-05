defmodule Backend.MFA do
  @moduledoc """
  TOTP (Time-based One-Time Password, RFC 6238) enrollment,
  verification, and disable flow.

  Contract for the caller:

    * `enroll/1` — mint a fresh secret, hand back the base32 form
      and an `otpauth://` URI ready for a QR code. Persists the
      secret against the user's `totp_secret` column. Does NOT
      mark MFA active — the user must prove they can read the QR
      by calling `confirm/2`.
    * `confirm/2` — verify a code, stamp `totp_confirmed_at`, mint
      + hash 10 recovery codes. Returns the plaintext recovery
      codes ONCE — the caller must show them to the user
      immediately; we only store hashes.
    * `verify/2` — check a code against a confirmed user. Also
      falls back to the recovery-code list, consuming the matched
      code on success.
    * `disable/1` — clear the secret, confirmation, and recovery
      codes. Bumps `token_version` so every session that assumed
      MFA is revoked.

  Grace-period policy for admin-enforced MFA lives in `mfa_required?/1`:

    * User has confirmed MFA → true (always).
    * `mfa_required_at` set + within 7 days → false (grace).
    * `mfa_required_at` set + past 7 days → true.
  """

  alias Backend.Accounts.User
  alias Backend.Repo

  @issuer "PSP"
  @grace_period_seconds 7 * 24 * 60 * 60
  @recovery_code_count 10

  @type verify_result ::
          :ok
          | {:recovery_used, updated_user :: %User{}}
          | {:error, :invalid_code}
          | {:error, :not_confirmed}

  ## Enrollment ----------------------------------------------------

  @doc """
  Stage 1 of enrollment. Persists a fresh secret on the user and
  returns the shared state the client needs to render a QR code.

  Idempotent — re-calling on an already-enrolled user overwrites the
  secret. Callers should confirm-then-disable if the user wants to
  rotate.
  """
  @spec enroll(User.t()) ::
          {:ok, %{secret_base32: String.t(), otpauth_uri: String.t()}, User.t()}
  def enroll(%User{} = user) do
    secret = NimbleTOTP.secret()
    secret_base32 = Base.encode32(secret, padding: false)

    label = "#{@issuer}:#{user.email}"

    otpauth_uri =
      NimbleTOTP.otpauth_uri(label, secret, issuer: @issuer)

    {:ok, updated} =
      user
      |> Ecto.Changeset.change(%{
        totp_secret: secret_base32,
        totp_confirmed_at: nil,
        recovery_codes: []
      })
      |> Repo.update()

    {:ok, %{secret_base32: secret_base32, otpauth_uri: otpauth_uri}, updated}
  end

  @doc """
  Stage 2. Verify a code, mark MFA active, mint recovery codes.

  Returns the raw plaintext recovery codes — the DB only holds their
  bcrypt hashes. The caller MUST show them to the user immediately;
  we can't produce them again.
  """
  @spec confirm(User.t(), String.t()) ::
          {:ok, User.t(), [String.t()]} | {:error, :invalid_code | :not_enrolled}
  def confirm(%User{totp_secret: nil}, _code), do: {:error, :not_enrolled}

  def confirm(%User{} = user, code) when is_binary(code) do
    with true <- valid_totp?(user.totp_secret, code) do
      plaintext_codes = generate_recovery_codes(@recovery_code_count)
      hashed = Enum.map(plaintext_codes, &Bcrypt.hash_pwd_salt/1)
      now = DateTime.utc_now() |> DateTime.truncate(:second)

      {:ok, updated} =
        user
        |> Ecto.Changeset.change(%{
          totp_confirmed_at: now,
          recovery_codes: hashed,
          # Any pre-enrollment session token is revoked so a stolen
          # cookie can't linger post-enable.
          token_version: (user.token_version || 0) + 1
        })
        |> Repo.update()

      {:ok, updated, plaintext_codes}
    else
      _ -> {:error, :invalid_code}
    end
  end

  ## Verify at login -----------------------------------------------

  @doc """
  Verify a TOTP code (or recovery code) for a confirmed user.

    * `:ok` — matched a live TOTP window
    * `{:recovery_used, updated_user}` — matched a recovery code;
      the code is consumed and the user row updated
    * `{:error, :invalid_code}` — neither matched
    * `{:error, :not_confirmed}` — user hasn't finished enrollment
  """
  @spec verify(User.t(), String.t()) :: verify_result
  def verify(%User{totp_confirmed_at: nil}, _code), do: {:error, :not_confirmed}

  def verify(%User{} = user, code) when is_binary(code) do
    cond do
      valid_totp?(user.totp_secret, code) ->
        :ok

      match = matching_recovery(user.recovery_codes, code) ->
        remaining = List.delete(user.recovery_codes, match)

        {:ok, updated} =
          user
          |> Ecto.Changeset.change(%{recovery_codes: remaining})
          |> Repo.update()

        {:recovery_used, updated}

      true ->
        {:error, :invalid_code}
    end
  end

  ## Disable -------------------------------------------------------

  @doc """
  Clear the user's MFA state. Bumps `token_version` so every session
  that was authenticated under MFA gets kicked to re-login.
  """
  @spec disable(User.t()) :: {:ok, User.t()}
  def disable(%User{} = user) do
    user
    |> Ecto.Changeset.change(%{
      totp_secret: nil,
      totp_confirmed_at: nil,
      recovery_codes: [],
      mfa_required_at: nil,
      token_version: (user.token_version || 0) + 1
    })
    |> Repo.update()
  end

  ## Policy --------------------------------------------------------

  @doc """
  Is MFA required for this user right now?

    * Confirmed MFA (`totp_confirmed_at` set) → always true.
    * Admin flipped company `require_mfa`, and 7-day grace is up
      → true.
    * Otherwise false.
  """
  @spec mfa_required?(User.t()) :: boolean
  def mfa_required?(%User{totp_confirmed_at: %DateTime{}}), do: true

  def mfa_required?(%User{mfa_required_at: %DateTime{} = enforced_at}) do
    DateTime.diff(DateTime.utc_now(), enforced_at, :second) > @grace_period_seconds
  end

  def mfa_required?(_), do: false

  ## Helpers -------------------------------------------------------

  defp valid_totp?(nil, _code), do: false

  defp valid_totp?(secret_base32, code) when is_binary(secret_base32) do
    case Base.decode32(secret_base32, padding: false) do
      {:ok, secret} -> NimbleTOTP.valid?(secret, code)
      :error -> false
    end
  end

  # Recovery codes are 10 groups of 4 base32 chars separated by
  # dashes ("XXXX-XXXX-XXXX") for readability. Total entropy: 60
  # bits per code, low enough that we still hash before storing.
  defp generate_recovery_codes(n) when is_integer(n) and n > 0 do
    for _ <- 1..n, do: generate_recovery_code()
  end

  defp generate_recovery_code do
    for _ <- 1..3, into: "" do
      chunk =
        :crypto.strong_rand_bytes(3)
        |> Base.encode32(padding: false)
        |> binary_part(0, 4)

      chunk
    end
    |> String.replace(~r/(.{4})(.{4})(.{4})/, "\\1-\\2-\\3")
  end

  defp matching_recovery(hashed_codes, plaintext) when is_list(hashed_codes) do
    Enum.find(hashed_codes, fn hash -> Bcrypt.verify_pass(plaintext, hash) end)
  end
end
