defmodule Backend.Repo.Migrations.CreateCustomers do
  use Ecto.Migration

  @moduledoc """
  Customer (sell-side) registry — the buyer mirror of `vendors`.

  Splits into four tables so the customer row stays small and
  current-state, while the things that legitimately grow over the
  lifetime of a relationship live in their own append-only stores:

    * `customers` — identity + commercial terms + approval lifecycle.
    * `customer_contacts` — multiple phones / emails / mobiles. The
      MRPEasy single "Phone" field can't carry an Accounts contact +
      a Sales contact + the Out-of-hours line — we model it properly.
    * `customer_files` — uploads (contracts, NDAs, credit checks,
      photos). Mirror of `vendor_files`; bytes live in our storage
      so the audit trail survives Drive / Dropbox link rot.
    * `customer_contact_events` — call / email / meeting log. This is
      the source of truth that DRIVES `last_contact_at`, the derived
      `status` field on the customer (lead → prospect → active → …),
      and the "Today's contacts" CRM tab when we build it.

  The `status` column does NOT exist on `customers` — status is a
  projection, computed at read time from contact events + order
  history + `is_active`. Workers click action buttons ("Log contact",
  "Mark inactive"); the system writes the event row; status follows.
  CLAUDE.md HARD RULE #1 — actions, not states.

  Identity columns (legal_name, tax_number, registration_number)
  become immutable once `approval_status = approved`. The Customer
  context enforces; the schema permits edits because legitimate
  pre-approval corrections still need to flow through.
  """

  def change do
    create table(:customers) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :name, :string, null: false, size: 160
      add :legal_name, :string, size: 200

      add :contact_name, :string, size: 120
      add :website, :string, size: 200

      add :legal_address, :text
      add :country_code, :string, size: 2

      # Identity numbers — immutable after approval. Pre-approval edits
      # are fine; post-approval edits void the approval and require
      # re-qualification (enforced in Backend.Customers.update/2).
      add :registration_number, :string, size: 80
      add :tax_number, :string, size: 80

      # Commercial — defaults inherited from `companies` on create
      # (currency, tax_rate, language). Per-customer overrides are
      # persisted here so a future invoice can reproduce the terms
      # that were in force on the day the order was placed.
      add :currency_code, :string, size: 3, default: "GBP", null: false
      add :tax_rate, :decimal, precision: 6, scale: 3
      add :default_discount_percent, :decimal, precision: 6, scale: 3
      add :language_code, :string, size: 8

      # Payment terms — "N days after <basis>", basis is one of
      # invoice_date | dispatch_date | month_end. Mirrors vendor's
      # payment_terms_days/payment_basis so the Cash Flow Forecast tab
      # can run a single union across A/P + A/R.
      add :payment_terms_days, :integer, default: 30, null: false
      add :payment_terms_basis, :string, size: 20, default: "invoice_date", null: false

      # Credit posture — set during onboarding, governs the
      # Customer-Order block if outstanding A/R would breach.
      add :trade_credit_limit, :decimal, precision: 18, scale: 2

      # Pricelist FK reserved — `pricelists` table arrives in the
      # Pricelists module. Nullable + no FK constraint today; we add
      # the references() in the migration that creates the table.
      add :pricelist_id, :bigint

      # Contact cadence — `last_contact_at` is set on contact-event
      # insert; `next_contact_at` is computed (last + frequency) with
      # an override-toggle UI. Defaults from company-level cadence.
      add :contact_frequency_months, :integer, default: 3
      add :contact_started_at, :utc_datetime
      add :last_contact_at, :utc_datetime
      add :next_contact_at, :utc_datetime

      # Order-history rollups — set by Backend.SalesOrders when the
      # CO module ships. Stored (not computed live) so the customer
      # list can sort/filter without N+1 aggregate queries.
      add :first_order_at, :utc_datetime
      add :last_order_at, :utc_datetime
      add :total_orders_count, :integer, default: 0, null: false

      # Approval lifecycle — same posture as vendors.
      #   draft → approved | rejected
      # Approver must differ from creator (4-eyes); enforced in
      # Backend.Customers.approve_customer/2.
      add :approval_status, :string, size: 20, default: "draft", null: false
      add :approved_at, :utc_datetime
      add :approval_notes, :text

      add :is_active, :boolean, default: true, null: false

      add :company_id, references(:companies, on_delete: :restrict), null: false

      # Account manager — the salesperson on the hook for this account.
      add :account_manager_id, references(:users, on_delete: :nilify_all)

      add :approved_by_id, references(:users, on_delete: :nilify_all)
      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customers, [:uuid])
    create unique_index(:customers, [:company_id, :name])
    create index(:customers, [:company_id, :approval_status])
    create index(:customers, [:company_id, :is_active])
    create index(:customers, [:company_id, :account_manager_id])
    create index(:customers, [:last_contact_at])
    create index(:customers, [:next_contact_at])

    # --------------------------------------------------------------
    # customer_contacts — phones / emails / mobiles
    # --------------------------------------------------------------

    create table(:customer_contacts) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :customer_id, references(:customers, on_delete: :delete_all), null: false
      add :company_id, references(:companies, on_delete: :restrict), null: false

      # phone | mobile | email | fax | other — controller validates.
      add :kind, :string, size: 20, null: false
      add :value, :string, size: 200, null: false
      add :label, :string, size: 60
      add :is_primary, :boolean, default: false, null: false

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customer_contacts, [:uuid])
    create index(:customer_contacts, [:customer_id])
    create index(:customer_contacts, [:customer_id, :kind])

    # --------------------------------------------------------------
    # customer_files — uploads
    # --------------------------------------------------------------

    create table(:customer_files) do
      add :uuid, :uuid, null: false
      add :customer_id, references(:customers, on_delete: :delete_all), null: false
      add :company_id, references(:companies, on_delete: :delete_all), null: false

      # contract | nda | credit_check | photo | logo | other
      add :kind, :string, size: 40, null: false

      add :filename, :string, size: 255, null: false
      add :mime, :string, size: 120, null: false
      add :byte_size, :bigint, null: false
      add :blob_path, :string, size: 500, null: false

      add :uploaded_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customer_files, [:uuid])
    create index(:customer_files, [:customer_id])
    create index(:customer_files, [:customer_id, :kind])

    # --------------------------------------------------------------
    # customer_contact_events — interaction log (drives derived status)
    # --------------------------------------------------------------

    create table(:customer_contact_events) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :customer_id, references(:customers, on_delete: :delete_all), null: false
      add :company_id, references(:companies, on_delete: :restrict), null: false

      # call | email | meeting | message | note | other.
      add :kind, :string, size: 20, null: false
      add :occurred_at, :utc_datetime, null: false
      add :summary, :text

      add :logged_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customer_contact_events, [:uuid])
    create index(:customer_contact_events, [:customer_id, :occurred_at])
    create index(:customer_contact_events, [:company_id, :occurred_at])
  end
end
