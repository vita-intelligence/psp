defmodule Backend.Repo.Migrations.AddQualificationToVendors do
  use Ecto.Migration

  @moduledoc """
  Audit-defensible Approved-Supplier Programme.

  Adds the qualification-artifact columns BRCGS / FSSC 22000 / GFSI /
  FSVP / 21 CFR 111 auditors expect to see before a supplier is signed
  off. Each artifact carries a date + (where relevant) a document URL
  + outcome + free-text notes.

  Segregation-of-duties columns track *who* last touched the
  qualification record. The approve transition (`Vendors.approve_vendor`)
  rejects when the actor matches `qualified_by_id` — the same human
  can't both collect the evidence AND sign off on it, which is the
  audit-defensibility rule under BRCGS / 21 CFR Part 211 / EU GMP.

  The approval *snapshot* freezes which certs were valid the moment
  QA signed — survives later cert renewal / deletion so an audit
  five years on can still answer "what did they have on file when
  they said yes?".
  """

  def change do
    alter table(:vendors) do
      # SAQ (Supplier Approval Questionnaire) — the standard entry
      # questionnaire covering food-safety system, allergens, traceability.
      add :saq_received_at, :date
      add :saq_document_url, :string, size: 500

      # Risk assessment — written outcome of the supplier-risk classification
      # (informs the `vendor_risk` column we already have).
      add :risk_assessment_completed_at, :date
      add :risk_assessment_notes, :text

      # Facility audit — desk-based (review of vendor's docs) or on-site.
      add :audit_required, :boolean, default: true, null: false
      add :audit_completed_at, :date
      add :audit_kind, :string, size: 20
      add :audit_outcome, :string, size: 30
      add :audit_document_url, :string, size: 500
      add :audit_notes, :text

      # COA / specification sample on file — required for raw materials.
      add :coa_received_at, :date
      add :coa_document_url, :string, size: 500

      # Segregation-of-duties: whoever last touched the qualification
      # record (any of the artifacts above). The approve transition
      # refuses if `actor.id == qualified_by_id`.
      add :qualified_by_id, references(:users, on_delete: :nilify_all)
      add :qualified_at, :utc_datetime

      # Approval evidence snapshot — JSON list of {certificate_id,
      # valid_until} pairs taken at approval time so the audit log
      # survives later cert mutation. Backend.Vendors stamps this on
      # the "approved" branch of approve_vendor.
      add :approval_evidence_snapshot, :map
    end

    create index(:vendors, [:saq_received_at])
    create index(:vendors, [:audit_completed_at])
  end
end
