defmodule BackendWeb.MfaController do
  @moduledoc """
  MFA enrollment, disable, and login-time verification.

  The endpoints split into two pipelines:

    * **Authed** (`:api_authed`):
        * `POST /api/auth/mfa/enroll` — stage 1: mint secret, return QR
        * `POST /api/auth/mfa/confirm` — stage 2: verify a code, mint
          recovery codes, mark MFA active, return a fresh session
          token because the confirmation bumps `token_version`
        * `POST /api/auth/mfa/disable` — verify current password,
          clear MFA state, return a fresh session token
        * `GET  /api/auth/mfa/status` — for the settings UI

    * **Anonymous** (`:api`):
        * `POST /api/auth/mfa/verify` — exchange `{mfa_token, code}`
          for a session token, called by the login page after the
          password step returned `mfa_required: true`

  Rate-limited so a stolen mfa_token can't be brute-forced. Every
  event is logged via `Backend.SecurityLog` for post-incident
  forensics.
  """

  use BackendWeb, :controller

  alias Backend.{Accounts, MFA, SecurityLog}
  alias BackendWeb.{Errors, Payloads}

  action_fallback BackendWeb.FallbackController

  # Login-time verify is anonymous and easy to brute; cap tight.
  plug BackendWeb.Plugs.RateLimit,
       [scope: :mfa_verify, limit: 10, window: 60, key: :ip]
       when action == :verify

  # ----- enrollment (authed) --------------------------------------

  def enroll(conn, _params) do
    actor = conn.assigns.current_user

    {:ok, %{secret_base32: secret, otpauth_uri: uri}, _user} = MFA.enroll(actor)

    json(conn, %{secret: secret, otpauth_uri: uri})
  end

  def confirm(conn, %{"code" => code}) do
    actor = conn.assigns.current_user
    remote_ip = SecurityLog.remote_ip(conn)

    case MFA.confirm(actor, code) do
      {:ok, updated, recovery_codes} ->
        SecurityLog.record(:mfa_enrolled,
          user_id: updated.id,
          email: updated.email,
          remote_ip: remote_ip
        )

        # confirm/2 bumps token_version → hand back a fresh session
        # token so the current tab isn't kicked to /login mid-flow.
        fresh_token = Accounts.sign_token(updated)

        json(conn, %{
          ok: true,
          recovery_codes: recovery_codes,
          token: fresh_token,
          user: Payloads.user(updated)
        })

      {:error, :invalid_code} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "invalid_code",
            "That code didn't match. Check the clock on your phone matches this device."
          )
        )

      {:error, :not_enrolled} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "not_enrolled",
            "Start enrollment first — the setup screen has the QR code."
          )
        )
    end
  end

  def confirm(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(Errors.payload("code_required", "Send `code` (6-digit TOTP)."))
  end

  def disable(conn, %{"current_password" => password}) when is_binary(password) do
    actor = conn.assigns.current_user
    remote_ip = SecurityLog.remote_ip(conn)

    case Accounts.authenticate(actor.email, password) do
      {:ok, _} ->
        {:ok, updated} = MFA.disable(actor)

        SecurityLog.record(:mfa_disabled,
          user_id: updated.id,
          email: updated.email,
          remote_ip: remote_ip
        )

        fresh_token = Accounts.sign_token(updated)

        json(conn, %{ok: true, token: fresh_token, user: Payloads.user(updated)})

      _ ->
        conn
        |> put_status(:unauthorized)
        |> json(
          Errors.payload(
            "invalid_password",
            "Enter your current password to turn MFA off."
          )
        )
    end
  end

  def disable(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(
      Errors.payload(
        "password_required",
        "Send `current_password` to confirm the change."
      )
    )
  end

  def status(conn, _params) do
    actor = conn.assigns.current_user

    json(conn, %{
      enrolled: not is_nil(actor.totp_confirmed_at),
      confirmed_at: actor.totp_confirmed_at,
      recovery_codes_remaining: length(actor.recovery_codes || []),
      required: MFA.mfa_required?(actor),
      grace_deadline: grace_deadline(actor)
    })
  end

  # ----- login-time verify (anonymous) ----------------------------

  def verify(conn, %{"mfa_token" => mfa_token, "code" => code}) do
    remote_ip = SecurityLog.remote_ip(conn)

    with {:ok, user} <- Accounts.verify_mfa_challenge(mfa_token),
         result when result != {:error, :invalid_code} and result != {:error, :not_confirmed} <-
           MFA.verify(user, code) do
      case result do
        :ok ->
          SecurityLog.record(:mfa_verify_success,
            user_id: user.id,
            email: user.email,
            remote_ip: remote_ip,
            via: :totp
          )

          json(conn, %{token: Accounts.sign_token(user), user: Payloads.user(user)})

        {:recovery_used, updated} ->
          SecurityLog.record(:mfa_verify_success,
            user_id: updated.id,
            email: updated.email,
            remote_ip: remote_ip,
            via: :recovery,
            codes_remaining: length(updated.recovery_codes)
          )

          json(conn, %{
            token: Accounts.sign_token(updated),
            user: Payloads.user(updated),
            recovery_codes_remaining: length(updated.recovery_codes)
          })
      end
    else
      {:error, :invalid_mfa_challenge} ->
        conn
        |> put_status(:unauthorized)
        |> json(
          Errors.payload(
            "invalid_or_expired_challenge",
            "This MFA session has expired. Sign in with email + password again."
          )
        )

      {:error, :invalid_code} ->
        SecurityLog.record(:mfa_verify_failure,
          remote_ip: remote_ip,
          reason: :invalid_code
        )

        conn
        |> put_status(:unauthorized)
        |> json(
          Errors.payload(
            "invalid_code",
            "That code didn't match. Try again or use a recovery code."
          )
        )

      {:error, :not_confirmed} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "mfa_not_enrolled",
            "This account isn't MFA-enrolled — sign in without a code."
          )
        )
    end
  end

  def verify(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(Errors.payload("mfa_token_and_code_required", "Send `mfa_token` and `code`."))
  end

  # ----- helpers --------------------------------------------------

  defp grace_deadline(%{mfa_required_at: nil}), do: nil

  defp grace_deadline(%{mfa_required_at: %DateTime{} = t}) do
    DateTime.add(t, 7 * 24 * 60 * 60, :second)
  end
end
