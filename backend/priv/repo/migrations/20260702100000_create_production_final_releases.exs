defmodule Backend.Repo.Migrations.CreateProductionFinalReleases do
  use Ecto.Migration

  @moduledoc """
  Final Product Release record — BRCGS Issue 9 § 5.6 Positive Release.

  One row per (parent MO, output lot). Captures the QA sign-off ceremony
  before an `awaiting_release` finished-product lot flips to `available`
  and can be dispatched. Dual sign-off (releaser ≠ approver) is required
  for the Release decision — same shape as the goods-in inspection
  ESIGN. Hold and Reject decisions are single-approver actions but
  land on the same row.

  Files (CoA, BMR, micro report, label proof / retain sample photo)
  live in `production_final_release_files`.
  """

  def change do
    create table(:production_final_releases) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :restrict), null: false

      # The parent MO whose output is being released. Sub-MO outputs
      # that were booked into a parent don't get their own release —
      # they ride the parent's release.
      add :manufacturing_order_id,
          references(:manufacturing_orders, on_delete: :restrict),
          null: false

      # One release row per output lot. An MO producing multiple output
      # lots gets one row per lot (per-batch traceability, BRCGS 3.9).
      add :stock_lot_id, references(:stock_lots, on_delete: :restrict), null: false

      # `pending` — draft, sigs not yet complete
      # `released` — Release finalised, lot flipped to available
      # `on_hold` — Hold finalised, lot flipped to on_hold
      # `rejected` — Reject finalised, lot flipped to rejected
      add :status, :string, size: 20, default: "pending", null: false

      # QA freeform release notes (BRCGS 5.6.2 — reviewer's summary of
      # the batch review). The typed test results live in the attached
      # CoA / micro report PDFs.
      add :notes, :text

      # Set when a Hold or Reject decision fires. Required by the
      # context for those two decisions.
      add :hold_reason, :text
      add :reject_reason, :text

      # ----- Releaser (first signature) ---------------------------
      add :releaser_id, references(:users, on_delete: :nilify_all)
      # Base64-encoded PNG of the signature-pad capture (mirrors the
      # goods-in ESIGN column).
      add :releaser_signature_image, :text
      add :releaser_signed_at, :utc_datetime

      # ----- Approver (second signature, dual sign-off) ------------
      # Must differ from releaser_id — segregation of duties enforced
      # in the context (BRCGS Grade A requires two authorised
      # signatures on positive release).
      add :approver_id, references(:users, on_delete: :nilify_all)
      add :approver_signature_image, :text
      add :approver_signed_at, :utc_datetime

      # Stamped when the row transitions out of `pending`.
      add :finalized_at, :utc_datetime
      add :finalized_by_id, references(:users, on_delete: :nilify_all)

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:production_final_releases, [:uuid])
    # One release row per lot. Re-opening a decision replaces the
    # existing row's state; history lives in the lot's lifecycle
    # events.
    create unique_index(:production_final_releases, [:stock_lot_id])
    create index(:production_final_releases, [:company_id, :status])
    create index(:production_final_releases, [:manufacturing_order_id])
  end
end
