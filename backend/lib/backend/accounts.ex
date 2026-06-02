defmodule Backend.Accounts do
  @moduledoc """
  Boundary for user accounts: registration, login, lookup, listing,
  profile/password updates, password reset.

  Session tokens are stateless `Phoenix.Token` strings signed with the
  endpoint secret. Verify via `verify_token/1`. Renewal is just "sign
  a new one" — no refresh-token dance for v1.

  Password-reset tokens (separate from session tokens) live on the
  user row, are single-use, and expire after
  `User.password_reset_validity_seconds/0`.
  """

  import Ecto.Query, warn: false
  alias Backend.Repo
  alias Backend.Accounts.{User, Notifier}
  alias Backend.Companies
  alias Backend.RBAC

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

  def register_user(attrs, confirm_url_builder) when is_function(confirm_url_builder, 1) do
    # Bootstrap the company singleton + system roles if they don't
    # exist yet. Idempotent.
    company = Companies.current()
    attrs_with_company = Map.put(stringify_keys(attrs), "company_id", company.id)

    with {:ok, user} <-
           %User{}
           |> User.registration_changeset(attrs_with_company)
           |> Repo.insert() do
      # Bootstrap policy: the very first user to land becomes Owner.
      # Subsequent users get the Member role and can be promoted via
      # the future admin UI.
      role =
        if first_user?(company.id, user.id) do
          RBAC.get_role_by_slug(company.id, "owner")
        else
          RBAC.get_role_by_slug(company.id, "member")
        end

      {:ok, user} = RBAC.assign_role(user, role)

      _ = Notifier.deliver_confirmation(user, confirm_url_builder.(user.confirmation_token))
      {:ok, user}
    end
  end

  defp first_user?(company_id, user_id) do
    Repo.aggregate(
      from(u in User, where: u.company_id == ^company_id and u.id != ^user_id),
      :count
    ) == 0
  end

  defp stringify_keys(attrs) do
    Enum.into(attrs, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
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

  def authenticate(email, password) when is_binary(email) and is_binary(password) do
    user = get_user_by_email(email)

    cond do
      is_nil(user) ->
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

  ## Profile / password ------------------------------------------------

  def update_profile(%User{} = user, attrs) do
    user
    |> User.profile_changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Change the password for an authenticated user. Requires the user's
  current password as proof; on success, sends a notification email so
  account takeover attempts show up in the user's inbox.
  """
  def change_password(%User{} = user, attrs) do
    with {:ok, updated} <- user |> User.password_changeset(attrs) |> Repo.update() do
      _ = Notifier.deliver_password_changed(updated)
      {:ok, updated}
    end
  end

  ## Password reset ---------------------------------------------------

  @doc """
  Mint a reset token for the user with this email and email them the
  link. **Always returns `:ok`** — callers must not branch on
  presence/absence of the account, otherwise the endpoint becomes an
  account-enumeration oracle.
  """
  def request_password_reset(email, url_builder) when is_function(url_builder, 1) do
    case get_user_by_email(email) do
      %User{} = user ->
        with {:ok, updated} <-
               user |> User.password_reset_request_changeset() |> Repo.update() do
          _ = Notifier.deliver_password_reset(updated, url_builder.(updated.password_reset_token))
          :ok
        else
          _ -> :ok
        end

      nil ->
        # Dummy delay roughly matching a successful path keeps timing
        # consistent — bcrypt isn't involved here but the email I/O
        # would be, so simulate it.
        Process.sleep(50)
        :ok
    end
  end

  @doc """
  Consume the reset token, set the new password, and (on success)
  return the user so the caller can sign a fresh session token.
  """
  def reset_password_by_token(token, attrs) when is_binary(token) and byte_size(token) > 0 do
    case Repo.get_by(User, password_reset_token: token) do
      nil ->
        {:error, :invalid_token}

      %User{} = user ->
        if User.password_reset_expired?(user) do
          {:error, :expired_token}
        else
          with {:ok, updated} <-
                 user |> User.password_reset_changeset(attrs) |> Repo.update() do
            _ = Notifier.deliver_password_changed(updated)
            {:ok, updated}
          end
        end
    end
  end

  def reset_password_by_token(_, _), do: {:error, :invalid_token}

  ## Session tokens ---------------------------------------------------

  def sign_token(%User{id: id}) do
    Phoenix.Token.sign(BackendWeb.Endpoint, @token_salt, id)
  end

  def verify_token(token) when is_binary(token) do
    case Phoenix.Token.verify(BackendWeb.Endpoint, @token_salt, token,
           max_age: @token_max_age_seconds
         ) do
      {:ok, user_id} ->
        # Preload roles eagerly so every downstream permission check
        # is a no-op lookup. Avoids N+1 across the request lifecycle.
        case get_user(user_id) do
          nil -> {:error, :invalid}
          user -> {:ok, Repo.preload(user, :roles)}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  def verify_token(_), do: {:error, :missing}
end
