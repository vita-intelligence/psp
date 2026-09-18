defmodule Backend.Repo.Migrations.GoodsInInspectionsSupportRma do
  @moduledoc """
  Unify the receiving-inspection surface: allow one goods_in_inspection
  row to belong to EITHER a purchase_order (supplier delivery, existing
  path) OR a customer_return (RMA delivery). Same table, same wizard,
  same mobile queue — the source is implied by whichever FK is set.

  On `goods_in_inspections`:
    * `customer_return_id` — nullable FK to customer_returns.
    * `purchase_order_id`  — drop NOT NULL.
    * CHECK: exactly one of the two must be set.

  On `goods_in_inspection_items`:
    * `customer_return_line_id` — nullable FK to customer_return_lines.
    * `purchase_order_line_id`  — drop NOT NULL.
    * CHECK: exactly one of the two must be set.
    * Existing `unique(inspection_id, purchase_order_line_id)` stays
      (partial), plus a new partial unique on
      `(inspection_id, customer_return_line_id)`.
  """

  use Ecto.Migration

  def change do
    alter table(:goods_in_inspections) do
      add :customer_return_id, references(:customer_returns, on_delete: :restrict)
    end

    execute(
      "ALTER TABLE goods_in_inspections ALTER COLUMN purchase_order_id DROP NOT NULL",
      "ALTER TABLE goods_in_inspections ALTER COLUMN purchase_order_id SET NOT NULL"
    )

    execute(
      """
      ALTER TABLE goods_in_inspections
      ADD CONSTRAINT goods_in_inspections_source_xor
      CHECK (
        (purchase_order_id IS NOT NULL AND customer_return_id IS NULL) OR
        (purchase_order_id IS NULL AND customer_return_id IS NOT NULL)
      )
      """,
      "ALTER TABLE goods_in_inspections DROP CONSTRAINT goods_in_inspections_source_xor"
    )

    create index(:goods_in_inspections, [:customer_return_id])

    alter table(:goods_in_inspection_items) do
      add :customer_return_line_id,
          references(:customer_return_lines, on_delete: :restrict)
    end

    execute(
      "ALTER TABLE goods_in_inspection_items ALTER COLUMN purchase_order_line_id DROP NOT NULL",
      "ALTER TABLE goods_in_inspection_items ALTER COLUMN purchase_order_line_id SET NOT NULL"
    )

    execute(
      """
      ALTER TABLE goods_in_inspection_items
      ADD CONSTRAINT goods_in_inspection_items_source_xor
      CHECK (
        (purchase_order_line_id IS NOT NULL AND customer_return_line_id IS NULL) OR
        (purchase_order_line_id IS NULL AND customer_return_line_id IS NOT NULL)
      )
      """,
      "ALTER TABLE goods_in_inspection_items DROP CONSTRAINT goods_in_inspection_items_source_xor"
    )

    # The existing unique index goods_in_items_inspection_line_index was
    # over (goods_in_inspection_id, purchase_order_line_id). Drop it and
    # replace with two partial indexes so both sources can enforce
    # uniqueness without the NULL side breaking the constraint.
    execute(
      "DROP INDEX IF EXISTS goods_in_items_inspection_line_index",
      # No down-migration for the old plain unique — it's replaced by
      # the two partial indexes below.
      ""
    )

    create unique_index(
             :goods_in_inspection_items,
             [:goods_in_inspection_id, :purchase_order_line_id],
             where: "purchase_order_line_id IS NOT NULL",
             name: :goods_in_items_inspection_po_line_index
           )

    create unique_index(
             :goods_in_inspection_items,
             [:goods_in_inspection_id, :customer_return_line_id],
             where: "customer_return_line_id IS NOT NULL",
             name: :goods_in_items_inspection_rma_line_index
           )

    create index(:goods_in_inspection_items, [:customer_return_line_id])
  end
end
