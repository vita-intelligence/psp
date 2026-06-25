defmodule Backend.CustomerInvoices.CustomerInvoice do
  @moduledoc """
  One customer invoice (or future proforma / credit note / quotation —
  see `kind`). Header + state machine + denormalised totals; lines and
  payments live in their own tables.

  Money split mirrors CO/PO: user-castable rates (`discount_pct`,
  `tax_rate`) only; computed totals (`subtotal`, `discount_amount`,
  `tax_amount`, `grand_total`) flow through `totals_changeset/2` so
  no form can smuggle a hand-typed total in.

  Identity columns (customer_id, kind, customer_order_id) are cast
  here, but `Backend.CustomerInvoices.update_header/3` rejects edits
  when the invoice is not draft.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Customers.Customer
  alias Backend.CustomerOrders.CustomerOrder
  alias Backend.CustomerInvoices.{
    CustomerInvoice,
    CustomerInvoiceLine,
    CustomerInvoicePayment
  }

  @kinds ~w(invoice proforma credit_note quotation)
  @statuses ~w(draft sent partially_paid paid cancelled)

  schema "customer_invoices" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :kind, :string, default: "invoice"
    field :status, :string, default: "draft"

    field :currency_code, :string, default: "GBP"

    field :subtotal, :decimal, default: Decimal.new(0)
    field :discount_pct, :decimal, default: Decimal.new(0)
    field :discount_amount, :decimal, default: Decimal.new(0)
    field :tax_rate, :decimal, default: Decimal.new(0)
    field :tax_amount, :decimal, default: Decimal.new(0)
    field :grand_total, :decimal, default: Decimal.new(0)

    field :invoice_date, :date
    field :due_date, :date
    field :billing_address, :string
    field :customer_reference, :string
    field :free_text, :string

    field :sent_at, :utc_datetime
    field :cancelled_at, :utc_datetime
    field :cancellation_reason, :string

    belongs_to :customer, Customer
    belongs_to :customer_order, CustomerOrder
    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User
    belongs_to :sent_by, User
    belongs_to :cancelled_by, User

    belongs_to :linked_rma, Backend.CustomerReturns.CustomerReturn
    belongs_to :linked_invoice, __MODULE__

    has_many :lines, CustomerInvoiceLine, foreign_key: :customer_invoice_id
    has_many :payments, CustomerInvoicePayment, foreign_key: :customer_invoice_id

    timestamps(type: :utc_datetime)
  end

  def kinds, do: @kinds
  def statuses, do: @statuses

  @doc """
  Header changeset. Editable identity + rate fields; computed totals
  flow through `totals_changeset/2`, state through
  `transition_status_changeset/2`.
  """
  def changeset(%CustomerInvoice{} = inv, attrs) do
    inv
    |> cast(attrs, [
      :company_id,
      :customer_id,
      :customer_order_id,
      :kind,
      :currency_code,
      :invoice_date,
      :due_date,
      :billing_address,
      :customer_reference,
      :free_text,
      :discount_pct,
      :tax_rate,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([
      :company_id,
      :customer_id,
      :kind,
      :currency_code,
      :invoice_date
    ])
    |> validate_inclusion(:kind, @kinds)
    |> validate_length(:currency_code, is: 3)
    |> validate_length(:billing_address, max: 2000)
    |> validate_length(:customer_reference, max: 120)
    |> validate_length(:free_text, max: 4000)
    |> validate_number(:discount_pct,
      greater_than_or_equal_to: 0,
      less_than_or_equal_to: 100
    )
    |> validate_number(:tax_rate,
      greater_than_or_equal_to: 0,
      less_than_or_equal_to: 100
    )
  end

  def transition_status_changeset(%CustomerInvoice{} = inv, attrs) do
    inv
    |> cast(attrs, [
      :status,
      :sent_at,
      :sent_by_id,
      :cancelled_at,
      :cancelled_by_id,
      :cancellation_reason,
      :updated_by_id
    ])
    |> validate_required([:status])
    |> validate_inclusion(:status, @statuses)
  end

  def totals_changeset(%CustomerInvoice{} = inv, attrs) do
    inv
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
