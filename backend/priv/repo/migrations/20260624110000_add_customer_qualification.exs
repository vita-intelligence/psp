defmodule Backend.Repo.Migrations.AddCustomerQualification do
  use Ecto.Migration

  @moduledoc """
  Audit-defensible customer onboarding (sell-side parallel of vendor
  qualification).

  Adds the evidence-bearing columns that ANY auditor / regulator /
  accountant would expect to see before a sales relationship is
  contractually live:

    * **KYC** — confirmation that the customer is a real registered
      entity, with the corporate-registry document on file.
    * **Credit check** — outcome of a credit-bureau lookup with the
      report PDF on file. Drives the trade-credit-limit decision.
    * **AML / sanctions screening** — confirmation that the customer
      isn't on a sanctions / PEP / adverse-media list. Required under
      EU/UK financial-crime regs and FinCEN equivalents.
    * **Contract** — countersigned MSA / NDA on file. Without this,
      payment terms aren't legally enforceable.

  Each section carries:
    - `*_at` timestamp (when the check was completed)
    - `*_by_id` actor FK (who completed it — drives 4-eyes)
    - `*_file_id` evidence file FK (the proof, stored in
      Backend.Storage via the customer_files table)
    - section-specific outcome / notes columns

  Plus:
    - `qualified_at` / `qualified_by_id` — last user to touch ANY
      qualification field. The approve transition enforces
      segregation of duties: approver must differ from this user.
    - `approval_evidence_snapshot` — JSON blob frozen at approval
      time. Captures the state of every checklist item so a future
      audit can answer "what was on file the day we said yes?" even
      if files are later replaced or removed.
    - Periodic re-qualification cadence — `review_frequency_months`
      (default 12), `last_review_at`, `next_review_at`. Overdue
      customers (next_review_at < today) get surfaced on the list.
  """

  def change do
    alter table(:customers) do
      # KYC — corporate registry / certificate of incorporation check.
      add :kyc_verified_at, :utc_datetime
      add :kyc_verified_by_id, references(:users, on_delete: :nilify_all)
      add :kyc_file_id, references(:customer_files, on_delete: :nilify_all)
      add :kyc_notes, :text

      # Credit bureau — outcome drives trade_credit_limit conversation.
      add :credit_check_at, :utc_datetime
      add :credit_check_by_id, references(:users, on_delete: :nilify_all)
      add :credit_check_outcome, :string, size: 20
      add :credit_check_score, :decimal, precision: 8, scale: 2
      add :credit_check_file_id, references(:customer_files, on_delete: :nilify_all)
      add :credit_check_notes, :text

      # AML / sanctions — clean / flagged. Notes required when flagged.
      add :aml_screened_at, :utc_datetime
      add :aml_screened_by_id, references(:users, on_delete: :nilify_all)
      add :aml_outcome, :string, size: 20
      add :aml_notes, :text

      # Contract / MSA — signed countersigned PDF.
      add :contract_signed_at, :utc_datetime
      add :contract_signed_by_id, references(:users, on_delete: :nilify_all)
      add :contract_file_id, references(:customer_files, on_delete: :nilify_all)
      add :contract_notes, :text

      # Segregation of duties — whoever last touched any qualification
      # field above. approve_customer/3 rejects when actor.id matches.
      add :qualified_at, :utc_datetime
      add :qualified_by_id, references(:users, on_delete: :nilify_all)

      # Evidence snapshot — JSON freeze of the checklist at approval
      # time. Survives later file replacement / qualification edits.
      add :approval_evidence_snapshot, :map

      # Periodic re-qualification.
      add :review_frequency_months, :integer, default: 12
      add :last_review_at, :date
      add :next_review_at, :date
    end

    create index(:customers, [:kyc_verified_at])
    create index(:customers, [:credit_check_at])
    create index(:customers, [:aml_screened_at])
    create index(:customers, [:contract_signed_at])
    create index(:customers, [:next_review_at])
  end
end
