defmodule Backend.Purchasing.PurchaseOrder do
  @moduledoc """
  One purchase order. State machine + identity columns only — line
  items live in `purchase_order_lines`; ESIGN signatures live in
  `purchase_order_approvals`.

  Display code (`PO00001`) is rendered from `id` + the company's
  numbering format — no stored `code` column.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Purchasing.{PurchaseOrderApproval, PurchaseOrderLine}
  alias Backend.Vendors.Vendor

  @statuses ~w(draft pending_approver pending_director approved ordered partially_received received cancelled)

  schema "purchase_orders" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :status, :string, default: "draft"

    field :currency_code, :string, default: "GBP"
    field :subtotal, :decimal, default: Decimal.new(0)
    field :tax_amount, :decimal, default: Decimal.new(0)
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
    belongs_to :cancelled_by, User

    has_many :lines, PurchaseOrderLine, foreign_key: :purchase_order_id
    has_many :approvals, PurchaseOrderApproval, foreign_key: :purchase_order_id

    timestamps(type: :utc_datetime)
  end

  def statuses, do: @statuses

  @doc """
  Header changeset. Only the editable identity fields; status moves
  through `transition_status_changeset/2`, totals through
  `recompute_totals/1`.
  """
  def changeset(po, attrs) do
    po
    |> cast(attrs, [
      :company_id,
      :vendor_id,
      :currency_code,
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
      :cancelled_at,
      :cancelled_by_id,
      :cancellation_reason,
      :updated_by_id
    ])
    |> validate_required([:status])
    |> validate_inclusion(:status, @statuses)
  end

  @doc """
  Totals refresh from cast values. Used after a line save so totals
  stay denormalised on the header.
  """
  def totals_changeset(po, attrs) do
    po
    |> cast(attrs, [:subtotal, :tax_amount, :total_amount, :updated_by_id])
    |> validate_required([:subtotal, :total_amount])
  end
end
