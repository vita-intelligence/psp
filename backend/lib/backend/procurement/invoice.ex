defmodule Backend.Procurement.Invoice do
  @moduledoc """
  A vendor invoice received against a PO. Lives in the AP ledger
  (`/procurement/invoices`) and on the PO detail page's Invoices card.

  States:

      received  → default on create
      disputed  → clerk has flagged an inconsistency
      paid      → fully settled
      void      → cancelled / written off

  `overdue` is not stored — derived in the list query (status =
  received AND due_date < today). This makes the flag self-recover
  when the due date is bumped or the invoice is paid.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Purchasing.PurchaseOrder

  @statuses ~w(received disputed paid void)

  schema "procurement_invoices" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :invoice_number, :string
    field :invoice_date, :date
    field :due_date, :date

    field :currency_code, :string

    field :subtotal, :decimal, default: Decimal.new(0)
    field :tax_amount, :decimal, default: Decimal.new(0)
    field :total_inc_tax, :decimal, default: Decimal.new(0)
    field :paid_amount, :decimal, default: Decimal.new(0)

    field :status, :string, default: "received"
    field :notes, :string

    # Inlined PDF metadata. Bytes live in `Backend.Storage`; this row
    # carries the auditor-readable provenance + the opaque blob path
    # the storage adapter knows how to fetch.
    field :file_filename, :string
    field :file_mime, :string
    field :file_byte_size, :integer
    field :file_blob_path, :string

    field :paid_at, :utc_datetime

    belongs_to :company, Company
    belongs_to :purchase_order, PurchaseOrder
    belongs_to :paid_by, User
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  def statuses, do: @statuses

  @doc """
  Changeset for creating or editing an invoice. Money totals must add
  up: `subtotal + tax_amount = total_inc_tax`. `paid_amount` cannot
  exceed `total_inc_tax` (no overpayments — that becomes a credit
  note, not an invoice).
  """
  def changeset(invoice, attrs) do
    invoice
    |> cast(attrs, [
      :company_id,
      :purchase_order_id,
      :invoice_number,
      :invoice_date,
      :due_date,
      :currency_code,
      :subtotal,
      :tax_amount,
      :total_inc_tax,
      :paid_amount,
      :status,
      :notes,
      :file_filename,
      :file_mime,
      :file_byte_size,
      :file_blob_path,
      :paid_at,
      :paid_by_id,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([
      :company_id,
      :purchase_order_id,
      :invoice_number,
      :invoice_date,
      :currency_code,
      :subtotal,
      :tax_amount,
      :total_inc_tax
    ])
    |> validate_inclusion(:status, @statuses)
    |> validate_length(:invoice_number, max: 100)
    |> validate_length(:currency_code, is: 3)
    |> validate_money_consistency()
    |> validate_paid_not_exceed_total()
    |> unique_constraint(
      [:purchase_order_id, :invoice_number],
      name: :procurement_invoices_purchase_order_id_invoice_number_index,
      message: "An invoice with this number already exists on this PO."
    )
  end

  defp validate_money_consistency(changeset) do
    sub = get_field(changeset, :subtotal) || Decimal.new(0)
    tax = get_field(changeset, :tax_amount) || Decimal.new(0)
    total = get_field(changeset, :total_inc_tax) || Decimal.new(0)
    sum = Decimal.add(sub, tax)

    if Decimal.compare(Decimal.round(sum, 4), Decimal.round(total, 4)) == :eq do
      changeset
    else
      add_error(
        changeset,
        :total_inc_tax,
        "must equal subtotal + tax (got #{Decimal.to_string(total)}; expected #{Decimal.to_string(sum)})."
      )
    end
  end

  defp validate_paid_not_exceed_total(changeset) do
    paid = get_field(changeset, :paid_amount) || Decimal.new(0)
    total = get_field(changeset, :total_inc_tax) || Decimal.new(0)

    if Decimal.compare(paid, total) == :gt do
      add_error(changeset, :paid_amount, "cannot exceed the invoice total.")
    else
      changeset
    end
  end
end
