defmodule Backend.Equipment.RepairPart do
  @moduledoc """
  One spare / consumable line on an equipment repair. Draws down
  against a catalog item (bearings, brushes, gaskets…). `unit_cost`
  + `currency` are snapshotted at consume time so a later price
  change doesn't rewrite the repair's historical total.

  Stock decrement is NOT emitted from this schema — the caller (the
  repair context) is responsible for firing an inventory movement
  when parts land against a lot. For the initial slice we only record
  the intent-to-consume line; wire-up to stock movements can follow.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Equipment.Repair
  alias Backend.Items.Item

  schema "equipment_repair_parts" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :quantity, :decimal
    field :unit_cost, :decimal
    field :currency, :string

    field :notes, :string

    belongs_to :company, Company
    belongs_to :repair, Repair
    belongs_to :item, Item
    belongs_to :created_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(struct, attrs) do
    struct
    |> cast(attrs, [
      :company_id,
      :repair_id,
      :item_id,
      :quantity,
      :unit_cost,
      :currency,
      :notes,
      :created_by_id
    ])
    |> validate_required([:company_id, :repair_id, :item_id, :quantity])
    |> validate_number(:quantity, greater_than: 0)
    |> validate_number(:unit_cost, greater_than_or_equal_to: 0)
    |> validate_length(:currency, is: 3)
    |> assoc_constraint(:company)
    |> assoc_constraint(:repair)
    |> assoc_constraint(:item)
  end
end
