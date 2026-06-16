defmodule Backend.Production.Routing do
  @moduledoc """
  Routing — the ordered list of operations that turns a BOM's
  inputs into a finished item. Belongs to an Item; may optionally
  pin to a specific BOM (the "Connected BOM" toggle).

  Children (`routing_steps`) are wholesale-replaced on save. The
  detail page hands the BE the full step list; the context layer
  wipes + reinserts inside a single transaction so audit captures
  one update event instead of N.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Production.{BOM, RoutingStep}

  schema "routings" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :name, :string
    field :notes, :string
    field :is_active, :boolean, default: true

    field :other_fixed_cost, :decimal
    field :other_variable_cost, :decimal
    field :other_variable_cost_basis, :decimal, default: Decimal.new("1.0")

    belongs_to :company, Company
    belongs_to :item, Item
    belongs_to :bom, BOM
    belongs_to :created_by, User
    belongs_to :updated_by, User

    has_many :steps, RoutingStep,
      foreign_key: :routing_id,
      preload_order: [asc: :sort_order]

    timestamps(type: :utc_datetime)
  end

  def changeset(routing, attrs) do
    routing
    |> cast(attrs, [
      :company_id,
      :item_id,
      :bom_id,
      :name,
      :notes,
      :is_active,
      :other_fixed_cost,
      :other_variable_cost,
      :other_variable_cost_basis,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :item_id, :name])
    |> validate_length(:name, min: 1, max: 200)
    |> validate_length(:notes, max: 4000)
    |> validate_number(:other_variable_cost_basis, greater_than: 0)
    |> trim_name()
    |> assoc_constraint(:company)
    |> assoc_constraint(:item)
    |> assoc_constraint(:bom)
    |> unique_constraint([:company_id, :name],
      name: :routings_company_name_index,
      message: "another routing already uses this name"
    )
  end

  defp trim_name(cs) do
    case get_change(cs, :name) do
      raw when is_binary(raw) -> put_change(cs, :name, String.trim(raw))
      _ -> cs
    end
  end
end
