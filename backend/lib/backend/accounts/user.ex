defmodule Backend.Accounts.User do
  @moduledoc """
  A staff user of PSP. Email + bcrypt-hashed password.

  Two changesets:
    * `registration_changeset/2` — accepts a plaintext `:password` virtual
      field, hashes it into `:hashed_password`.
    * `profile_changeset/2` — for editing name/active flag without
      touching credentials.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @allowed_email_domain "vitamanufacture.co.uk"

  schema "users" do
    field :email, :string
    field :name, :string
    field :hashed_password, :string, redact: true
    field :password, :string, virtual: true, redact: true
    field :is_active, :boolean, default: true
    field :confirmed_at, :utc_datetime
    field :confirmation_token, :string, redact: true

    timestamps(type: :utc_datetime)
  end

  def allowed_email_domain, do: @allowed_email_domain

  def registration_changeset(user, attrs) do
    user
    |> cast(attrs, [:email, :name, :password, :is_active])
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

  def confirm_changeset(user) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    user
    |> change(confirmed_at: now, confirmation_token: nil)
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

  defp put_confirmation_token(%Ecto.Changeset{valid?: true} = cs) do
    token =
      :crypto.strong_rand_bytes(32)
      |> Base.url_encode64(padding: false)

    put_change(cs, :confirmation_token, token)
  end

  defp put_confirmation_token(cs), do: cs

  def profile_changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :is_active])
    |> validate_required([:name])
    |> validate_length(:name, min: 1, max: 120)
  end

  defp normalize_email(changeset) do
    case get_change(changeset, :email) do
      nil -> changeset
      email -> put_change(changeset, :email, String.downcase(String.trim(email)))
    end
  end

  defp put_hashed_password(%Ecto.Changeset{valid?: true, changes: %{password: password}} = cs) do
    cs
    |> put_change(:hashed_password, Bcrypt.hash_pwd_salt(password))
    |> delete_change(:password)
  end

  defp put_hashed_password(cs), do: cs

  @doc """
  Constant-time verification used by `Backend.Accounts.authenticate/2`.
  Falls back to a dummy hash check when the user is `nil` so the
  response time doesn't leak account existence.
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
