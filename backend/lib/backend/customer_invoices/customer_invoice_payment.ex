defmodule Backend.CustomerInvoices.CustomerInvoicePayment do
  @moduledoc """
  One payment recorded against an invoice. Multiple payments per
  invoice — partial payments are the norm in B2B.

  Outstanding balance per invoice = `invoice.grand_total − SUM(payments.amount)`.
  When that hits 0 the context auto-flips the invoice status to `paid`;
  while > 0 with at least one payment, it sits at `partially_paid`.

  Payments are append-only via the public API (no update / delete
  exposed). A wrong entry is corrected with an adjusting negative
  amount entry — never by mutating history. The audit log keeps the
  full chain.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.CustomerInvoices.{CustomerInvoice, CustomerInvoicePayment}

  @methods ~w(bank_transfer card cash cheque other)

  schema "customer_invoice_payments" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :paid_at, :date
    field :amount, :decimal
    field :method, :string, default: "bank_transfer"
    field :reference, :string
    field :notes, :string

    belongs_to :customer_invoice, CustomerInvoice
    belongs_to :company, Company
    belongs_to :recorded_by, User

    timestamps(type: :utc_datetime)
  end

  def methods, do: @methods

  def changeset(%CustomerInvoicePayment{} = row, attrs) do
    row
    |> cast(attrs, [
      :customer_invoice_id,
      :company_id,
      :recorded_by_id,
      :paid_at,
      :amount,
      :method,
      :reference,
      :notes
    ])
    |> validate_required([
      :customer_invoice_id,
      :company_id,
      :paid_at,
      :amount,
      :method
    ])
    |> validate_inclusion(:method, @methods)
    |> validate_length(:reference, max: 120)
    |> validate_length(:notes, max: 2000)
    # Allow negative amounts — that's how you record refunds / write-offs
    # without erasing history. Only zero is meaningless.
    |> validate_number(:amount, not_equal_to: 0)
  end
end
