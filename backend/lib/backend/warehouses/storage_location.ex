defmodule Backend.Warehouses.StorageLocation do
  @moduledoc """
  A first-class storage spot inside a warehouse (rack, shelf, pallet
  zone, etc.) — not just a shape on the canvas. Has its own UUID,
  audit trail, and dimensions. Stock records and transfer logs will
  FK into this once the inventory module ships.

  Canvas position (`x`, `y`, `width`, `height`) is in canvas units —
  the schematic the operator drew. Physical dimensions
  (`width_m`, `height_m`, `depth_m`) are in metres and stay accurate
  even if the operator tweaks the canvas drawing for legibility.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Warehouses.{Floor, StorageCell, Warehouse}

  # The kinds the UI exposes. Add a value here AND in the FE picker
  # when shipping a new category — the changeset rejects unknowns.
  @valid_kinds ~w(rack shelf pallet_zone cold_storage hazmat staging other)

  schema "storage_locations" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :name, :string
    field :code, :string
    field :kind, :string

    field :x, :integer, default: 0
    field :y, :integer, default: 0
    field :width, :integer, default: 100
    field :height, :integer, default: 100

    field :width_m, :decimal
    field :height_m, :decimal
    field :depth_m, :decimal

    field :capacity, :string
    field :notes, :string

    # Optional `#RRGGBB` colour override for the canvas. nil = use the
    # kind's default palette (see frontend `LocationShape`).
    field :color, :string

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

  def valid_kinds, do: @valid_kinds

  def changeset(location, attrs) do
    location
    |> cast(attrs, [
      :warehouse_id,
      :floor_id,
      :company_id,
      :name,
      :code,
      :kind,
      :x,
      :y,
      :width,
      :height,
      :width_m,
      :height_m,
      :depth_m,
      :capacity,
      :notes,
      :color,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:warehouse_id, :floor_id, :company_id, :name])
    |> validate_length(:name, min: 1, max: 120)
    |> validate_length(:code, max: 40)
    |> validate_length(:capacity, max: 60)
    |> validate_inclusion(:kind, @valid_kinds,
      message: "must be one of: #{Enum.join(@valid_kinds, ", ")}"
    )
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
    |> unique_constraint([:warehouse_id, :code],
      name: :storage_locations_warehouse_id_code_index
    )
  end
end
