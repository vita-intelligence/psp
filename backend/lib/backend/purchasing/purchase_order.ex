defmodule Backend.Purchasing.PurchaseOrder do
  @moduledoc """
  One purchase order. State machine + identity columns only — line
  items live in `purchase_order_lines`; ESIGN signatures live in
  `purchase_order_approvals`.

  Display code (`PO00001`) is rendered from `id` + the company's
  numbering format — no stored `code` column.

  Money columns split into two groups:

    * **Castable from the form** — `discount_pct`, `tax_rate`,
      `shipping_fees`, `additional_fees`. These are what the buyer
      types.

    * **Server-computed only** — `subtotal`, `discount_amount`,
      `tax_amount`, `grand_total`. These are derived in
      `Backend.Purchasing.recompute_totals/1` after any line / rate
      change. They live on `totals_changeset/2` so the user-facing
      changeset can never smuggle a hand-typed total in.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Purchasing.{PurchaseOrderApproval, PurchaseOrderFile, PurchaseOrderLine}
  alias Backend.Vendors.Vendor
  alias Backend.Warehouses.Warehouse

  @statuses ~w(draft pending_approver pending_director approved ordered partially_received received cancelled)

  schema "purchase_orders" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :status, :string, default: "draft"

    field :currency_code, :string, default: "GBP"

    field :subtotal, :decimal, default: Decimal.new(0)
    field :discount_pct, :decimal, default: Decimal.new(0)
    field :discount_amount, :decimal, default: Decimal.new(0)
    field :tax_rate, :decimal, default: Decimal.new(0)
    field :tax_amount, :decimal, default: Decimal.new(0)
    field :shipping_fees, :decimal, default: Decimal.new(0)
    field :additional_fees, :decimal, default: Decimal.new(0)
    field :grand_total, :decimal, default: Decimal.new(0)
    # Kept around for backwards compatibility with the v1 API — totals
    # logic now writes `grand_total`. Treat as deprecated.
    field :total_amount, :decimal, default: Decimal.new(0)

    field :expected_delivery_date, :date
    field :delivery_address, :string
    field :notes, :string

    field :submitted_at, :utc_datetime
    field :ordered_at, :utc_datetime
    field :received_at, :utc_datetime
    field :cancelled_at, :utc_datetime
    field :cancellation_reason, :string

    belongs_to :vendor, Vendor
    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User
    belongs_to :submitted_by, User
    belongs_to :ordered_by, User
    # Set by `receive_against_po/3` at the moment the PO flips to
    # `received` / `partially_received`. With the inspection-driven
    # auto-receive in `sign_operator`, this is the goods-in operator
    # who signed off the checklist on the phone.
    belongs_to :received_by, User
    belongs_to :cancelled_by, User
    belongs_to :default_warehouse, Warehouse

    has_many :lines, PurchaseOrderLine, foreign_key: :purchase_order_id
    has_many :approvals, PurchaseOrderApproval, foreign_key: :purchase_order_id
    has_many :files, PurchaseOrderFile, foreign_key: :purchase_order_id

    timestamps(type: :utc_datetime)
  end

  def statuses, do: @statuses

  @doc """
  Header changeset. Only the editable identity fields + the rate-style
  money inputs (`discount_pct`, `tax_rate`, `shipping_fees`,
  `additional_fees`). Status moves through `transition_status_changeset/2`,
  computed totals through `totals_changeset/2`.
  """
  def changeset(po, attrs) do
    po
    |> cast(attrs, [
      :company_id,
      :vendor_id,
      :currency_code,
      :discount_pct,
      :tax_rate,
      :shipping_fees,
      :additional_fees,
      :default_warehouse_id,
      :expected_delivery_date,
      :delivery_address,
      :notes,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :vendor_id, :currency_code])
    |> validate_length(:currency_code, is: 3)
    |> validate_length(:delivery_address, max: 1000)
    |> validate_length(:notes, max: 4000)
    |> validate_number(:discount_pct, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:tax_rate, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:shipping_fees, greater_than_or_equal_to: 0)
    |> validate_number(:additional_fees, greater_than_or_equal_to: 0)
  end

  @doc """
  State-machine transition. Allowed transitions are enforced in the
  context (`Backend.Purchasing.PurchaseOrders.transition/4`); this
  changeset just casts + validates inclusion so a stray attr can't
  smuggle in a bogus state.
  """
  def transition_status_changeset(po, attrs) do
    po
    |> cast(attrs, [
      :status,
      :submitted_at,
      :submitted_by_id,
      :ordered_at,
      :ordered_by_id,
      :received_at,
      :received_by_id,
      :cancelled_at,
      :cancelled_by_id,
      :cancellation_reason,
      :updated_by_id
    ])
    |> validate_required([:status])
    |> validate_inclusion(:status, @statuses)
  end

  @doc """
  Totals refresh from cast values. Used by `Backend.Purchasing.recompute_totals/1`
  after a line save or a rate change — totals are denormalised on the
  header so the FE renders the footer without a per-render aggregation.

  All four computed columns (`subtotal`, `discount_amount`,
  `tax_amount`, `grand_total`) live here exclusively. The user-facing
  `changeset/2` does not cast them.
  """
  def totals_changeset(po, attrs) do
    po
    |> cast(attrs, [
      :subtotal,
      :discount_amount,
      :tax_amount,
      :grand_total,
      :total_amount,
      :updated_by_id
    ])
    |> validate_required([:subtotal, :grand_total])
  end
end
