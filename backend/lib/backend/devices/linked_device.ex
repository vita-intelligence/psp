defmodule Backend.Devices.LinkedDevice do
  @moduledoc """
  One phone / tablet / extra browser paired to a user account. The raw
  bearer token only ever exists in memory during the claim response —
  the row stores `token_hash` (SHA256) so a DB dump leaks nothing
  usable.

  Revocation is forward-only: `revoked_at` is set, the row stays for
  audit. `Backend.Devices.authenticate_token/1` filters out revoked
  rows at lookup time.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company

  @platforms ~w(ios android web other)

  def platforms, do: @platforms

  schema "linked_devices" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :label, :string
    field :platform, :string
    field :user_agent, :string
    field :token_hash, :binary
    field :last_seen_at, :utc_datetime
    field :paired_at, :utc_datetime
    field :revoked_at, :utc_datetime

    belongs_to :user, User
    belongs_to :company, Company

    timestamps(type: :utc_datetime)
  end

  @doc false
  def claim_changeset(device, attrs) do
    device
    |> cast(attrs, [
      :user_id,
      :company_id,
      :label,
      :platform,
      :user_agent,
      :token_hash,
      :paired_at,
      :last_seen_at
    ])
    |> validate_required([:user_id, :company_id, :label, :token_hash, :paired_at])
    |> validate_length(:label, min: 1, max: 80)
    |> maybe_validate_inclusion(:platform, @platforms)
    |> unique_constraint(:token_hash)
  end

  @doc false
  def touch_changeset(device, attrs) do
    cast(device, attrs, [:last_seen_at])
  end

  @doc false
  def revoke_changeset(device, attrs) do
    device
    |> cast(attrs, [:revoked_at])
    |> validate_required([:revoked_at])
  end

  defp maybe_validate_inclusion(changeset, field, allowed) do
    case get_field(changeset, field) do
      nil -> changeset
      _ -> validate_inclusion(changeset, field, allowed)
    end
  end
end
