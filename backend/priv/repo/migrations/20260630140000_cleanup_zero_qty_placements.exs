defmodule Backend.Repo.Migrations.CleanupZeroQtyPlacements do
  use Ecto.Migration

  @moduledoc """
  Delete `stock_lot_placements` rows whose qty has been decremented
  to zero. Before this migration, `Backend.Stock.decrement_placement/2`
  always UPDATEd the qty column instead of deleting the row when it
  hit zero, leaving "ghost" placements that pinned lots to cells they
  no longer physically occupied.

  Concrete symptom: lots that auto-routed into the quarantine cage on
  receipt and were later moved out to regular cells still showed up
  in the cage's contents list because the qty=0 placement row
  survived the move.

  This is a one-way data migration — there's no semantic value in
  re-creating ghost rows on rollback.
  """

  def up do
    execute "DELETE FROM stock_lot_placements WHERE qty = 0;"
  end

  def down do
    :ok
  end
end
