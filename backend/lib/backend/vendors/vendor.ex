defmodule Backend.Vendors.Vendor do
  @moduledoc """
  One supplier company. Carries identity + commercial terms + the
  supplier-qualification metadata GFSI / HARPC audits expect (risk
  class, SAQ status, review cadence) + an approval lifecycle that
  gates whether a Purchase Order can be raised against it.

  Display code (`VN00001`, …) is rendered from `id` + the company's
  numbering format — no stored `code` column.

  Heavyweight evidence (per-cert validity, scanned audit reports,
  complaint log, signed performance reviews) lives in sibling tables
  rather than column-bloat here.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Vendors.{ApprovedItem, VendorCertificate, VendorFile}

  @approval_statuses ~w(pending approved suspended rejected)
  @supply_chain_types ~w(manufacturer co_manufacturer distributor broker agent grower)
  @vendor_risks ~w(low medium high)
  @questionnaire_statuses ~w(not_sent sent received approved overdue na)
  @traceability_statuses ~w(not_done in_progress verified failed na)
  @payment_bases ~w(invoice_date month_end delivery_date)
  @audit_kinds ~w(desk onsite virtual)
  @audit_outcomes ~w(pass pass_with_findings fail)

  schema "vendors" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :name, :string
    field :legal_name, :string

    field :email, :string
    field :phone, :string
    field :website, :string
    field :contact_name, :string

    field :legal_address, :string

    field :registration_number, :string
    field :tax_number, :string
    field :tax_rate, :decimal

    field :currency_code, :string, default: "GBP"

    field :default_lead_time_days, :integer, default: 0
    field :payment_terms_days, :integer, default: 30
    field :payment_basis, :string, default: "invoice_date"

    # Supplier qualification metadata.
    field :supply_chain_type, :string
    field :vendor_risk, :string
    field :product_types, {:array, :string}, default: []
    field :questionnaire_status, :string, default: "not_sent"
    field :traceability_verification_status, :string, default: "not_done"

    field :review_frequency_months, :integer
    field :last_review_at, :date
    field :next_review_at, :date

    field :approval_status, :string, default: "pending"
    field :approved_at, :utc_datetime
    field :approval_notes, :string

    # Qualification artifacts (BRCGS / FSSC 22000 / GFSI checklist).
    field :saq_received_at, :date
    field :risk_assessment_completed_at, :date
    field :risk_assessment_notes, :string
    field :audit_required, :boolean, default: true
    field :audit_completed_at, :date
    field :audit_kind, :string
    field :audit_outcome, :string
    field :audit_notes, :string
    field :coa_received_at, :date

    # Segregation of duties. `qualified_by_id` is whoever last touched
    # any qualification field; the approve transition refuses when
    # the actor matches.
    field :qualified_at, :utc_datetime
    field :approval_evidence_snapshot, :map

    field :notes, :string
    field :is_active, :boolean, default: true

    belongs_to :company, Company
    belongs_to :approved_by, User
    belongs_to :qualified_by, User
    belongs_to :created_by, User
    belongs_to :updated_by, User

    # Evidence files. Each artifact has its own FK so we can show
    # the right filename + download link next to each checklist item.
    belongs_to :saq_file, VendorFile
    belongs_to :audit_file, VendorFile
    belongs_to :coa_file, VendorFile

    has_many :approved_items, ApprovedItem, foreign_key: :vendor_id
    has_many :certificates, VendorCertificate, foreign_key: :vendor_id
    has_many :files, VendorFile, foreign_key: :vendor_id

    timestamps(type: :utc_datetime)
  end

  def approval_statuses, do: @approval_statuses
  def supply_chain_types, do: @supply_chain_types
  def vendor_risks, do: @vendor_risks
  def questionnaire_statuses, do: @questionnaire_statuses
  def traceability_statuses, do: @traceability_statuses
  def payment_bases, do: @payment_bases
  def audit_kinds, do: @audit_kinds
  def audit_outcomes, do: @audit_outcomes

  @doc """
  Identity + contact + commercial terms + qualification metadata.
  Approval columns are NOT cast here — those land via
  `approve_changeset/2` so the UI can't accidentally flip a vendor
  to `approved` via a generic save.
  """
  def changeset(vendor, attrs) do
    vendor
    |> cast(attrs, [
      :company_id,
      :name,
      :legal_name,
      :email,
      :phone,
      :website,
      :contact_name,
      :legal_address,
      :registration_number,
      :tax_number,
      :tax_rate,
      :currency_code,
      :default_lead_time_days,
      :payment_terms_days,
      :payment_basis,
      :supply_chain_type,
      :vendor_risk,
      :product_types,
      :questionnaire_status,
      :traceability_verification_status,
      :review_frequency_months,
      :last_review_at,
      :next_review_at,
      :notes,
      :is_active,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :name])
    |> validate_length(:name, min: 1, max: 160)
    |> validate_length(:legal_name, max: 200)
    |> validate_length(:email, max: 160)
    |> maybe_validate_email()
    |> validate_length(:phone, max: 60)
    |> validate_length(:website, max: 200)
    |> validate_length(:contact_name, max: 120)
    |> validate_length(:registration_number, max: 80)
    |> validate_length(:tax_number, max: 80)
    |> validate_length(:currency_code, is: 3)
    |> validate_number(:default_lead_time_days, greater_than_or_equal_to: 0, less_than_or_equal_to: 730)
    |> validate_number(:payment_terms_days, greater_than_or_equal_to: 0, less_than_or_equal_to: 365)
    |> validate_inclusion(:payment_basis, @payment_bases)
    |> validate_number(:tax_rate, greater_than_or_equal_to: 0, less_than: 100)
    |> maybe_validate_inclusion(:supply_chain_type, @supply_chain_types)
    |> maybe_validate_inclusion(:vendor_risk, @vendor_risks)
    |> validate_inclusion(:questionnaire_status, @questionnaire_statuses)
    |> validate_inclusion(:traceability_verification_status, @traceability_statuses)
    |> validate_number(:review_frequency_months,
      greater_than: 0,
      less_than_or_equal_to: 120
    )
    |> validate_review_dates()
    |> unique_constraint([:company_id, :name],
      name: :vendors_company_id_name_index,
      message: "a vendor with this name already exists"
    )
  end

  @doc """
  Approval transition. Only the status + evidence snapshot fields
  are cast — name + contact details stay locked behind the standard
  changeset so an approve action can't accidentally mutate identity.
  """
  def approve_changeset(vendor, attrs) do
    vendor
    |> cast(attrs, [
      :approval_status,
      :approval_notes,
      :approved_at,
      :approved_by_id,
      :approval_evidence_snapshot,
      :updated_by_id
    ])
    |> validate_required([:approval_status])
    |> validate_inclusion(:approval_status, @approval_statuses)
  end

  @doc """
  Qualification-artifact write. Touches the SAQ / risk-assessment /
  audit / COA columns AND stamps `qualified_by_id` + `qualified_at`
  so the approve transition can enforce segregation of duties.
  """
  def qualification_changeset(vendor, attrs) do
    vendor
    |> cast(attrs, [
      :saq_received_at,
      :saq_file_id,
      :risk_assessment_completed_at,
      :risk_assessment_notes,
      :audit_required,
      :audit_completed_at,
      :audit_kind,
      :audit_outcome,
      :audit_file_id,
      :audit_notes,
      :coa_received_at,
      :coa_file_id,
      :qualified_by_id,
      :qualified_at,
      :updated_by_id
    ])
    |> maybe_validate_inclusion(:audit_kind, @audit_kinds)
    |> maybe_validate_inclusion(:audit_outcome, @audit_outcomes)
  end

  # Inclusion only fires when the field has a value — these are
  # optional enums where an unset value is valid (e.g. a new vendor
  # before risk assessment has been done).
  defp maybe_validate_inclusion(changeset, field, allowed) do
    case get_field(changeset, field) do
      nil -> changeset
      _ -> validate_inclusion(changeset, field, allowed)
    end
  end

  defp maybe_validate_email(changeset) do
    case get_field(changeset, :email) do
      nil -> changeset
      "" -> changeset
      _ ->
        validate_format(changeset, :email, ~r/^[^\s@]+@[^\s@]+\.[^\s@]+$/,
          message: "invalid email"
        )
    end
  end

  # If both review dates are set, next must be after last. Leaves
  # either-unset cases alone so a brand-new vendor doesn't have to
  # fabricate a review history.
  defp validate_review_dates(changeset) do
    last = get_field(changeset, :last_review_at)
    next = get_field(changeset, :next_review_at)

    if is_struct(last, Date) and is_struct(next, Date) and Date.compare(next, last) != :gt do
      add_error(changeset, :next_review_at, "must be after last review")
    else
      changeset
    end
  end
end
