defmodule Backend.Warehouses.StorageTag do
  @moduledoc """
  Company-scoped vocabulary used by `storage_locations.tags` and
  `storage_cells.tags`. Free-text on those columns was producing
  inconsistent spellings (`cold-zone`, `Cold Zone`, `cold zone`); a
  managed registry means everything sharing the same `key` is the
  same tag, and the allocation engine can join on it cheaply.

  Three `kind`s:
    * `location` — only valid on `storage_locations.tags`
    * `cell`     — only valid on `storage_cells.tags`
    * `both`     — valid on either (default; covers most cases)

  Admins manage the list at `/settings/storage-tags`. Operators pick
  from it via a chip-picker in the LocationBody and CellsDialog.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company

  @valid_kinds ~w(location cell both)

  schema "storage_tags" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :key, :string
    field :label, :string
    field :description, :string
    field :kind, :string, default: "both"

    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  def valid_kinds, do: @valid_kinds

  def changeset(tag, attrs) do
    tag
    |> cast(attrs, [
      :company_id,
      :key,
      :label,
      :description,
      :kind,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :key, :label])
    |> normalise_key()
    |> validate_length(:key, min: 1, max: 60)
    |> validate_length(:label, min: 1, max: 80)
    |> validate_format(:key, ~r/\A[a-z0-9][a-z0-9-]*\z/,
      message: "must be lowercase letters / digits / hyphens"
    )
    |> validate_inclusion(:kind, @valid_kinds,
      message: "must be one of: #{Enum.join(@valid_kinds, ", ")}"
    )
    |> unique_constraint([:company_id, :key],
      name: :storage_tags_company_id_key_index,
      message: "this key is already in use"
    )
  end

  # Same lowercase + trim treatment as the inline arrays so a
  # picker round-trip never produces a mismatch.
  defp normalise_key(changeset) do
    case get_change(changeset, :key) do
      nil ->
        changeset

      raw when is_binary(raw) ->
        put_change(
          changeset,
          :key,
          raw |> String.trim() |> String.downcase()
        )

      _ ->
        changeset
    end
  end
end
