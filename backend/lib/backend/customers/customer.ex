defmodule Backend.Customers.Customer do
  @moduledoc """
  One customer company (the sell-side mirror of `Backend.Vendors.Vendor`).

  Identity + commercial terms + relationship-cadence + approval state.
  Display code (`C00001`, …) is rendered from `id` + the company's
  numbering format — no stored `code` column.

  `last_contact_at` / `next_contact_at` are stored on the row for
  query performance, but the wisdom-bearing entries live in
  `customer_contact_events`. The status concept (lead / prospect /
  active / dormant / inactive) is a read-time projection over those
  events + order history + `is_active` — there is no `status` column,
  by design (CLAUDE.md HARD RULE: actions, not states).

  Identity columns (legal_name, registration_number, tax_number)
  become immutable once `approval_status = approved`. The Customer
  context enforces — the schema permits edits because legitimate
  pre-approval corrections still need to flow through.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Customers.{Customer, CustomerContact, CustomerContactEvent, CustomerFile}

  @approval_statuses ~w(draft approved suspended rejected)
  @payment_bases ~w(invoice_date dispatch_date month_end)
  @languages ~w(en de fr es it pt pl uk ro nl)
  @credit_check_outcomes ~w(pass fail conditional)
  @aml_outcomes ~w(clean flagged)

  schema "customers" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :name, :string
    field :legal_name, :string
    field :contact_name, :string
    field :website, :string

    field :legal_address, :string
    field :country_code, :string

    field :registration_number, :string
    field :tax_number, :string

    field :currency_code, :string, default: "GBP"
    field :tax_rate, :decimal
    field :default_discount_percent, :decimal
    field :language_code, :string

    field :payment_terms_days, :integer, default: 30
    field :payment_terms_basis, :string, default: "invoice_date"

    field :trade_credit_limit, :decimal

    field :pricelist_id, :integer

    field :contact_frequency_months, :integer, default: 3
    field :contact_started_at, :utc_datetime
    field :last_contact_at, :utc_datetime
    field :next_contact_at, :utc_datetime

    field :first_order_at, :utc_datetime
    field :last_order_at, :utc_datetime
    field :total_orders_count, :integer, default: 0

    field :approval_status, :string, default: "draft"
    field :approved_at, :utc_datetime
    field :approval_notes, :string

    # Qualification checklist — onboarding evidence the audit cares
    # about. Each section: timestamp + actor + (where relevant) outcome
    # + free-text notes; the evidence file lives in customer_files and
    # is referenced by FK.
    field :kyc_verified_at, :utc_datetime
    field :kyc_notes, :string

    field :credit_check_at, :utc_datetime
    field :credit_check_outcome, :string
    field :credit_check_score, :decimal
    field :credit_check_notes, :string

    field :aml_screened_at, :utc_datetime
    field :aml_outcome, :string
    field :aml_notes, :string

    field :contract_signed_at, :utc_datetime
    field :contract_notes, :string

    # Segregation of duties — last actor on ANY qualification field.
    # approve_customer/3 rejects when actor.id == qualified_by_id.
    field :qualified_at, :utc_datetime
    field :approval_evidence_snapshot, :map

    # Periodic re-qualification cadence.
    field :review_frequency_months, :integer, default: 12
    field :last_review_at, :date
    field :next_review_at, :date

    field :is_active, :boolean, default: true

    belongs_to :company, Company
    belongs_to :account_manager, User
    belongs_to :approved_by, User
    belongs_to :created_by, User
    belongs_to :updated_by, User

    # Per-section actor (segregation of duties).
    belongs_to :kyc_verified_by, User
    belongs_to :credit_check_by, User
    belongs_to :aml_screened_by, User
    belongs_to :contract_signed_by, User
    belongs_to :qualified_by, User

    # Per-section evidence file FK.
    belongs_to :kyc_file, CustomerFile
    belongs_to :credit_check_file, CustomerFile
    belongs_to :contract_file, CustomerFile

    has_many :contacts, CustomerContact, foreign_key: :customer_id
    has_many :files, CustomerFile, foreign_key: :customer_id
    has_many :contact_events, CustomerContactEvent, foreign_key: :customer_id

    timestamps(type: :utc_datetime)
  end

  def approval_statuses, do: @approval_statuses
  def payment_bases, do: @payment_bases
  def languages, do: @languages
  def credit_check_outcomes, do: @credit_check_outcomes
  def aml_outcomes, do: @aml_outcomes

  @doc """
  Identity + contact + commercial terms.

  Approval columns are NOT cast here — those flow through
  `approve_changeset/2` so a generic save can't accidentally flip a
  customer to `approved`.

  Identity fields (legal_name, tax_number, registration_number) are
  cast but their immutability after approval is enforced at the
  context layer in `Backend.Customers.update/2`.
  """
  def changeset(%Customer{} = customer, attrs) do
    customer
    |> cast(attrs, [
      :company_id,
      :name,
      :legal_name,
      :contact_name,
      :website,
      :legal_address,
      :country_code,
      :registration_number,
      :tax_number,
      :currency_code,
      :tax_rate,
      :default_discount_percent,
      :language_code,
      :payment_terms_days,
      :payment_terms_basis,
      :trade_credit_limit,
      :pricelist_id,
      :contact_frequency_months,
      :account_manager_id,
      :is_active,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :name])
    |> validate_length(:name, min: 1, max: 160)
    |> validate_length(:legal_name, max: 200)
    |> validate_length(:contact_name, max: 120)
    |> validate_length(:website, max: 200)
    |> validate_length(:registration_number, max: 80)
    |> validate_length(:tax_number, max: 80)
    |> validate_length(:currency_code, is: 3)
    |> validate_country_code()
    |> validate_language_code()
    |> validate_number(:tax_rate, greater_than_or_equal_to: 0, less_than: 100)
    |> validate_number(:default_discount_percent,
      greater_than_or_equal_to: 0,
      less_than_or_equal_to: 100
    )
    |> validate_number(:payment_terms_days,
      greater_than_or_equal_to: 0,
      less_than_or_equal_to: 365
    )
    |> validate_inclusion(:payment_terms_basis, @payment_bases)
    |> validate_number(:trade_credit_limit, greater_than_or_equal_to: 0)
    |> validate_number(:contact_frequency_months,
      greater_than_or_equal_to: 0,
      less_than_or_equal_to: 60
    )
    |> unique_constraint([:company_id, :name],
      name: :customers_company_id_name_index,
      message: "a customer with this name already exists"
    )
  end

  @doc """
  Qualification-artifact write. Touches the KYC / Credit / AML /
  Contract columns + their cadence sibling (review_frequency_months /
  last_review_at / next_review_at) AND stamps `qualified_by_id` +
  `qualified_at` so the approve transition can enforce segregation
  of duties.

  This is a separate context entry-point from `changeset/2` because
  the qualification record is audit-sensitive and we want a distinct
  approval-gating story on it — also so an arbitrary `update/3`
  can't accidentally clear an evidence FK by sending a partial body.
  """
  def qualification_changeset(%Customer{} = customer, attrs) do
    customer
    |> cast(attrs, [
      :kyc_verified_at,
      :kyc_verified_by_id,
      :kyc_file_id,
      :kyc_notes,
      :credit_check_at,
      :credit_check_by_id,
      :credit_check_outcome,
      :credit_check_score,
      :credit_check_file_id,
      :credit_check_notes,
      :aml_screened_at,
      :aml_screened_by_id,
      :aml_outcome,
      :aml_notes,
      :contract_signed_at,
      :contract_signed_by_id,
      :contract_file_id,
      :contract_notes,
      :review_frequency_months,
      :last_review_at,
      :next_review_at,
      :qualified_by_id,
      :qualified_at,
      :updated_by_id
    ])
    |> maybe_validate_inclusion(:credit_check_outcome, @credit_check_outcomes)
    |> maybe_validate_inclusion(:aml_outcome, @aml_outcomes)
    |> validate_number(:review_frequency_months,
      greater_than: 0,
      less_than_or_equal_to: 120
    )
  end

  @doc """
  Approval transition. Only approval columns are cast — identity and
  commercial fields stay locked behind `changeset/2`.
  """
  def approve_changeset(%Customer{} = customer, attrs) do
    customer
    |> cast(attrs, [
      :approval_status,
      :approval_notes,
      :approved_at,
      :approved_by_id,
      :approval_evidence_snapshot,
      :last_review_at,
      :next_review_at,
      :updated_by_id
    ])
    |> validate_required([:approval_status])
    |> validate_inclusion(:approval_status, @approval_statuses)
  end

  # Inclusion only when the field has a value — qualification fields
  # are optional individually; the approve transition is what enforces
  # they're ALL set together.
  defp maybe_validate_inclusion(changeset, field, allowed) do
    case get_field(changeset, field) do
      nil -> changeset
      _ -> validate_inclusion(changeset, field, allowed)
    end
  end

  @doc """
  Cadence write. Used when a contact event lands — we update
  `last_contact_at`, recompute `next_contact_at`, and (on first
  contact) backfill `contact_started_at`.
  """
  def cadence_changeset(%Customer{} = customer, attrs) do
    customer
    |> cast(attrs, [
      :contact_started_at,
      :last_contact_at,
      :next_contact_at
    ])
  end

  defp validate_country_code(changeset) do
    case get_field(changeset, :country_code) do
      nil -> changeset
      "" -> changeset
      code when is_binary(code) ->
        if String.match?(code, ~r/^[A-Z]{2}$/) do
          changeset
        else
          add_error(changeset, :country_code, "must be a 2-letter ISO-3166 country code")
        end
      _ -> add_error(changeset, :country_code, "must be a 2-letter ISO-3166 country code")
    end
  end

  defp validate_language_code(changeset) do
    case get_field(changeset, :language_code) do
      nil -> changeset
      "" -> changeset
      _ -> validate_inclusion(changeset, :language_code, @languages)
    end
  end
end
