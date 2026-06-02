defmodule Backend.Accounts do
  @moduledoc """
  Boundary for user accounts: registration, login, lookup, listing.

  Tokens are stateless `Phoenix.Token` strings signed with the endpoint
  secret. Verify via `verify_token/1`. Renewal is just "sign a new one"
  — no refresh-token dance for v1.
  """

  import Ecto.Query, warn: false
  alias Backend.Repo
  alias Backend.Accounts.{User, Notifier}

  @token_salt "psp user auth"
  # 30 days; enough for daily-driver workers.
  @token_max_age_seconds 60 * 60 * 24 * 30

  ## Lookups -----------------------------------------------------------

  def get_user!(id), do: Repo.get!(User, id)
  def get_user(id), do: Repo.get(User, id)

  def get_user_by_email(email) when is_binary(email) do
    Repo.get_by(User, email: String.downcase(String.trim(email)))
  end

  def list_users do
    User
    |> order_by([u], asc: u.name)
    |> Repo.all()
  end

  ## Registration / auth ----------------------------------------------

  @doc """
  Inserts the user (rejected if the email isn't `@vitamanufacture.co.uk`
  per `User.registration_changeset/2`), and dispatches the confirmation
  email. The caller supplies a URL builder so we don't couple the
  context to the web layer.
  """
  def register_user(attrs, confirm_url_builder) when is_function(confirm_url_builder, 1) do
    with {:ok, user} <- %User{} |> User.registration_changeset(attrs) |> Repo.insert() do
      _ = Notifier.deliver_confirmation(user, confirm_url_builder.(user.confirmation_token))
      {:ok, user}
    end
  end

  def confirm_user_by_token(token) when is_binary(token) and byte_size(token) > 0 do
    case Repo.get_by(User, confirmation_token: token) do
      nil ->
        {:error, :invalid_token}

      user ->
        user
        |> User.confirm_changeset()
        |> Repo.update()
    end
  end

  def confirm_user_by_token(_), do: {:error, :invalid_token}

  @doc """
  Returns `{:ok, user}` on success, `{:error, :unconfirmed}` if the user
  exists with valid credentials but hasn't clicked the email link yet,
  or `{:error, :invalid_credentials}` for everything else. Generic
  failure mode never leaks email-vs-password.
  """
  def authenticate(email, password) when is_binary(email) and is_binary(password) do
    user = get_user_by_email(email)

    cond do
      is_nil(user) ->
        # Constant-time dummy hash check.
        User.valid_password?(nil, password)
        {:error, :invalid_credentials}

      !user.is_active ->
        {:error, :invalid_credentials}

      !User.valid_password?(user, password) ->
        {:error, :invalid_credentials}

      is_nil(user.confirmed_at) ->
        {:error, :unconfirmed}

      true ->
        {:ok, user}
    end
  end

  def authenticate(_, _), do: {:error, :invalid_credentials}

  ## Tokens -----------------------------------------------------------

  def sign_token(%User{id: id}) do
    Phoenix.Token.sign(BackendWeb.Endpoint, @token_salt, id)
  end

  def verify_token(token) when is_binary(token) do
    case Phoenix.Token.verify(BackendWeb.Endpoint, @token_salt, token,
           max_age: @token_max_age_seconds
         ) do
      {:ok, user_id} -> {:ok, get_user(user_id)}
      {:error, reason} -> {:error, reason}
    end
  end

  def verify_token(_), do: {:error, :missing}
end
