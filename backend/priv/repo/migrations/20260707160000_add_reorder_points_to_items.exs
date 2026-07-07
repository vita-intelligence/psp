defmodule Backend.Repo.Migrations.AddReorderPointsToItems do
  use Ecto.Migration

  # Reorder-point pair: `min_stock_qty` triggers the alert, `target_stock_qty`
  # is the order-up-to level. Both nullable — an item that leaves them
  # NULL simply doesn't participate in the reorder game. Applies only
  # to item_types that are bought (consumable / raw_material /
  # packaging); the changeset guards against setting them on
  # finished_product / semi_finished / equipment.
  #
  # `numeric(14,3)` matches the existing qty scale on `stock_lots`.
  def change do
    alter table(:items) do
      add :min_stock_qty, :decimal, precision: 14, scale: 3
      add :target_stock_qty, :decimal, precision: 14, scale: 3
    end

    # Partial index for the "which items participate in reorder
    # tracking" scan — the coverage sweep in
    # `Backend.Procurement.reorder_status/1` filters on this.
    create index(:items, [:company_id],
             where: "min_stock_qty IS NOT NULL",
             name: :items_with_reorder_index
           )
  end
end
