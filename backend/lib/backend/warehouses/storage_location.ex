defmodule Backend.Warehouses.StorageLocation do
  @moduledoc """
  A first-class storage spot inside a warehouse — the rectangle the
  operator draws on the plan canvas. The location itself is a
  geographic group; the actual storage math (does an item fit, how
  much room is left) lives on its `cells`.

  Canvas position (`x`, `y`, `width`, `height`) is in canvas units —
  the schematic the operator drew. Physical dimensions
  (`width_m`, `height_m`, `depth_m`) are in metres and describe the
  location's outer footprint; cells beneath carry their own per-level
  W × D × H so a 5-shelf rack can have a shallow top level without
  affecting the rest.

  Free-form `tags` classify the whole zone (`pallet`, `cold-zone`,
  `hazmat-3`). When the allocation engine looks at a cell its
  effective tag set is `location.tags ∪ cell.tags`, so an operator
  marks "this rack is pallet-only" once and every level inherits.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Warehouses.{Floor, StorageCell, Warehouse}

  schema "storage_locations" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :name, :string
    field :code, :string

    field :x, :integer, default: 0
    field :y, :integer, default: 0
    field :width, :integer, default: 100
    field :height, :integer, default: 100

    field :width_m, :decimal
    field :height_m, :decimal
    field :depth_m, :decimal

    field :notes, :string

    # Optional `#RRGGBB` colour override for the canvas. nil = the
    # neutral default (slate). Cosmetic — does not affect allocation.
    field :color, :string

    # Free-form classification labels. No fixed vocabulary so the
    # segregation rules engine can plug in without a schema change.
    # `validate_tags/1` normalises (lowercase, trim, dedupe) on write.
    field :tags, {:array, :string}, default: []

    belongs_to :warehouse, Warehouse
    belongs_to :floor, Floor
    # Denormalised from `warehouse.company_id` for the same reason
    # `Floor` has it — audit_events.company_id is NOT NULL and the
    # cross-company filter stays a single-index lookup.
    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User

    has_many :cells, StorageCell,
      foreign_key: :storage_location_id,
      preload_order: [asc: :ordinal]

    timestamps(type: :utc_datetime)
  end

  def changeset(location, attrs) do
    location
    |> cast(attrs, [
      :warehouse_id,
      :floor_id,
      :company_id,
      :name,
      :code,
      :x,
      :y,
      :width,
      :height,
      :width_m,
      :height_m,
      :depth_m,
      :notes,
      :color,
      :tags,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:warehouse_id, :floor_id, :company_id])
    |> validate_length(:name, max: 120)
    |> validate_length(:code, max: 40)
    # validate_number only runs when the field is present in the
    # changeset's changes — so the metre fields stay optional without
    # any extra opts.
    |> validate_number(:width, greater_than: 0)
    |> validate_number(:height, greater_than: 0)
    |> validate_number(:width_m, greater_than: 0)
    |> validate_number(:height_m, greater_than: 0)
    |> validate_number(:depth_m, greater_than: 0)
    |> validate_format(:color, ~r/\A#[0-9a-fA-F]{6}\z/,
      message: "must be a #RRGGBB hex colour"
    )
    |> normalise_tags()
    |> unique_constraint([:warehouse_id, :code],
      name: :storage_locations_warehouse_id_code_index
    )
  end

  # Tags are user-typed; same normalisation as `StorageCell` so a
  # cell and its parent location agree on equality.
  defp normalise_tags(changeset) do
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
