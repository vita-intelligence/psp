defmodule Backend.Repo.Migrations.CreateGoodsInInspections do
  use Ecto.Migration

  @moduledoc """
  BRCGS 3.5.1 / FSSC 22000 / GFSI incoming-inspection record.

  One row per delivery against a PO. A single PO can have N inspections
  (multi-delivery is normal — the supplier ships in tranches), so the
  link is `purchase_order_id` + per-delivery timestamps, not a UNIQUE
  on the PO.

  Sections 2 / 4-7 land in JSONB columns so adding a new check is a
  value change, not a schema change. Section 1 (delivery info) gets
  real typed columns because every check on this row keys off them
  (date sort, vehicle reg search, seal traceability).

  Two-tier ESIGN mirrors the PO approval shape: goods-in operator
  fills + signs, then a different quality approver signs to finalise
  the verdict. The `quality_decision` enum drives the downstream lot
  routing (approved → qc_passed events, hold → leave in quarantine,
  rejected → qc_failed events) — context layer does that work inside
  the same transaction as the approver's signature.

  Audit trail uses the standard `Backend.Audit.record_*` flow.
  Display code (`GI00001`, …) is rendered from id + the company's
  numbering format — no stored `code` column.
  """

  def change do
    create table(:goods_in_inspections) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :status, :string, size: 30, default: "draft", null: false

      add :company_id, references(:companies, on_delete: :restrict), null: false

      add :purchase_order_id,
          references(:purchase_orders, on_delete: :restrict),
          null: false

      # ----- Section 1: Delivery information -----------------------
      # Date carries the audit-trail anchor; time + transport + reg
      # are the supplier-traceability fields the auditor pulls when
      # a complaint references "the load that arrived on the 15th".
      add :delivery_date, :date, null: false
      add :delivery_time, :time
      add :transport_company, :string, size: 160
      add :vehicle_registration, :string, size: 40
      # Seal number is nullable — not every delivery is sealed; the
      # vehicle_inspection JSONB carries the `seal_intact_or_na` check
      # for that branch.
      add :seal_number, :string, size: 80

      # ----- Section 2: Vehicle inspection -------------------------
      # Map of check_key → %{passed: bool, notes: string?}.
      # Allowed keys live in `Backend.GoodsIn.@vehicle_inspection_keys`.
      add :vehicle_inspection, :map, default: %{}, null: false

      # ----- Sections 4-7: Compliance checks -----------------------
      # Same JSONB shape as section 2; allowed-key registries live
      # in the context module so admins / FE can ask for them.
      add :documentation_verification, :map, default: %{}, null: false
      add :physical_inspection, :map, default: %{}, null: false
      add :food_safety_checks, :map, default: %{}, null: false
      add :storage_verification, :map, default: %{}, null: false

      # ----- Section 8: Final quality decision ---------------------
      # Set by `sign_quality_approver/3`. Stays NULL while the
      # operator is still drafting. `quality_decision_reason` is
      # required when decision != approved.
      add :quality_decision, :string, size: 20
      add :quality_decision_reason, :text

      # ----- ESIGN: goods-in operator ------------------------------
      add :goods_in_operator_id, references(:users, on_delete: :nilify_all)
      # Base64-encoded PNG of the signature-pad capture. Same shape
      # the PO approval flow uses.
      add :goods_in_operator_signature_image, :text
      add :goods_in_operator_signed_at, :utc_datetime

      # ----- ESIGN: quality approver ------------------------------
      # Must differ from goods_in_operator_id — segregation of duties
      # enforced in the context.
      add :quality_approver_id, references(:users, on_delete: :nilify_all)
      add :quality_approver_signature_image, :text
      add :quality_approver_signed_at, :utc_datetime

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:goods_in_inspections, [:uuid])
    create index(:goods_in_inspections, [:company_id, :purchase_order_id])
    create index(:goods_in_inspections, [:company_id, :status, :delivery_date])
  end
end
