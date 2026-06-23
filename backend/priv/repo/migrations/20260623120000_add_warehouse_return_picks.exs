defmodule Backend.Repo.Migrations.AddWarehouseReturnPicks do
  use Ecto.Migration

  # Warehouse-side return pickup — the mirror of /m/pickup, but in the
  # opposite direction. After production closeout, lots sit at
  # production-side dispatch cells. A warehouse worker walks the
  # dispatch cells, scans each lot onto their trolley, then carries
  # the load back to the warehouse and scans every target rack +
  # lot + photo to place each one.
  #
  # State machine (column-based, per row):
  #
  #   on_trolley  ← picked_at IS NOT NULL AND placed_at IS NULL
  #   placed      ← placed_at IS NOT NULL  (row archived for audit;
  #                 worker can still see history but it's no longer
  #                 active)
  #
  # One row per (lot, pickup session). A worker can only pick a lot
  # once at a time — the partial unique index on (stock_lot_id) WHERE
  # placed_at IS NULL guarantees no two workers can race to claim it.
  def change do
    create table(:warehouse_return_picks) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :delete_all),
        null: false

      add :stock_lot_id, references(:stock_lots, on_delete: :delete_all),
        null: false

      # The dispatch cell the lot was physically sitting on when the
      # warehouse worker scanned it. Captured at pickup time so the
      # audit trail records WHERE the load came from even if the cell
      # changes purpose later.
      add :picked_from_cell_id,
        references(:storage_cells, on_delete: :nilify_all),
        null: false

      add :picked_at, :utc_datetime, null: false
      add :picked_by_id, references(:users, on_delete: :nilify_all),
        null: false

      # Photo of the lot on the trolley at pickup. Mirrors the per-lot
      # photo in /m/pickup's confirm-transfer step.
      add :picked_photo_url, :string

      # Snapshot of the qty being moved — locks the value at pickup
      # time so a concurrent adjustment doesn't drift the trail. The
      # placement is single-source; this column just records
      # "warehouse worker took N from cell X."
      add :qty, :decimal, precision: 14, scale: 4, null: false

      # Set once the worker scans the destination cell at the
      # warehouse + takes the place-down photo. Until then, the lot
      # is "on the trolley" (logically still owned by this pick row).
      add :placed_at, :utc_datetime
      add :placed_by_id, references(:users, on_delete: :nilify_all)
      add :placed_to_cell_id,
        references(:storage_cells, on_delete: :nilify_all)
      add :placed_photo_url, :string

      timestamps(type: :utc_datetime)
    end

    create unique_index(:warehouse_return_picks, [:uuid])
    create index(:warehouse_return_picks, [:company_id])
    create index(:warehouse_return_picks, [:picked_by_id])
    create index(:warehouse_return_picks, [:picked_from_cell_id])

    # One open pick per lot — prevents two warehouse workers from
    # double-claiming the same lot off a dispatch cell.
    create unique_index(:warehouse_return_picks, [:stock_lot_id],
             where: "placed_at IS NULL",
             name: :warehouse_return_picks_open_lot_idx
           )

    # qty must be positive — we never record a zero-qty pick row.
    create constraint(:warehouse_return_picks, :warehouse_return_picks_qty_positive,
             check: "qty > 0"
           )

    # Placed state is all-or-nothing: either all four placed_* cols
    # are set or all four are NULL.
    create constraint(:warehouse_return_picks, :warehouse_return_picks_placed_consistency,
             check:
               "(placed_at IS NULL AND placed_by_id IS NULL AND placed_to_cell_id IS NULL) " <>
                 "OR (placed_at IS NOT NULL AND placed_by_id IS NOT NULL AND placed_to_cell_id IS NOT NULL)"
           )
  end
end
