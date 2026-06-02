defmodule Backend.Accounts.User do
  @moduledoc """
  A staff user of PSP. Email + bcrypt-hashed password.

  Changesets:
    * `registration_changeset/2` — new account, hashes password.
    * `profile_changeset/2` — name + avatar update (no credentials).
    * `password_changeset/2` — change current password (requires the
      current one to match).
    * `password_reset_request_changeset/2` — mints a single-use reset
      token + timestamp.
    * `password_reset_changeset/2` — consumes the token, sets new pw.
    * `confirm_changeset/1` — marks the email as confirmed.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @allowed_email_domain "vitamanufacture.co.uk"
  # Cap a base64-encoded avatar at ~512KB pre-decode to keep DB rows
  # bounded. Roughly = 384KB raw image.
  @max_avatar_bytes 512 * 1024
  # Tokens expire 1h after they're sent — long enough for a coffee
  # break, short enough that a stolen email link stops working soon.
  @password_reset_validity_seconds 3600

  schema "users" do
    # Public identifier exposed in URLs / API paths / channel topics.
    # Integer PK stays for cheaper FKs and denser indexes — it just
    # never leaves the backend.
    field :uuid, Ecto.UUID, autogenerate: true
    field :email, :string
    field :name, :string
    field :avatar, :string
    field :hashed_password, :string, redact: true
    field :password, :string, virtual: true, redact: true
    field :current_password, :string, virtual: true, redact: true
    field :is_active, :boolean, default: true
    field :confirmed_at, :utc_datetime
    field :confirmation_token, :string, redact: true
    field :password_reset_token, :string, redact: true
    field :password_reset_sent_at, :utc_datetime

    # Per-user RBAC. `is_admin` short-circuits every permission check;
    # `permissions` is the direct grant array (whatever the matrix UI
    # last wrote). No role association — permission templates exist
    # but they're pure presets, not persistent assignments.
    field :is_admin, :boolean, default: false
    field :permissions, {:array, :string}, default: []
    field :hourly_wage, :decimal

    belongs_to :company, Backend.Companies.Company

    timestamps(type: :utc_datetime)
  end

  def allowed_email_domain, do: @allowed_email_domain
  def password_reset_validity_seconds, do: @password_reset_validity_seconds

  ## Registration --------------------------------------------------------

  def registration_changeset(user, attrs) do
    user
    |> cast(attrs, [:email, :name, :password, :is_active, :company_id])
    |> validate_required([:email, :name, :password])
    |> validate_format(:email, ~r/^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "invalid email")
    |> validate_length(:email, max: 160)
    |> validate_length(:name, min: 1, max: 120)
    |> validate_length(:password, min: 8, max: 72)
    |> normalize_email()
    |> validate_email_domain()
    |> unique_constraint(:email)
    |> put_hashed_password()
    |> put_confirmation_token()
  end

  ## Profile (name + avatar) --------------------------------------------

  def profile_changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :avatar])
    |> validate_required([:name])
    |> validate_length(:name, min: 1, max: 120)
    |> validate_avatar()
  end

  ## Password change (authenticated) ------------------------------------

  def password_changeset(user, attrs) do
    user
    |> cast(attrs, [:current_password, :password])
    |> validate_required([:current_password, :password])
    |> validate_length(:password, min: 8, max: 72)
    |> validate_current_password()
    |> put_hashed_password()
  end

  ## Password reset (token-based, anonymous start) ----------------------

  def password_reset_request_changeset(user) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)
    token = generate_url_token()

    user
    |> change(password_reset_token: token, password_reset_sent_at: now)
  end

  def password_reset_changeset(user, attrs) do
    user
    |> cast(attrs, [:password])
    |> validate_required([:password])
    |> validate_length(:password, min: 8, max: 72)
    |> put_hashed_password()
    |> put_change(:password_reset_token, nil)
    |> put_change(:password_reset_sent_at, nil)
  end

  def password_reset_expired?(%__MODULE__{password_reset_sent_at: nil}), do: true

  def password_reset_expired?(%__MODULE__{password_reset_sent_at: sent_at}) do
    DateTime.diff(DateTime.utc_now(), sent_at, :second) > @password_reset_validity_seconds
  end

  ## Confirmation -------------------------------------------------------

  def confirm_changeset(user) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    user
    |> change(confirmed_at: now, confirmation_token: nil)
  end

  ## Helpers ------------------------------------------------------------

  defp normalize_email(changeset) do
    case get_change(changeset, :email) do
      nil -> changeset
      email -> put_change(changeset, :email, String.downcase(String.trim(email)))
    end
  end

  defp validate_email_domain(changeset) do
    validate_change(changeset, :email, fn :email, email ->
      if String.ends_with?(email, "@" <> @allowed_email_domain) do
        []
      else
        [email: "must be a @#{@allowed_email_domain} address"]
      end
    end)
  end

  defp validate_avatar(changeset) do
    case get_change(changeset, :avatar) do
      nil ->
        changeset

      "" ->
        # An empty string clears the avatar — normalise to nil.
        put_change(changeset, :avatar, nil)

      value when is_binary(value) ->
        cond do
          byte_size(value) > @max_avatar_bytes ->
            add_error(changeset, :avatar, "is too large (max ~500KB encoded)")

          not String.starts_with?(value, "data:image/") ->
            add_error(changeset, :avatar, "must be an image data URL")

          true ->
            changeset
        end

      _ ->
        add_error(changeset, :avatar, "must be a string data URL")
    end
  end

  defp validate_current_password(changeset) do
    current = get_change(changeset, :current_password)
    user = changeset.data

    cond do
      changeset.valid? == false ->
        changeset

      is_nil(current) ->
        changeset

      not valid_password?(user, current) ->
        add_error(changeset, :current_password, "is incorrect")

      true ->
        changeset
    end
  end

  defp put_hashed_password(%Ecto.Changeset{valid?: true, changes: %{password: password}} = cs) do
    cs
    |> put_change(:hashed_password, Bcrypt.hash_pwd_salt(password))
    |> delete_change(:password)
    |> delete_change(:current_password)
  end

  defp put_hashed_password(cs), do: cs

  defp put_confirmation_token(%Ecto.Changeset{valid?: true} = cs) do
    put_change(cs, :confirmation_token, generate_url_token())
  end

  defp put_confirmation_token(cs), do: cs

  defp generate_url_token do
    :crypto.strong_rand_bytes(32) |> Base.url_encode64(padding: false)
  end

  @doc """
  Constant-time verification used by `Backend.Accounts.authenticate/2`
  and the password-change changeset. Falls back to a dummy hash check
  when the user is `nil` so the response time doesn't leak account
  existence.
  """
  def valid_password?(%__MODULE__{hashed_password: hash}, password)
      when is_binary(hash) and byte_size(password) > 0 do
    Bcrypt.verify_pass(password, hash)
  end

  def valid_password?(_, _) do
    Bcrypt.no_user_verify()
    false
  end
end
