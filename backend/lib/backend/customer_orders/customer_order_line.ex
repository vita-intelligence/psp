defmodule Backend.CustomerOrders.CustomerOrderLine do
  @moduledoc """
  One line on a customer order. `unit_price` is the quoted price per
  unit at line-creation time, locked from then on so a later
  pricelist edit doesn't retroactively re-quote a confirmed order
  (the pricelist `valid_until` machinery + this snapshot together
  preserve the price history).

  `warehouse_id` is a per-line override of `co.default_warehouse_id`;
  null means "pick this line from the CO's default warehouse". Lets a
  multi-warehouse Vita split fulfilment across two sites on one CO.

  `pricelist_id` records which pricelist row supplied the quote, for
  an audit answering "why did we quote £X to this customer on this
  date?". Nullable so manual-override lines (no pricelist hit) save.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Companies.Company
  alias Backend.CustomerOrders.CustomerOrder
  alias Backend.Items.Item
  alias Backend.Pricelists.Pricelist
  alias Backend.Warehouses.Warehouse

  schema "customer_order_lines" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :qty_ordered, :decimal
    field :unit_price, :decimal, default: Decimal.new(0)
    field :discount_pct, :decimal, default: Decimal.new(0)
    field :line_subtotal, :decimal, default: Decimal.new(0)

    field :expected_ship_date, :date
    field :customer_part_no, :string
    field :notes, :string

    belongs_to :customer_order, CustomerOrder
    belongs_to :item, Item
    belongs_to :company, Company
    belongs_to :warehouse, Warehouse
    belongs_to :pricelist, Pricelist

    timestamps(type: :utc_datetime)
  end

  def changeset(line, attrs) do
    line
    |> cast(attrs, [
      :customer_order_id,
      :company_id,
      :item_id,
      :warehouse_id,
      :pricelist_id,
      :qty_ordered,
      :unit_price,
      :discount_pct,
      :line_subtotal,
      :expected_ship_date,
      :customer_part_no,
      :notes
    ])
    |> validate_required([
      :customer_order_id,
      :company_id,
      :item_id,
      :qty_ordered,
      :unit_price
    ])
    |> validate_number(:qty_ordered, greater_than: 0)
    |> validate_number(:unit_price, greater_than_or_equal_to: 0)
    |> validate_number(:discount_pct,
      greater_than_or_equal_to: 0,
      less_than_or_equal_to: 100
    )
    |> validate_length(:notes, max: 2000)
    |> validate_length(:customer_part_no, max: 120)
  end
end
