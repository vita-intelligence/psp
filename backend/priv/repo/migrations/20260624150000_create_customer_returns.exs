defmodule Backend.Repo.Migrations.CreateCustomerReturns do
  use Ecto.Migration

  @moduledoc """
  Customer returns (RMAs) + lines + photo evidence files.

  State machine (enforced in `Backend.CustomerReturns`):

      draft → received → accepted   (terminal — credit note auto-issued)
                      ↘ rejected   (terminal — we declined the return)
                      ↘ cancelled  (terminal — operator-cancelled)

  An RMA can reference an originating invoice — most do — but the
  link is optional so one-off returns (sample swaps, gift goodwill)
  don't get rejected for not having paperwork.

  On `accept`, the context creates a `customer_invoices` row with
  `kind = "credit_note"`, lines mirroring the accepted RMA lines at
  the original CO unit price (so the customer's outstanding A/R drops
  by the same amount we billed them). The credit note's
  `linked_rma_id` FK we add here points back to the RMA.

  Files capture the photographic + paperwork evidence (damaged-goods
  photos, return shipping labels, customer email screenshots) the
  way Vendor evidence works — same shape.
  """

  def change do
    create table(:customer_returns) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :status, :string, size: 30, default: "draft", null: false

      add :customer_id, references(:customers, on_delete: :restrict), null: false
      # Optional — most RMAs trace back to an invoice; some don't.
      add :customer_invoice_id,
          references(:customer_invoices, on_delete: :nilify_all)

      # Date the return was raised (operator-editable). Distinct from
      # `inserted_at` which is the row-creation timestamp.
      add :return_date, :date, null: false

      add :reason_summary, :string, size: 240
      add :notes, :text

      # State-transition timestamps + actors.
      add :received_at, :utc_datetime
      add :resolved_at, :utc_datetime
      add :cancelled_at, :utc_datetime
      add :cancellation_reason, :text
      add :rejection_reason, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)
      add :received_by_id, references(:users, on_delete: :nilify_all)
      add :resolved_by_id, references(:users, on_delete: :nilify_all)
      add :cancelled_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customer_returns, [:uuid])
    create index(:customer_returns, [:company_id, :status])
    create index(:customer_returns, [:customer_id])
    create index(:customer_returns, [:customer_invoice_id])
    create index(:customer_returns, [:return_date])

    create table(:customer_return_lines) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :customer_return_id,
          references(:customer_returns, on_delete: :delete_all),
          null: false

      # Item is required — every line needs to identify what's coming
      # back. CO line link is optional (one-off lines without source).
      add :item_id, references(:items, on_delete: :restrict), null: false
      add :customer_invoice_line_id,
          references(:customer_invoice_lines, on_delete: :nilify_all)

      # Qty the customer says they're returning. Locked once received.
      add :qty_returned, :decimal, precision: 14, scale: 4, null: false
      # Qty actually accepted after physical inspection. Set when the
      # RMA flips to `accepted`. 0 ≤ qty_accepted ≤ qty_returned.
      add :qty_accepted, :decimal, precision: 14, scale: 4

      # damaged | wrong_item | quality_fail | customer_changed_mind |
      # short_shipment | overshipment | other
      add :reason_code, :string, size: 40, null: false
      add :reason_notes, :text

      # Snapshot of the price we billed at the original sale, so the
      # credit note can be issued at the same unit_price even if the
      # source invoice/CO is edited later (it can't be, but defensive).
      add :unit_price, :decimal, precision: 14, scale: 4, default: 0, null: false
      add :line_credit_amount, :decimal, precision: 12, scale: 2, default: 0, null: false

      add :inspection_notes, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customer_return_lines, [:uuid])
    create index(:customer_return_lines, [:customer_return_id])
    create index(:customer_return_lines, [:item_id])
    create index(:customer_return_lines, [:customer_invoice_line_id])

    create table(:customer_return_files) do
      add :uuid, :uuid, null: false
      add :customer_return_id,
          references(:customer_returns, on_delete: :delete_all),
          null: false

      add :company_id, references(:companies, on_delete: :delete_all),
        null: false

      # photo | shipping_doc | email | other
      add :kind, :string, size: 40, null: false
      add :filename, :string, size: 255, null: false
      add :mime, :string, size: 120, null: false
      add :byte_size, :bigint, null: false
      add :blob_path, :string, size: 500, null: false

      add :uploaded_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customer_return_files, [:uuid])
    create index(:customer_return_files, [:customer_return_id])

    # Backlink from a credit-note invoice to the RMA that triggered
    # it — lets the FE render "Credit note INV00012 issued from RMA
    # RMA00003" on the RMA detail page.
    alter table(:customer_invoices) do
      add :linked_rma_id, references(:customer_returns, on_delete: :nilify_all)
      # Backlink to the original invoice the credit note offsets.
      # Useful when a refund is processed against the source.
      add :linked_invoice_id,
          references(:customer_invoices, on_delete: :nilify_all)
    end

    create index(:customer_invoices, [:linked_rma_id])
    create index(:customer_invoices, [:linked_invoice_id])
  end
end
