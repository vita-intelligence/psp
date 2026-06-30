defmodule Backend.Repo.Migrations.ResyncBookingCellsToLotPlacements do
  use Ecto.Migration

  @moduledoc """
  Repoint every open MO booking's `storage_cell_id` at its lot's
  current primary_pl placement.

  Why: `storage_cell_id` was originally a snapshot of where the lot
  sat at the moment the booking was created. Once the auto-router
  parked a freshly-received lot in the quarantine cage and the
  goods-in operator later moved it onto a regular shelf, the booking
  kept pointing at the cage. Pickers walking the queue were told to
  fetch from quarantine — a compliance hole, because only the
  Goods-In QC sign-off (or an expedited release) is allowed to take
  a lot out of the quarantine purpose, and that workflow is supposed
  to handle the move, not a stale booking pointer.

  Forward-going, `Backend.Stock.move_lot` + `adjust_placement` call
  `Backend.Production.refresh_open_bookings_for_lot/1` to keep this
  in sync at write time. This migration cleans up the snapshots
  created before that hook existed.

  Primary placement rule (mirrors the runtime helper):
    1. Regular cells beat system-purpose cells (quarantine / hold /
       dispatch / production_feed / rejected). Pickers should never
       be sent to a non-pickable cell when a regular alternative
       exists.
    2. Within a tone, the placement with the most qty wins.
    3. Ties broken by ascending placement id (stable).

  Only touches bookings with `status = 'requested'` AND
  `picked_at IS NULL` — once the picker has the lot on the trolley,
  the cell is locked to where they actually fetched from.

  One-way data migration.
  """

  def up do
    execute """
    UPDATE manufacturing_order_bookings AS b
    SET storage_cell_id = primary_pl.cell_id,
        updated_at = NOW()
    FROM (
      SELECT DISTINCT ON (p.stock_lot_id)
        p.stock_lot_id AS lot_id,
        p.storage_cell_id AS cell_id
      FROM stock_lot_placements p
      JOIN storage_cells sc ON sc.id = p.storage_cell_id
      WHERE p.qty > 0
      ORDER BY
        p.stock_lot_id,
        CASE WHEN sc.purpose = 'regular' THEN 0 ELSE 1 END,
        p.qty DESC,
        p.id
    ) AS primary_pl
    WHERE b.stock_lot_id = primary_pl.lot_id
      AND b.status = 'requested'
      AND b.picked_at IS NULL
      AND b.storage_cell_id IS DISTINCT FROM primary_pl.cell_id;
    """
  end

  def down do
    :ok
  end
end
