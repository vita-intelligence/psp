defmodule Backend.Accounts.IntegrationToken do
  @moduledoc """
  Long-lived bearer credential for machine-to-machine API callers.
  vita-performance is the first consumer; more are expected.

  Distinct from `Backend.Accounts.User` session tokens because:

    * Not tied to a person's login — bumping a user's `token_version`
      shouldn't silently break every kiosk on the shop floor.
    * No password-reset / MFA flow — revocation is the only lifecycle
      event after issue.
    * Scope-gated at the plug level rather than permission-gated at
      the controller level, so the audit "what did this integration
      touch?" is answerable in one query.

  Storage: bcrypt hash + a public prefix. See migration for the
  storage rationale.

  Changesets:

    * `create_changeset/2` — hashes a freshly-minted raw token, stamps
      prefix + creator. Called by `Backend.IntegrationTokens.create/2`.
    * `revoke_changeset/2` — soft-deletes: is_active → false, plus
      revoked_at / revoked_by / revoke_reason.
    * `touch_last_used_changeset/1` — bumps last_used_at.
  """

  use Ecto.Schema
  import Ecto.Changeset

  # Scopes the token can hold. Extend this list when adding new
  # capability tokens for other integrations.
  @known_scopes ~w(
    mo:read
    mo:write:session
    mo:transition
    workstation:read
    item:read
    user:read
    hr:read
    hr:write:pin
    hr:write:reputation
  )

  @doc "Whitelist of scope strings this schema accepts."
  def known_scopes, do: @known_scopes

  schema "integration_tokens" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :name, :string
    field :token_hash, :string, redact: true
    field :token_prefix, :string
    field :scopes, {:array, :string}, default: []
    field :is_active, :boolean, default: true
    field :revoked_at, :utc_datetime
    field :revoke_reason, :string
    field :last_used_at, :utc_datetime

    belongs_to :company, Backend.Companies.Company
    belongs_to :created_by, Backend.Accounts.User, foreign_key: :created_by_id
    belongs_to :revoked_by, Backend.Accounts.User, foreign_key: :revoked_by_id

    timestamps(type: :utc_datetime)
  end

  @doc """
  Attach a freshly-minted raw token to a changeset. The caller
  generates the raw string (via `Backend.IntegrationTokens.mint_raw/0`)
  because the plaintext must leave the boundary to be handed to the
  operator once — it is never persisted.
  """
  def create_changeset(struct, attrs) do
    struct
    |> cast(attrs, [:name, :token_hash, :token_prefix, :scopes, :company_id, :created_by_id])
    |> validate_required([:name, :token_hash, :token_prefix, :company_id])
    |> validate_length(:name, min: 1, max: 100)
    |> validate_subset(:scopes, @known_scopes)
    |> validate_scopes_not_empty()
    |> unique_constraint(:name,
      name: :integration_tokens_company_id_name_index,
      message: "another token already uses this name"
    )
    |> unique_constraint(:token_prefix)
  end

  # `field :scopes, ..., default: []` means casting `%{scopes: []}`
  # doesn't register a change, so `validate_length(:scopes, min: 1)`
  # never runs. `get_field/2` returns the effective value regardless
  # of whether it came from a change or the default, so we can catch
  # both cases here.
  defp validate_scopes_not_empty(changeset) do
    case get_field(changeset, :scopes) do
      list when is_list(list) and list == [] ->
        add_error(changeset, :scopes, "must grant at least one scope")

      _ ->
        changeset
    end
  end

  @doc """
  Soft-delete: sets `is_active` → false and records who did it and
  why. The row stays in the table so historical audit references
  keep resolving.
  """
  def revoke_changeset(token, attrs) do
    token
    |> cast(attrs, [:revoked_by_id, :revoke_reason])
    |> validate_required([:revoked_by_id])
    |> put_change(:is_active, false)
    |> put_change(:revoked_at, DateTime.utc_now() |> DateTime.truncate(:second))
  end

  @doc "Bump `last_used_at` on every successful authenticate."
  def touch_last_used_changeset(token) do
    change(token, last_used_at: DateTime.utc_now() |> DateTime.truncate(:second))
  end
end
