defmodule Backend.Repo.Migrations.CreateVendors do
  use Ecto.Migration

  @moduledoc """
  Vendor (supplier) registry + per-item approved-supplier list +
  vendor↔certificate join.

  Regulated food/supplements work requires an *approved vendor list*
  before any raw material is purchased. The vendor row carries the
  supplier-risk + qualification metadata GFSI/BRC audits expect; the
  vendor_approved_items join is the edge PO line validation reads
  ("can this vendor supply this item?"); vendor_certificates reuses
  the existing certificate registry (GMP / BRC / FSSC / halal /
  kosher / organic / …) instead of bolting on per-cert columns.

  Performance reviews + complaints live in their own tables (added
  later) so the vendor row stays small and current-state.
  """

  def change do
    create table(:vendors) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :name, :string, null: false, size: 160
      add :legal_name, :string, size: 200

      add :email, :string, size: 160
      add :phone, :string, size: 60
      add :website, :string, size: 200
      add :contact_name, :string, size: 120

      add :legal_address, :text

      add :registration_number, :string, size: 80
      add :tax_number, :string, size: 80
      add :tax_rate, :decimal, precision: 6, scale: 3

      add :currency_code, :string, size: 3, default: "GBP", null: false

      # Lead time + payment math drive PO defaults — keep them on the
      # vendor so a buyer doesn't have to look them up each time.
      add :default_lead_time_days, :integer, default: 0, null: false

      # Payment terms — "N days after <basis>" where basis is one of
      # invoice_date | month_end | delivery_date.
      add :payment_terms_days, :integer, default: 30, null: false
      add :payment_basis, :string, size: 20, default: "invoice_date", null: false

      # Supplier qualification metadata (GFSI / HARPC requirement).
      add :supply_chain_type, :string, size: 30
      add :vendor_risk, :string, size: 10
      add :product_types, {:array, :string}, default: []

      # Supplier Approval Questionnaire (SAQ) lifecycle.
      add :questionnaire_status, :string, size: 20, default: "not_sent", null: false
      add :traceability_verification_status, :string, size: 20, default: "not_done", null: false

      # Periodic re-qualification cadence.
      add :review_frequency_months, :integer
      add :last_review_at, :date
      add :next_review_at, :date

      # Approval lifecycle — gates whether POs can be raised against
      # this vendor at all. ESIGN snapshot of who approved + when.
      add :approval_status, :string, size: 20, default: "pending", null: false
      add :approved_at, :utc_datetime
      add :approval_notes, :text

      add :notes, :text
      add :is_active, :boolean, default: true, null: false

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :approved_by_id, references(:users, on_delete: :nilify_all)
      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:vendors, [:uuid])
    create unique_index(:vendors, [:company_id, :name])
    create index(:vendors, [:company_id, :approval_status])
    create index(:vendors, [:company_id, :is_active])
    create index(:vendors, [:next_review_at])

    create table(:vendor_approved_items) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :vendor_id, references(:vendors, on_delete: :delete_all), null: false
      add :item_id, references(:items, on_delete: :delete_all), null: false

      add :approved_at, :utc_datetime
      add :notes, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :approved_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:vendor_approved_items, [:vendor_id, :item_id],
             name: :vendor_approved_items_vendor_item_index
           )

    create index(:vendor_approved_items, [:company_id])
    create index(:vendor_approved_items, [:item_id])

    create table(:vendor_certificates) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :vendor_id, references(:vendors, on_delete: :delete_all), null: false
      add :certificate_id, references(:certificates, on_delete: :restrict), null: false

      # Concrete instance of the cert this vendor holds — number on
      # the certificate, validity window, scanned document URL.
      add :certificate_number, :string, size: 120
      add :valid_from, :date
      add :valid_until, :date
      add :document_url, :string, size: 500
      add :notes, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :uploaded_at, :utc_datetime
      add :uploaded_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:vendor_certificates, [:vendor_id, :certificate_id],
             name: :vendor_certificates_vendor_certificate_index
           )

    create index(:vendor_certificates, [:company_id])
    create index(:vendor_certificates, [:valid_until])
  end
end
