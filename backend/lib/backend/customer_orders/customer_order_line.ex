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

  alias Backend.Accounts.User
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

    # Escape hatch for the yield-tolerance fulfilment gate. Stamped
    # by ``Backend.CustomerOrders.accept_short_delivery/3`` when the
    # customer has agreed to receive a short delivery — the
    # fulfilment classifier then treats the line as ``:satisfied``
    # regardless of the delivered-vs-ordered gap, letting the CO
    # advance to ready-to-dispatch. Cleared to nil if a later
    # top-up MO closes the gap naturally (fulfilment re-derives).
    field :short_delivery_accepted_at, :utc_datetime
    field :short_delivery_accepted_reason, :string

    # NPD packaging-combo overlay. Populated by ``proposal_merge`` when
    # a customer picks a specific packaging combo at checkout on an
    # RTG SKU. Read at MO-create time by
    # ``customer_order_controller.create_mo_for_line`` — the items get
    # resolved to PSP ``item_id``s and passed as ``packaging_combo_items``
    # on the MO so the packaging BOM matches what the customer actually
    # ordered (their picked "Pouch" bottles the goods, not the SKU's
    # default "Bottle 150ml"). Nil on Custom orders and on legacy RTG
    # rows synced before this shipped — those fall back to the item's
    # default packaging BOM, matching pre-existing behaviour.
    field :npd_packaging_combo_uuid, Ecto.UUID
    field :npd_packaging_combo_name, :string
    field :npd_packaging_combo_items, {:array, :map}

    belongs_to :customer_order, CustomerOrder
    belongs_to :item, Item
    belongs_to :company, Company
    belongs_to :warehouse, Warehouse
    belongs_to :pricelist, Pricelist
    belongs_to :short_delivery_accepted_by, User

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
      :notes,
      :npd_packaging_combo_uuid,
      :npd_packaging_combo_name,
      :npd_packaging_combo_items
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

  @doc """
  Narrow changeset for the "Accept short delivery" action. Requires
  a reason so the audit trail always answers "why did we ship
  short?". Called from ``Backend.CustomerOrders.accept_short_delivery/3``.
  """
  def short_delivery_changeset(line, attrs) do
    line
    |> cast(attrs, [
      :short_delivery_accepted_at,
      :short_delivery_accepted_reason,
      :short_delivery_accepted_by_id
    ])
    |> validate_required([
      :short_delivery_accepted_at,
      :short_delivery_accepted_reason,
      :short_delivery_accepted_by_id
    ])
    |> validate_length(:short_delivery_accepted_reason, min: 3, max: 4_000)
  end
end
