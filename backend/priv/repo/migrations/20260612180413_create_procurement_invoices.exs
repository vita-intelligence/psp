defmodule Backend.Repo.Migrations.CreateProcurementInvoices do
  use Ecto.Migration

  @moduledoc """
  Incoming-vendor-invoice ledger. Each row is one invoice the vendor
  has billed against an existing PO — the AP-clerk view of MRPEasy's
  "Incoming invoices" tab.

  Status enum: `received` (default on create) → `disputed` |
  `paid` | `void`. `overdue` is derived (status=received AND
  due_date < today); not stored so it auto-recovers when due_date
  shifts.

  The invoice PDF is inlined as `file_*` columns rather than a
  separate `invoice_files` table — one invoice always carries at most
  one document, and inlining keeps the AP query single-table.
  """

  def change do
    create table(:procurement_invoices) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :delete_all), null: false

      add :purchase_order_id,
          references(:purchase_orders, on_delete: :restrict),
          null: false

      # The vendor's own invoice number — opaque string, not validated
      # against a format. Two different vendors may legitimately share
      # the same number, so unique only per-(vendor, company).
      add :invoice_number, :string, size: 100, null: false

      add :invoice_date, :date, null: false
      add :due_date, :date

      add :currency_code, :string, size: 3, null: false

      # Money columns mirror PO money precision (Decimal(14, 4)) so a
      # 4dp FX cross-rate doesn't lose pennies on conversion.
      add :subtotal, :decimal, precision: 14, scale: 4, null: false, default: 0
      add :tax_amount, :decimal, precision: 14, scale: 4, null: false, default: 0
      add :total_inc_tax, :decimal, precision: 14, scale: 4, null: false, default: 0
      add :paid_amount, :decimal, precision: 14, scale: 4, null: false, default: 0

      add :status, :string, size: 20, null: false, default: "received"

      add :notes, :text

      # Single attached PDF — vendor's invoice document. Optional
      # because clerks sometimes record the totals before the PDF
      # arrives in the post.
      add :file_filename, :string, size: 255
      add :file_mime, :string, size: 120
      add :file_byte_size, :bigint
      add :file_blob_path, :string, size: 500

      add :paid_at, :utc_datetime
      add :paid_by_id, references(:users, on_delete: :nilify_all)

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:procurement_invoices, [:uuid])
    create index(:procurement_invoices, [:purchase_order_id])
    create index(:procurement_invoices, [:company_id, :status, :due_date])

    # Same vendor invoice number can't be entered twice for the same
    # PO — defends against accidental duplicate entry during a chaotic
    # month-end. Scoped per PO (not per vendor) because that's the
    # operator's working scope.
    create unique_index(:procurement_invoices, [:purchase_order_id, :invoice_number])
  end
end
