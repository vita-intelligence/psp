defmodule Backend.Pricelists.PricelistItem do
  @moduledoc """
  One row in a pricelist — selling price for an item at a qty
  threshold. Multiple rows per (pricelist × item) ARE expected so
  tiered pricing works:

      Row(item, min_qty=1,    price=£10.00)
      Row(item, min_qty=100,  price=£9.00)
      Row(item, min_qty=1000, price=£8.00)

  Lookup picks the row with the highest `min_quantity` whose
  threshold ≤ requested qty.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Pricelists.{Pricelist, PricelistItem}

  schema "pricelist_items" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :selling_price, :decimal
    field :min_quantity, :decimal, default: Decimal.new(1)
    field :notes, :string

    belongs_to :pricelist, Pricelist
    belongs_to :item, Item
    belongs_to :company, Company

    timestamps(type: :utc_datetime)
  end

  def changeset(%PricelistItem{} = row, attrs) do
    row
    |> cast(attrs, [
      :pricelist_id,
      :item_id,
      :company_id,
      :selling_price,
      :min_quantity,
      :notes
    ])
    |> validate_required([
      :pricelist_id,
      :item_id,
      :company_id,
      :selling_price,
      :min_quantity
    ])
    |> validate_number(:selling_price, greater_than_or_equal_to: 0)
    |> validate_number(:min_quantity, greater_than: 0)
    |> unique_constraint([:pricelist_id, :item_id, :min_quantity],
      name: :pricelist_items_tier_unique,
      message: "a tier with this min quantity already exists for this item"
    )
  end
end
