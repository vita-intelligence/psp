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
  alias BackendWeb.Errors

  action_fallback BackendWeb.FallbackController

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
    frontend = System.get_env("PSP_FRONTEND_URL", "http://localhost:3000")
    "#{frontend}/reset-password?token=#{token}"
  end

  defp user_payload(user) do
    %{
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      is_active: user.is_active,
      confirmed_at: user.confirmed_at,
      inserted_at: user.inserted_at
    }
  end
end
