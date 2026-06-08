defmodule Backend.Repo.Migrations.CreateStockLotPlacements do
  use Ecto.Migration

  @moduledoc """
  Where a lot physically sits. One placement row per cell — a lot
  can be split across multiple shelves with different on-hand
  quantities, and qty_on_hand for the lot is `sum(placements.qty)`.

  Placements are mutable (qty drops on consume, rises on receive);
  the immutable audit lives in stock_movements.
  """

  def change do
    create table(:stock_lot_placements) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies), null: false
      add :stock_lot_id, references(:stock_lots, on_delete: :delete_all),
        null: false
      add :storage_cell_id, references(:storage_cells, on_delete: :restrict),
        null: false

      # Current on-hand at this cell. Non-negative — the context
      # rejects movements that would push it below zero.
      add :qty, :decimal, precision: 14, scale: 4, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create unique_index(:stock_lot_placements, [:uuid])
    # One row per (lot, cell) — multiple placements of the same lot
    # in the same cell collapse into one. Movements update the qty
    # rather than appending a new placement row.
    create unique_index(:stock_lot_placements, [:stock_lot_id, :storage_cell_id],
             name: :stock_lot_placements_lot_cell_index
           )
    create index(:stock_lot_placements, [:storage_cell_id])
    create index(:stock_lot_placements, [:company_id])
  end
end
