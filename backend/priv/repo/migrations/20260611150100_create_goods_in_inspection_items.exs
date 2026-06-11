defmodule Backend.Repo.Migrations.CreateGoodsInInspectionItems do
  use Ecto.Migration

  @moduledoc """
  Per-PO-line decision row inside one goods-in inspection.

  The inspection header captures the delivery-wide verdict; each row
  here captures the per-line decision (accept / hold / reject) plus
  the as-counted qty and the packaging condition the operator saw.
  Auditor reads this when a complaint references "the second pallet
  on line 3 was damaged" — the per-line row carries the notes.

  Unique on (goods_in_inspection_id, purchase_order_line_id) so one
  inspection can't carry two contradictory verdicts for the same
  line — if the operator wants to split a line, they raise a
  follow-up inspection for the next delivery.
  """

  def change do
    create table(:goods_in_inspection_items) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :company_id, references(:companies, on_delete: :restrict), null: false

      add :goods_in_inspection_id,
          references(:goods_in_inspections, on_delete: :delete_all),
          null: false

      add :purchase_order_line_id,
          references(:purchase_order_lines, on_delete: :restrict),
          null: false

      # What the operator actually counted vs the PO line's qty_ordered
      # — drives short-shipment / over-receipt reporting downstream.
      add :qty_received, :decimal, precision: 14, scale: 4, null: false

      # `good | damaged`. Damaged routes to the hold branch by default
      # but doesn't force it; the operator records the reason and
      # picks a material_decision below.
      add :packaging_condition, :string, size: 20
      add :packaging_condition_notes, :text

      # Per-line verdict — drives the lifecycle event the approver
      # emits when they sign. `accept` → qc_passed, `hold` → leave at
      # quarantine (reason captured), `reject` → qc_failed.
      add :material_decision, :string, size: 20
      add :material_decision_reason, :text

      timestamps(type: :utc_datetime)
    end

    create unique_index(:goods_in_inspection_items, [:uuid])
    create index(:goods_in_inspection_items, [:goods_in_inspection_id])

    create unique_index(
             :goods_in_inspection_items,
             [:goods_in_inspection_id, :purchase_order_line_id],
             name: :goods_in_items_inspection_line_index
           )
  end
end
