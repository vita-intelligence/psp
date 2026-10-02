defmodule Backend.Production.Routing do
  @moduledoc """
  Routing — the ordered list of operations that turns a BOM's
  inputs into a finished item. One row carries both roles:

    * **Template** (`item_id IS NULL`) — reusable, admin-authored,
      lives on `/production/routings` and is the picker source for
      NPD's formulation builder.
    * **Snapshot** (`item_id IS NOT NULL`) — the frozen per-item copy
      minted at sync time, pointing at the template via
      `source_template_id`. MO creation reads from this.

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
    belongs_to :source_template, __MODULE__, foreign_key: :source_template_id
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
      :source_template_id,
      :name,
      :notes,
      :is_active,
      :other_fixed_cost,
      :other_variable_cost,
      :other_variable_cost_basis,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :name])
    |> validate_length(:name, min: 1, max: 200)
    |> validate_length(:notes, max: 4000)
    |> validate_number(:other_variable_cost_basis, greater_than: 0)
    |> trim_name()
    |> validate_template_shape()
    |> assoc_constraint(:company)
    |> assoc_constraint(:item)
    |> assoc_constraint(:bom)
    |> assoc_constraint(:source_template)
    |> unique_constraint([:company_id, :name],
      name: :routings_template_name_index,
      message: "another routing template already uses this name"
    )
    |> unique_constraint([:company_id, :item_id],
      name: :routings_item_snapshot_index,
      message: "this item already has a routing snapshot"
    )
  end

  @doc """
  True when the routing is a reusable template (not pinned to an item).
  """
  def template?(%__MODULE__{item_id: nil}), do: true
  def template?(%__MODULE__{}), do: false

  defp validate_template_shape(cs) do
    item_id = get_field(cs, :item_id)
    source_template_id = get_field(cs, :source_template_id)

    cond do
      is_nil(item_id) and not is_nil(source_template_id) ->
        add_error(cs, :source_template_id,
          "templates cannot themselves point at another template"
        )

      true ->
        cs
    end
  end

  defp trim_name(cs) do
    case get_change(cs, :name) do
      raw when is_binary(raw) -> put_change(cs, :name, String.trim(raw))
      _ -> cs
    end
  end
end
