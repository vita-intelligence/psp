defmodule BackendWeb.AuthController do
  use BackendWeb, :controller

  alias Backend.Accounts

  action_fallback BackendWeb.FallbackController

  def register(conn, params) do
    builder = &confirm_url_for_token/1

    case Accounts.register_user(params, builder) do
      {:ok, user} ->
        # No token returned — user has to confirm the email first.
        conn
        |> put_status(:created)
        |> json(%{
          status: "pending_confirmation",
          user: user_payload(user)
        })

      {:error, %Ecto.Changeset{} = changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: changeset_errors(changeset)})
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
        |> json(%{error: "invalid_or_expired_token"})

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: changeset_errors(cs)})
    end
  end

  def confirm(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "token_required"})
  end

  def login(conn, %{"email" => email, "password" => password}) do
    case Accounts.authenticate(email, password) do
      {:ok, user} ->
        token = Accounts.sign_token(user)
        json(conn, %{token: token, user: user_payload(user)})

      {:error, :unconfirmed} ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "email_not_confirmed"})

      {:error, :invalid_credentials} ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "invalid_credentials"})
    end
  end

  def login(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "email_and_password_required"})
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

  defp user_payload(user) do
    %{
      id: user.id,
      email: user.email,
      name: user.name,
      is_active: user.is_active,
      confirmed_at: user.confirmed_at,
      inserted_at: user.inserted_at
    }
  end

  defp changeset_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end
end
