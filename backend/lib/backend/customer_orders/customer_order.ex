defmodule Backend.CustomerOrders.CustomerOrder do
  @moduledoc """
  One customer order — sell-side mirror of `Backend.Purchasing.PurchaseOrder`.

  State machine + identity columns only — line items live in
  `customer_order_lines`; ESIGN signatures live in
  `customer_order_approvals`.

  Display code (`CO00001`) is rendered from `id` + the company's
  numbering format — no stored `code` column.

  Money columns split the same way as PO:

    * **Castable from the form** — `discount_pct`, `tax_rate`,
      `shipping_fees`, `additional_fees`. These are what the
      salesperson types.

    * **Server-computed only** — `subtotal`, `discount_amount`,
      `tax_amount`, `grand_total`. Derived in
      `Backend.CustomerOrders.recompute_totals/1` after any line /
      rate change. Live on `totals_changeset/2` so the user-facing
      changeset can never smuggle a hand-typed total in.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Customers.Customer
  alias Backend.CustomerOrders.{
    CustomerOrderApproval,
    CustomerOrderFile,
    CustomerOrderLine
  }
  alias Backend.Warehouses.Warehouse

  @statuses ~w(draft pending_approver pending_director approved confirmed cancelled)

  schema "customer_orders" do
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

    field :expected_ship_date, :date
    # Customer-facing deadline. Distinct from `expected_ship_date`
    # (internal shipping ETA). Drives the /my-tasks urgency bucketing
    # + the wizard's "due in N days" pill.
    field :due_date, :date
    field :delivery_address, :string
    field :customer_reference, :string
    field :notes, :string

    field :submitted_at, :utc_datetime
    field :confirmed_at, :utc_datetime
    field :cancelled_at, :utc_datetime
    field :cancellation_reason, :string

    belongs_to :customer, Customer
    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User
    belongs_to :submitted_by, User
    belongs_to :confirmed_by, User
    belongs_to :cancelled_by, User
    belongs_to :default_warehouse, Warehouse

    has_many :lines, CustomerOrderLine, foreign_key: :customer_order_id
    has_many :approvals, CustomerOrderApproval, foreign_key: :customer_order_id
    has_many :files, CustomerOrderFile, foreign_key: :customer_order_id

    timestamps(type: :utc_datetime)
  end

  def statuses, do: @statuses

  @doc """
  Header changeset. Only the editable identity fields + rate-style
  money inputs. Status moves through `transition_status_changeset/2`,
  computed totals through `totals_changeset/2`.
  """
  def changeset(co, attrs) do
    co
    |> cast(attrs, [
      :company_id,
      :customer_id,
      :currency_code,
      :discount_pct,
      :tax_rate,
      :shipping_fees,
      :additional_fees,
      :default_warehouse_id,
      :expected_ship_date,
      :due_date,
      :delivery_address,
      :customer_reference,
      :notes,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :customer_id, :currency_code])
    |> validate_length(:currency_code, is: 3)
    |> validate_length(:delivery_address, max: 1000)
    |> validate_length(:customer_reference, max: 120)
    |> validate_length(:notes, max: 4000)
    |> validate_number(:discount_pct, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:tax_rate, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:shipping_fees, greater_than_or_equal_to: 0)
    |> validate_number(:additional_fees, greater_than_or_equal_to: 0)
  end

  @doc """
  State-machine transition. Allowed transitions are enforced at the
  context level (`Backend.CustomerOrders.transition/4`); this
  changeset just casts + validates inclusion so a stray attr can't
  smuggle in a bogus state.
  """
  def transition_status_changeset(co, attrs) do
    co
    |> cast(attrs, [
      :status,
      :submitted_at,
      :submitted_by_id,
      :confirmed_at,
      :confirmed_by_id,
      :cancelled_at,
      :cancelled_by_id,
      :cancellation_reason,
      :updated_by_id
    ])
    |> validate_required([:status])
    |> validate_inclusion(:status, @statuses)
  end

  @doc """
  Totals refresh — used by `recompute_totals/1` after any line save
  or rate change. Computed columns live here exclusively.
  """
  def totals_changeset(co, attrs) do
    co
    |> cast(attrs, [
      :subtotal,
      :discount_amount,
      :tax_amount,
      :grand_total,
      :updated_by_id
    ])
    |> validate_required([:subtotal, :grand_total])
  end
end
