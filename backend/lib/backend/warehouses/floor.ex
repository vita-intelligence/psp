defmodule Backend.Warehouses.Floor do
  @moduledoc """
  One floor of a warehouse. Holds the canvas state for that floor's
  walls + rooms (under `canvas_json`) and groups storage locations.

  Floors are ordered within the parent warehouse via `ordinal` — the
  floor switcher renders them in ascending order. Ground floor = 0
  by convention, mezzanine = 1, etc.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Warehouses.{StorageLocation, Warehouse}

  schema "warehouse_floors" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :name, :string
    field :ordinal, :integer, default: 0
    # Walls + rooms + viewport. Storage locations live in their own
    # table — keep this blob purely architectural.
    field :canvas_json, :map, default: %{}

    belongs_to :warehouse, Warehouse
    # Denormalised from `warehouse.company_id` so the audit_events
    # insert (which needs company_id directly on the entity) and the
    # cross-company isolation filter work without joining the parent
    # warehouse on every read.
    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User
    has_many :storage_locations, StorageLocation

    timestamps(type: :utc_datetime)
  end

  def changeset(floor, attrs) do
    floor
    |> cast(attrs, [
      :warehouse_id,
      :company_id,
      :name,
      :ordinal,
      :canvas_json,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:warehouse_id, :company_id, :name])
    |> validate_length(:name, min: 1, max: 80)
    |> validate_number(:ordinal, greater_than_or_equal_to: 0)
    |> unique_constraint([:warehouse_id, :name],
      name: :warehouse_floors_warehouse_id_name_index
    )
  end
end
