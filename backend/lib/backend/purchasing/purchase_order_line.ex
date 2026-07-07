defmodule Backend.Purchasing.PurchaseOrderLine do
  @moduledoc """
  One line on a purchase order. `qty_received` is denormalised — bumped
  on every receipt action so the PO detail page can render
  "ordered vs received" without per-render aggregation.

  `warehouse_id` is a per-line override of `po.default_warehouse_id`;
  null means "ship this line to the PO's default warehouse". Lets a
  single PO split delivery across two sites without forking into two
  POs.

  `vendor_part_no` is the supplier's free-text part code for the item
  on this line. Free text today — a later slice will auto-fill from
  the vendor's approved-item registry once `vendor_approved_items.vendor_part_no`
  lands.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Purchasing.PurchaseOrder
  alias Backend.Warehouses.Warehouse

  schema "purchase_order_lines" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :qty_ordered, :decimal
    field :qty_received, :decimal, default: Decimal.new(0)
    field :unit_price, :decimal, default: Decimal.new(0)
    field :line_subtotal, :decimal, default: Decimal.new(0)

    field :expected_delivery_date, :date
    field :notes, :string
    field :vendor_part_no, :string

    belongs_to :purchase_order, PurchaseOrder
    belongs_to :item, Item
    belongs_to :company, Company
    belongs_to :warehouse, Warehouse

    # The day-one child stock_lot spawned when this line was
    # persisted. Status starts at `requested`, moves to `expected`
    # on `Purchasing.mark_ordered/2`, ends at physical per-pack
    # lots (see the goods-in receive flow which sets
    # `stock_lots.purchase_order_line_id` on each spawned lot).
    # Nil for legacy PO lines created before the child-lot pipeline
    # was wired.
    has_one :child_lot, Backend.Stock.Lot, foreign_key: :purchase_order_line_id

    timestamps(type: :utc_datetime)
  end

  def changeset(line, attrs) do
    line
    |> cast(attrs, [
      :purchase_order_id,
      :company_id,
      :item_id,
      :warehouse_id,
      :qty_ordered,
      :qty_received,
      :unit_price,
      :line_subtotal,
      :expected_delivery_date,
      :notes,
      :vendor_part_no
    ])
    |> validate_required([
      :purchase_order_id,
      :company_id,
      :item_id,
      # Without a warehouse the auto-receive at Goods-In Inspection
      # sign-off can't land the lot anywhere — every line MUST name
      # the warehouse it's destined for. Falls back from the form's
      # per-line picker or the PO's default if the operator didn't
      # override; never nil at create time.
      :warehouse_id,
      :qty_ordered,
      :unit_price
    ])
    |> validate_number(:qty_ordered, greater_than: 0)
    |> validate_number(:qty_received, greater_than_or_equal_to: 0)
    |> validate_number(:unit_price, greater_than_or_equal_to: 0)
    |> validate_length(:notes, max: 2000)
    |> validate_length(:vendor_part_no, max: 120)
  end
end
