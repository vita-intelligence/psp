defmodule Backend.Repo.Migrations.CreateReturnInspections do
  @moduledoc """
  Dedicated inspection paperwork for customer returns. Parallel to
  `goods_in_inspections` (which stays PO-only) rather than mixed
  into it — a return of our own product has a different regulatory
  shape from a supplier PO receipt:

    * No vehicle temperature / seal / documentation checks (BRCGS
      §3.5 is supplier-side and doesn't apply).
    * No CoA / allergen declaration review (we shipped it).
    * Focus is physical condition + QC verdict + trace-back.

  Auto-created when an RMA is marked received (draft state). Mobile
  operator walks the wizard: adds N packages per RMA line (each with
  its own dimensions + qty), runs a slimmer BRCGS §3.11-shaped
  physical / food-safety / storage inspection, records a QC verdict
  (approve / hold / rejected). Approval spawns one stock_lot per
  package — each new lot carries `parent_lot_id`,
  `customer_return_id`, and `customer_return_line_id` for full
  recall traceability + moves to `available` (or stays quarantined
  on hold / gets a write-off draft on rejected).
  """

  use Ecto.Migration

  def change do
    create table(:return_inspections) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      # State machine mirror of GoodsInInspection so the shared UI
      # patterns transfer: draft → submitted → approved | hold | rejected.
      add :status, :string, size: 30, null: false, default: "draft"

      add :customer_return_id,
          references(:customer_returns, on_delete: :restrict),
          null: false

      # Receiving context.
      add :delivery_date, :date
      add :delivery_time, :time
      add :courier, :string, size: 160
      add :tracking_number, :string, size: 80
      add :seal_number, :string, size: 80

      # Slimmer check sections vs GII — vehicle / documentation
      # sections dropped, kept the three that materially matter
      # for a return: physical condition, food-safety-on-return,
      # storage-target verification. Each is a JSONB map keyed by
      # check_key so the FE can render / iterate without a migration
      # per new check.
      add :physical_inspection, :jsonb, default: fragment("'{}'")
      add :food_safety_checks, :jsonb, default: fragment("'{}'")
      add :storage_verification, :jsonb, default: fragment("'{}'")

      # QC verdict — the whole point of a return inspection.
      # `approved` = release from quarantine to available.
      # `hold` = keep in quarantine (needs a follow-up decision).
      # `rejected` = fail → seeds a write-off draft in the FE.
      add :quality_decision, :string, size: 20
      add :quality_decision_reason, :text

      # Operator / approver e-signatures.
      add :goods_in_operator_id, references(:users, on_delete: :restrict)
      add :goods_in_operator_signature_image, :text
      add :goods_in_operator_signed_at, :utc_datetime

      add :quality_approver_id, references(:users, on_delete: :restrict)
      add :quality_approver_signature_image, :text
      add :quality_approver_signed_at, :utc_datetime

      add :company_id,
          references(:companies, on_delete: :restrict),
          null: false

      add :created_by_id, references(:users, on_delete: :restrict), null: false
      add :updated_by_id, references(:users, on_delete: :restrict), null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:return_inspections, [:uuid])
    create index(:return_inspections, [:company_id, :status, :inserted_at])
    create index(:return_inspections, [:customer_return_id])

    # One draft inspection per RMA at any given time — enforced via
    # partial unique so completed/rejected inspections don't block a
    # re-open (edge case: operator rejects, RMA gets re-received later).
    create unique_index(:return_inspections, [:customer_return_id],
             where: "status IN ('draft','submitted')",
             name: :return_inspections_one_open_per_rma
           )

    create table(:return_inspection_packages) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :return_inspection_id,
          references(:return_inspections, on_delete: :delete_all),
          null: false

      # Every package traces back to a specific RMA line — that's
      # how "5 boxes of Item A + 3 boxes of Item B" stays sane
      # when the RMA has multiple lines.
      add :customer_return_line_id,
          references(:customer_return_lines, on_delete: :restrict),
          null: false

      # Per-package payload — operator inputs.
      add :qty, :decimal, precision: 20, scale: 5, null: false
      add :package_length_mm, :integer
      add :package_width_mm, :integer
      add :package_height_mm, :integer
      add :package_weight_kg, :decimal, precision: 10, scale: 3
      add :condition_notes, :text

      # Destination cell chosen at wizard time (must be quarantine
      # purpose). Nullable at DB level — validated at approval.
      add :destination_cell_id,
          references(:storage_cells, on_delete: :restrict)

      # Filled at approval time — the stock_lot spawned for this
      # package. Nullable while the inspection is in draft / submitted.
      add :stock_lot_id, references(:stock_lots, on_delete: :nilify_all)

      add :company_id,
          references(:companies, on_delete: :restrict),
          null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:return_inspection_packages, [:uuid])
    create index(:return_inspection_packages, [:return_inspection_id])
    create index(:return_inspection_packages, [:customer_return_line_id])
    create index(:return_inspection_packages, [:stock_lot_id])
  end
end
