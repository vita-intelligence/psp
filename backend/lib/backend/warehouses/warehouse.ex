defmodule Backend.Warehouses.Warehouse do
  @moduledoc """
  A physical location where stock lives. Belongs to one Company.

  Inheritance: `timezone`, `working_hours`, and `holidays` are
  nullable. `nil` means "inherit from the parent company". A non-nil
  value overrides. See `Backend.Warehouses.effective_*/1` resolvers.

  Contacts and the future Plan blob live in JSONB so additions don't
  need migrations.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Warehouses.{Floor, StorageLocation}

  schema "warehouses" do
    # Public identifier — used in URLs, API paths, channel topics.
    # Integer PK stays for cheaper FKs.
    field :uuid, Ecto.UUID, autogenerate: true
    # Short public identifier (WH00001, …). Auto-generated on create
    # from `companies.numbering_formats["warehouse"]`; admins can also
    # type one in by hand. Per-company unique.
    field :code, :string
    field :name, :string
    field :address, :string
    field :notes, :string
    field :is_active, :boolean, default: true

    # Nullable inheritance overrides
    field :timezone, :string
    field :working_hours, :map
    field :holidays, :map

    field :contacts, :map, default: %{"items" => []}
    field :plan, :map

    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User
    has_many :floors, Floor, preload_order: [asc: :ordinal]
    has_many :storage_locations, StorageLocation

    timestamps(type: :utc_datetime)
  end

  def changeset(warehouse, attrs) do
    warehouse
    |> cast(attrs, [
      :company_id,
      :code,
      :name,
      :address,
      :notes,
      :is_active,
      :timezone,
      :working_hours,
      :holidays,
      :contacts,
      :plan,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :name])
    |> validate_length(:name, min: 1, max: 200)
    |> validate_length(:code, max: 40)
    |> unique_constraint([:company_id, :name],
      name: :warehouses_company_id_name_index
    )
    |> unique_constraint([:company_id, :code],
      name: :warehouses_company_id_code_index,
      message: "this code is already in use"
    )
  end
end
