defmodule Backend.Repo.Migrations.DropBookingConsumedLeQty do
  use Ecto.Migration

  @moduledoc """
  Closeout now treats `consumed_quantity` as the ACTUAL post-run
  consumption (= lot.qty_on_hand_before − operator-typed remaining), not
  a cap of the booking's planned quantity. Spillage / recipe overage is
  real — the floor will sometimes draw more than the booking reserved —
  so the CHECK that pinned consumed ≤ booked now blocks honest data.
  Dropping the constraint; auditability is preserved via the per-move
  Stock.Movement rows that the closeout flow emits.
  """

  def up do
    execute "ALTER TABLE manufacturing_order_bookings DROP CONSTRAINT IF EXISTS mo_bookings_consumed_le_qty"
  end

  def down do
    execute """
    ALTER TABLE manufacturing_order_bookings
    ADD CONSTRAINT mo_bookings_consumed_le_qty
    CHECK (consumed_quantity IS NULL OR consumed_quantity <= quantity)
    """
  end
end
