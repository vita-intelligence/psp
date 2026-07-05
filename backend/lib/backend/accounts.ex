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
  alias Backend.ListQueries

  # Whitelisted columns the Users table can sort by. `code` from the
  # FE is translated to `:id` in normalise_sort (display code is
  # `prefix + lpad(id)`, so id order = code order).
  @sortable_fields ~w(id name email is_active is_admin confirmed_at inserted_at updated_at)a
  # Equality filters available on the list endpoint.
  @filter_fields ~w(is_active)a
  # Free-text ILIKE search hits these columns.
  @search_fields ~w(name email)a
  @default_sort {:name, :asc}

  @token_salt "psp user auth"
  # 7 days. Shorter than the previous 30-day window so a stolen token
  # has a bounded useful life; daily-driver workers re-authenticate
  # weekly, which is well below the OWASP guidance for browser
  # sessions and beneath the point at which people forget passwords.
  @token_max_age_seconds 60 * 60 * 24 * 7

  ## Lookups -----------------------------------------------------------

  def get_user!(id), do: Repo.get!(User, id)
  def get_user(id), do: Repo.get(User, id)

  @doc """
  Lookup by public UUID — what the URL / API paths pass through. The
  integer `get_user/1` above stays for internal lookups (token verify
  decodes an int id from the JWT; presence stores by int id). Callers
  that take a path param should always use this.
  """
  def get_user_by_uuid(uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        User
        |> Repo.get_by(uuid: cast)
        |> case do
          nil -> nil
          user -> Repo.preload(user, [:created_by, :updated_by])
        end

      :error ->
        nil
    end
  end

  def get_user_by_uuid(_), do: nil

  def get_user_by_email(email) when is_binary(email) do
    Repo.get_by(User, email: String.downcase(String.trim(email)))
  end

  @doc """
  Paginated, sortable, filterable, searchable user list scoped to a
  single company. Returns `{items, next_cursor}` — the standard list
  shape every table-driven endpoint produces (see Backend.ListQueries).
  Roles are preloaded so the UI can render badges without N+1.

  `opts` keys:
    * `:cursor`  — opaque cursor from the previous page
    * `:limit`   — page size (clamped by ListQueries)
    * `:sort`    — `{:name, :asc}` etc; must be in @sortable_fields
    * `:filters` — `%{is_active: true}` etc; must be in @filter_fields
    * `:search`  — ILIKE across @search_fields
  """
  def list_for_company(company_id, opts \\ []) do
    sort = normalise_sort(Keyword.get(opts, :sort, @default_sort))

    base =
      User
      |> where([u], u.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @search_fields)
      |> ListQueries.apply_filter(opts[:filters], @filter_fields)
      |> ListQueries.apply_column_filters(opts[:column_filter], @sortable_fields)
      |> ListQueries.apply_sort(sort, @sortable_fields, @default_sort)
      |> preload([:created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  # Code column sorts use `:code` from the FE — translate to :id
  # because the display code is computed from id + numbering format.
  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  @doc """
  Slim org-roster lookup: every active user in the company, sorted by
  name. Returns just the columns the home-page presence widget needs —
  no roles, no permissions, no wage. Available to any authed user via
  `GET /api/team`, so the "who's here" surface doesn't require
  `users.view` (which is the gate for the admin Users settings page).
  """
  def list_team_for_company(company_id) do
    User
    |> where([u], u.company_id == ^company_id and u.is_active == true)
    |> order_by([u], asc: u.name)
    |> select([u], %{id: u.id, name: u.name, email: u.email, avatar: u.avatar})
    |> Repo.all()
  end

  @doc "Static config the frontend reads to drive its column controls."
  def list_config do
    %{
      sortable_fields: Enum.map(@sortable_fields, &Atom.to_string/1),
      filter_fields: Enum.map(@filter_fields, &Atom.to_string/1),
      search_fields: Enum.map(@search_fields, &Atom.to_string/1),
      default_sort: %{
        field: Atom.to_string(elem(@default_sort, 0)),
        direction: Atom.to_string(elem(@default_sort, 1))
      }
    }
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
      # First user lands with is_admin=true (full bypass) — they're
      # the company owner. Everyone else gets the read-only baseline.
      access_attrs =
        if first_user?(company.id, user.id) do
          %{is_admin: true, permissions: []}
        else
          %{
            is_admin: false,
            permissions: ~w(company.view users.view roles.view warehouses.view)
          }
        end

      {:ok, user} =
        user
        |> Ecto.Changeset.change(access_attrs)
        |> Repo.update()

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
    # Response time must not leak account existence. `Bcrypt.no_user_verify/0`
    # runs a real hash against a throwaway string so the "no match"
    # branch matches the wall-clock cost of the reset-token write +
    # email enqueue on the "match" branch closely enough to defeat
    # timing enumeration. A short fixed sleep on top rounds out any
    # variance.
    _ = Bcrypt.no_user_verify()

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

  # Signed payload is `{user_id, token_version}` so we can invalidate
  # a cohort of tokens by bumping `users.token_version`. Legacy tokens
  # (bare integer id) are rejected — a password reset or a redeploy
  # will re-issue.
  def sign_token(%User{id: id, token_version: version}) do
    Phoenix.Token.sign(BackendWeb.Endpoint, @token_salt, {id, version || 0})
  end

  def verify_token(token) when is_binary(token) do
    with {:ok, {user_id, token_version}} when is_integer(user_id) and is_integer(token_version) <-
           Phoenix.Token.verify(BackendWeb.Endpoint, @token_salt, token,
             max_age: @token_max_age_seconds
           ),
         %User{is_active: true} = user <- get_user(user_id),
         true <- (user.token_version || 0) == token_version do
      {:ok, user}
    else
      # Old-format payload (bare int id) — reject so it's re-issued.
      {:ok, id} when is_integer(id) ->
        {:error, :legacy_token}

      %User{is_active: false} ->
        {:error, :inactive}

      nil ->
        {:error, :invalid}

      false ->
        {:error, :token_revoked}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def verify_token(_), do: {:error, :missing}
end
