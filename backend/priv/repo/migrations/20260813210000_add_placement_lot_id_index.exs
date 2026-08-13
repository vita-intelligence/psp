defmodule Backend.Repo.Migrations.AddPlacementLotIdIndex do
  use Ecto.Migration

  # Postgres does NOT auto-create indexes on foreign keys — only on
  # PRIMARY KEY and UNIQUE constraints. ``stock_lot_placements`` has
  # a unique index on ``(stock_lot_id, storage_cell_id)`` (from the
  # original create migration) which Postgres CAN use as a prefix
  # for lookups on ``stock_lot_id`` alone. BUT: the filter
  # ``WHERE qty > 0`` (the hot filter on every "where is this lot?"
  # query) forces a bitmap re-check that scans the unique index +
  # the heap.
  #
  # A partial index on ``stock_lot_id WHERE qty > 0`` answers the
  # question in a single index-only scan — every operator opening a
  # lot detail page, every auto-router lookup, every
  # ``list_pending_putaway`` call.
  #
  # ``concurrently: true`` + ``@disable_ddl_transaction true`` avoids
  # blocking writes on the placements table during the migration —
  # a busy warehouse never sees a stall.
  @disable_ddl_transaction true
  @disable_migration_lock true

  def change do
    create_if_not_exists index(
                           :stock_lot_placements,
                           [:stock_lot_id],
                           where: "qty > 0",
                           name: :stock_lot_placements_active_by_lot_idx,
                           concurrently: true
                         )
  end
end
