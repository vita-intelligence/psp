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

  alias Backend.Companies.Company

  schema "warehouses" do
    # Public identifier — used in URLs, API paths, channel topics.
    # Integer PK stays for cheaper FKs.
    field :uuid, Ecto.UUID, autogenerate: true
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

    timestamps(type: :utc_datetime)
  end

  def changeset(warehouse, attrs) do
    warehouse
    |> cast(attrs, [
      :company_id,
      :name,
      :address,
      :notes,
      :is_active,
      :timezone,
      :working_hours,
      :holidays,
      :contacts,
      :plan
    ])
    |> validate_required([:company_id, :name])
    |> validate_length(:name, min: 1, max: 200)
    |> unique_constraint([:company_id, :name],
      name: :warehouses_company_id_name_index
    )
  end
end
