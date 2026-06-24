defmodule Backend.Repo.Migrations.CreateCustomerInvoices do
  use Ecto.Migration

  @moduledoc """
  Customer invoices + lines + payments.

  State machine (enforced in `Backend.CustomerInvoices`):

      draft → sent → partially_paid → paid    (terminal)
                ↘
                  cancelled   (only when no payments recorded)

  `kind` is the document type. V1 ships `invoice` only; the schema +
  enum cover `proforma`, `credit_note`, `quotation` so we can extend
  without re-migrating later. Each document type has its own
  lifecycle posture even though they share the table — for now the
  controller pins kind to `invoice` and we revisit when the rest
  ship.

  `customer_order_id` is optional: most invoices come from a CO, but
  one-offs (services / ad-hoc billing) need to be issuable against
  just a customer.

  Payments are a separate table so:
    * Multiple partial payments per invoice (the real-world default)
    * A payment void leaves a row instead of erasing history
    * Outstanding = invoice.grand_total − SUM(payments.amount), so
      the credit-limit gate computes A/R off live data instead of a
      denormalised `paid_amount` column that could drift.
  """

  def change do
    create table(:customer_invoices) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      # V1: always "invoice". The enum + check keep room for the
      # future without surprising downstream callers.
      add :kind, :string, size: 20, default: "invoice", null: false

      add :status, :string, size: 30, default: "draft", null: false

      add :customer_id, references(:customers, on_delete: :restrict), null: false
      add :customer_order_id, references(:customer_orders, on_delete: :nilify_all)

      add :currency_code, :string, size: 3, default: "GBP", null: false

      # Money split — same posture as CO/PO. User-castable rates; the
      # context computes subtotal / discount_amount / tax_amount /
      # grand_total off the lines.
      add :subtotal, :decimal, precision: 14, scale: 4, default: 0, null: false
      add :discount_pct, :decimal, precision: 5, scale: 2, default: 0, null: false
      add :discount_amount, :decimal, precision: 12, scale: 2, default: 0, null: false
      add :tax_rate, :decimal, precision: 5, scale: 2, default: 0, null: false
      add :tax_amount, :decimal, precision: 12, scale: 2, default: 0, null: false
      add :grand_total, :decimal, precision: 12, scale: 2, default: 0, null: false

      # Invoice-date columns. `invoice_date` is the legally relevant
      # date (when the bill was issued); `due_date` is when payment
      # is owed. Both default-computed in the context from
      # `customer.payment_terms_days + payment_terms_basis` so the
      # operator can override only if needed.
      add :invoice_date, :date, null: false
      add :due_date, :date

      add :billing_address, :text
      add :customer_reference, :string, size: 120
      add :free_text, :text

      add :sent_at, :utc_datetime
      add :cancelled_at, :utc_datetime
      add :cancellation_reason, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)
      add :sent_by_id, references(:users, on_delete: :nilify_all)
      add :cancelled_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customer_invoices, [:uuid])
    create index(:customer_invoices, [:company_id, :status])
    create index(:customer_invoices, [:customer_id])
    create index(:customer_invoices, [:customer_order_id])
    create index(:customer_invoices, [:due_date])

    create table(:customer_invoice_lines) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :customer_invoice_id,
          references(:customer_invoices, on_delete: :delete_all),
          null: false

      # Both nullable — an invoice line can quote a free-text service
      # ("Consulting hours, October") without an item; or it can
      # reference an item without a CO line origin (manual invoice).
      add :item_id, references(:items, on_delete: :nilify_all)
      add :customer_order_line_id,
          references(:customer_order_lines, on_delete: :nilify_all)

      add :description, :string, size: 500
      add :qty, :decimal, precision: 14, scale: 4, null: false
      add :unit_price, :decimal, precision: 14, scale: 4, default: 0, null: false
      add :discount_pct, :decimal, precision: 5, scale: 2, default: 0, null: false
      add :line_subtotal, :decimal, precision: 14, scale: 4, default: 0, null: false

      add :delivery_date, :date
      add :notes, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customer_invoice_lines, [:uuid])
    create index(:customer_invoice_lines, [:customer_invoice_id])
    create index(:customer_invoice_lines, [:customer_order_line_id])

    create table(:customer_invoice_payments) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :customer_invoice_id,
          references(:customer_invoices, on_delete: :delete_all),
          null: false

      add :paid_at, :date, null: false
      add :amount, :decimal, precision: 12, scale: 2, null: false

      # bank_transfer | card | cash | cheque | other
      add :method, :string, size: 20, default: "bank_transfer", null: false
      add :reference, :string, size: 120
      add :notes, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :recorded_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customer_invoice_payments, [:uuid])
    create index(:customer_invoice_payments, [:customer_invoice_id])
    create index(:customer_invoice_payments, [:paid_at])
  end
end
