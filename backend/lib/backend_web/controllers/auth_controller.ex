defmodule BackendWeb.AuthController do
  use BackendWeb, :controller

  alias Backend.{Accounts, SecurityLog}
  alias BackendWeb.{Errors, Payloads}

  action_fallback BackendWeb.FallbackController

  # Brute-force / credential-stuffing throttles. Combining IP + email
  # on login stops a single-source spray without punishing a shared
  # office IP for one person's typo; IP-only on register/confirm
  # stops the sign-up spam vector.
  plug BackendWeb.Plugs.RateLimit,
       [scope: :login, limit: 10, window: 60, key: {:ip_and_param, "email"}]
       when action == :login

  plug BackendWeb.Plugs.RateLimit,
       [scope: :login_ip, limit: 30, window: 60, key: :ip]
       when action == :login

  plug BackendWeb.Plugs.RateLimit,
       [scope: :register, limit: 5, window: 3600, key: :ip]
       when action == :register

  plug BackendWeb.Plugs.RateLimit,
       [scope: :confirm, limit: 20, window: 3600, key: :ip]
       when action == :confirm

  def register(conn, params) do
    builder = &confirm_url_for_token/1
    email = params["email"]

    case Accounts.register_user(params, builder) do
      {:ok, user} ->
        SecurityLog.record(:register_success,
          user_id: user.id,
          email: user.email,
          remote_ip: SecurityLog.remote_ip(conn)
        )

        conn
        |> put_status(:created)
        |> json(%{
          status: "pending_confirmation",
          user: user_payload(user)
        })

      {:error, %Ecto.Changeset{} = changeset} ->
        SecurityLog.record(:register_failure,
          email: email,
          remote_ip: SecurityLog.remote_ip(conn),
          reason: :validation_failed
        )

        fields = Errors.changeset_fields(changeset)

        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "validation_failed",
            "Please correct the highlighted fields.",
            fields
          )
        )
    end
  end

  def confirm(conn, %{"token" => token}) do
    case Accounts.confirm_user_by_token(token) do
      {:ok, user} ->
        SecurityLog.record(:confirmation_success,
          user_id: user.id,
          email: user.email,
          remote_ip: SecurityLog.remote_ip(conn)
        )

        session_token = Accounts.sign_token(user)
        json(conn, %{token: session_token, user: user_payload(user)})

      {:error, :invalid_token} ->
        SecurityLog.record(:confirmation_failure,
          remote_ip: SecurityLog.remote_ip(conn),
          reason: :invalid_token
        )

        conn
        |> put_status(:not_found)
        |> json(
          Errors.payload(
            "invalid_or_expired_token",
            "This confirmation link is invalid or has already been used."
          )
        )

      {:error, %Ecto.Changeset{} = cs} ->
        SecurityLog.record(:confirmation_failure,
          remote_ip: SecurityLog.remote_ip(conn),
          reason: :validation_failed
        )

        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "validation_failed",
            "Couldn't update the account.",
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
        "token_required",
        "A confirmation token is required."
      )
    )
  end

  def login(conn, %{"email" => email, "password" => password}) do
    remote_ip = SecurityLog.remote_ip(conn)

    case Accounts.authenticate(email, password) do
      {:ok, user} ->
        SecurityLog.record(:login_success,
          user_id: user.id,
          email: user.email,
          remote_ip: remote_ip
        )

        token = Accounts.sign_token(user)
        json(conn, %{token: token, user: user_payload(user)})

      {:error, :unconfirmed} ->
        SecurityLog.record(:login_unconfirmed,
          email: normalise_email(email),
          remote_ip: remote_ip
        )

        conn
        |> put_status(:forbidden)
        |> json(
          Errors.payload(
            "email_not_confirmed",
            "Your email isn't confirmed yet. Check your inbox for the confirmation link."
          )
        )

      {:error, :invalid_credentials} ->
        SecurityLog.record(:login_failure,
          email: normalise_email(email),
          remote_ip: remote_ip,
          reason: :invalid_credentials
        )

        conn
        |> put_status(:unauthorized)
        |> json(
          Errors.payload(
            "invalid_credentials",
            "That email and password combination didn't work."
          )
        )
    end
  end

  def login(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(
      Errors.payload(
        "email_and_password_required",
        "Email and password are required."
      )
    )
  end

  def me(conn, _params) do
    json(conn, %{user: user_payload(conn.assigns.current_user)})
  end

  ## ------------------------------------------------------------------

  # Where the customer is sent to click "I confirm". Resolved from the
  # PSP_FRONTEND_URL env var so this works in local dev (Next on :3010)
  # and in production without code changes.
  defp confirm_url_for_token(token) do
    frontend = System.get_env("PSP_FRONTEND_URL", "http://localhost:3010")
    "#{frontend}/confirm?token=#{token}"
  end

  defp user_payload(user), do: Payloads.user(user)

  # Normalise the email the same way `Accounts.get_user_by_email/1`
  # does so the log entry matches what would appear on the user
  # record. Avoids case-drift when correlating events.
  defp normalise_email(nil), do: nil

  defp normalise_email(email) when is_binary(email),
    do: email |> String.trim() |> String.downcase()
end
