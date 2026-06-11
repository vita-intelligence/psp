defmodule Backend.Warehouses.StorageCell do
  @moduledoc """
  One physical level / subdivision of a `StorageLocation`. A shelf
  with five usable levels has five rows here, ordered bottom-to-top
  via `ordinal`. Single-level zones (e.g. a pallet position on the
  ground) collapse to a single cell with `ordinal: 0`.

  Each cell carries its own physical dimensions in metres because
  real shelves taper — the top level of a rack is often shallower
  than the bottom — and freeform `tags` for the segregation rules
  engine to consume later.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Warehouses.StorageLocation

  # Compliance-driven cell intent. The auto-router maps lot statuses
  # onto these so a quarantine lot physically sits in a quarantine
  # cell, a rejected lot in a rejected cell, etc. — closing the gap
  # between the database status and the warehouse floor.
  @purposes ~w(regular quarantine hold rejected dispatch)
  def purposes, do: @purposes

  schema "storage_cells" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :ordinal, :integer, default: 0
    field :name, :string

    field :width_m, :decimal
    field :depth_m, :decimal
    field :height_m, :decimal

    field :max_weight_kg, :decimal

    # No fixed vocabulary — operators (or PO lines, later) write
    # whatever labels their domain needs. Segregation rules are data,
    # not code, so any new tag becomes addressable without a deploy.
    field :tags, {:array, :string}, default: []

    # Intent of this cell — drives auto-routing. See `@purposes`.
    field :purpose, :string, default: "regular"

    field :notes, :string

    # Marks system-managed slots (`"unregistered"` for now). Real
    # operator-owned cells leave it `nil`; the cell picker filters
    # `IS NOT NULL` out of the visible list.
    field :system_kind, :string

    belongs_to :storage_location, StorageLocation
    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(cell, attrs) do
    cell
    |> cast(attrs, [
      :storage_location_id,
      :company_id,
      :ordinal,
      :name,
      :width_m,
      :depth_m,
      :height_m,
      :max_weight_kg,
      :tags,
      :purpose,
      :notes,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:storage_location_id, :company_id])
    |> validate_length(:name, max: 80)
    |> validate_number(:ordinal, greater_than_or_equal_to: 0)
    |> validate_number(:width_m, greater_than: 0)
    |> validate_number(:depth_m, greater_than: 0)
    |> validate_number(:height_m, greater_than: 0)
    |> validate_number(:max_weight_kg, greater_than: 0)
    |> validate_inclusion(:purpose, @purposes)
    |> validate_tags()
    |> validate_tag_membership()
    |> unique_constraint([:storage_location_id, :ordinal],
      name: :storage_cells_storage_location_id_ordinal_index,
      message: "another level already uses this position"
    )
  end

  defp validate_tag_membership(changeset) do
    company_id = Ecto.Changeset.get_field(changeset, :company_id)

    if is_integer(company_id) do
      Backend.Warehouses.StorageTags.validate_tag_membership(
        changeset,
        :tags,
        company_id
      )
    else
      changeset
    end
  end

  # Tags are user-typed; normalise to lowercased trim, drop blanks and
  # de-duplicate so {"Cold", "cold ", "Cold"} becomes ["cold"].
  defp validate_tags(changeset) do
    case get_change(changeset, :tags) do
      nil ->
        changeset

      list when is_list(list) ->
        clean =
          list
          |> Enum.map(fn t -> t |> to_string() |> String.trim() |> String.downcase() end)
          |> Enum.reject(&(&1 == ""))
          |> Enum.uniq()

        put_change(changeset, :tags, clean)

      _ ->
        add_error(changeset, :tags, "must be a list of strings")
    end
  end
end
