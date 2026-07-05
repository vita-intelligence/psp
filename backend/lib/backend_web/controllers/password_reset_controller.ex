defmodule BackendWeb.PasswordResetController do
  @moduledoc """
  Anonymous endpoints — neither requires an authenticated session.

  Both endpoints are deliberately quiet about whether an account
  exists. `request/2` always returns 202 so an attacker can't probe
  the user table by submitting emails; `confirm/2` exposes a generic
  "invalid or expired" error so a stolen token can't be distinguished
  from a fake one.
  """

  use BackendWeb, :controller

  alias Backend.Accounts
  alias BackendWeb.{Errors, Payloads}

  action_fallback BackendWeb.FallbackController

  # `request` triggers an email; without a throttle, an attacker
  # spams the inbox of every enumerated user OR uses the endpoint
  # to punish an SES / Postmark quota. Per-email cap on top of a
  # per-IP cap.
  plug BackendWeb.Plugs.RateLimit,
       [scope: :reset_request_email, limit: 3, window: 3600, key: {:param, "email"}]
       when action == :request

  plug BackendWeb.Plugs.RateLimit,
       [scope: :reset_request_ip, limit: 20, window: 3600, key: :ip]
       when action == :request

  # `confirm` accepts a token — brute-forcing the token space would
  # need many attempts. Modest cap to make that expensive.
  plug BackendWeb.Plugs.RateLimit,
       [scope: :reset_confirm, limit: 10, window: 3600, key: :ip]
       when action == :confirm

  def request(conn, %{"email" => email}) when is_binary(email) do
    url_builder = &reset_url_for_token/1
    :ok = Accounts.request_password_reset(email, url_builder)

    conn
    |> put_status(:accepted)
    |> json(%{
      status: "ok",
      detail:
        "If an account exists for that email, a reset link is on its way. Check your inbox in a minute."
    })
  end

  def request(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(Errors.payload("email_required", "An email address is required."))
  end

  def confirm(conn, %{"token" => token, "password" => password}) do
    case Accounts.reset_password_by_token(token, %{"password" => password}) do
      {:ok, user} ->
        session_token = Accounts.sign_token(user)
        json(conn, %{token: session_token, user: user_payload(user)})

      {:error, :invalid_token} ->
        conn
        |> put_status(:not_found)
        |> json(
          Errors.payload(
            "invalid_or_expired_token",
            "This password reset link is invalid or has already been used."
          )
        )

      {:error, :expired_token} ->
        conn
        |> put_status(:gone)
        |> json(
          Errors.payload(
            "invalid_or_expired_token",
            "This password reset link has expired. Request a new one."
          )
        )

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "validation_failed",
            "Please choose a stronger password.",
            Errors.changeset_fields(cs)
          )
        )
    end
  end

  def confirm(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(
      Errors.payload(
        "token_and_password_required",
        "A token and a new password are required."
      )
    )
  end

  ## ------------------------------------------------------------------

  defp reset_url_for_token(token) do
    frontend = System.get_env("PSP_FRONTEND_URL", "http://localhost:3010")
    "#{frontend}/reset-password?token=#{token}"
  end

  defp user_payload(user), do: Payloads.user(user)
end
