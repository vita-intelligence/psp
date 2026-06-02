defmodule BackendWeb.AuthController do
  use BackendWeb, :controller

  alias Backend.Accounts
  alias BackendWeb.{Errors, Payloads}

  action_fallback BackendWeb.FallbackController

  def register(conn, params) do
    builder = &confirm_url_for_token/1

    case Accounts.register_user(params, builder) do
      {:ok, user} ->
        conn
        |> put_status(:created)
        |> json(%{
          status: "pending_confirmation",
          user: user_payload(user)
        })

      {:error, %Ecto.Changeset{} = changeset} ->
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
        session_token = Accounts.sign_token(user)
        json(conn, %{token: session_token, user: user_payload(user)})

      {:error, :invalid_token} ->
        conn
        |> put_status(:not_found)
        |> json(
          Errors.payload(
            "invalid_or_expired_token",
            "This confirmation link is invalid or has already been used."
          )
        )

      {:error, %Ecto.Changeset{} = cs} ->
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
    case Accounts.authenticate(email, password) do
      {:ok, user} ->
        token = Accounts.sign_token(user)
        json(conn, %{token: token, user: user_payload(user)})

      {:error, :unconfirmed} ->
        conn
        |> put_status(:forbidden)
        |> json(
          Errors.payload(
            "email_not_confirmed",
            "Your email isn't confirmed yet. Check your inbox for the confirmation link."
          )
        )

      {:error, :invalid_credentials} ->
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
  # PSP_FRONTEND_URL env var so this works in local dev (Next on :3000)
  # and in production without code changes.
  defp confirm_url_for_token(token) do
    frontend = System.get_env("PSP_FRONTEND_URL", "http://localhost:3000")
    "#{frontend}/confirm?token=#{token}"
  end

  defp user_payload(user), do: Payloads.user(user)
end
