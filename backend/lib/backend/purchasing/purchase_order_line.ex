defmodule Backend.Purchasing.PurchaseOrderLine do
  @moduledoc """
  One line on a purchase order. `qty_received` is denormalised — bumped
  on every receipt action so the PO detail page can render
  "ordered vs received" without per-render aggregation.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Purchasing.PurchaseOrder

  schema "purchase_order_lines" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :qty_ordered, :decimal
    field :qty_received, :decimal, default: Decimal.new(0)
    field :unit_price, :decimal, default: Decimal.new(0)
    field :line_subtotal, :decimal, default: Decimal.new(0)

    field :expected_delivery_date, :date
    field :notes, :string

    belongs_to :purchase_order, PurchaseOrder
    belongs_to :item, Item
    belongs_to :company, Company

    timestamps(type: :utc_datetime)
  end

  def changeset(line, attrs) do
    line
    |> cast(attrs, [
      :purchase_order_id,
      :company_id,
      :item_id,
      :qty_ordered,
      :qty_received,
      :unit_price,
      :line_subtotal,
      :expected_delivery_date,
      :notes
    ])
    |> validate_required([
      :purchase_order_id,
      :company_id,
      :item_id,
      :qty_ordered,
      :unit_price
    ])
    |> validate_number(:qty_ordered, greater_than: 0)
    |> validate_number(:qty_received, greater_than_or_equal_to: 0)
    |> validate_number(:unit_price, greater_than_or_equal_to: 0)
    |> validate_length(:notes, max: 2000)
  end
end
