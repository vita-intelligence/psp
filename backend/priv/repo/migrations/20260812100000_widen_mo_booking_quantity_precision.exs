defmodule Backend.Repo.Migrations.WidenMoBookingQuantityPrecision do
  use Ecto.Migration

  # Booking qty was ``numeric(14,4)`` — 4 decimals. Fine for kg-scale
  # bulk lines but the earlier BOM-precision widening
  # (``bom_lines.qty`` → ``numeric(20,10)``) lets trace ingredients
  # live at 10 decimals. When those trace BOMs cascaded into a
  # booking, the qty (e.g. ``0.00002 kg`` for a 20 mg active on a
  # 1-unit sample MO) truncated to ``0.0000`` at insert and tripped
  # the ``mo_bookings_quantity_positive`` CHECK ("quantity > 0").
  #
  # Symptom: wizard "Create MO for line" on a sample CO succeeded at
  # MO create, then died mid-booking with "something went wrong" —
  # the first sub-mg BOM line failed insert, aborted the tx, every
  # subsequent allocator query got PG 25P02.
  #
  # Widening to ``numeric(20,10)`` matches ``bom_lines.qty`` so any
  # BOM qty round-trips through booking without truncation.
  # ``consumed_quantity`` widened for symmetry (operator-picked qty
  # can partial-consume tiny bookings too).
  def change do
    alter table(:manufacturing_order_bookings) do
      modify :quantity, :decimal,
        precision: 20,
        scale: 10,
        from: {:decimal, precision: 14, scale: 4}

      modify :consumed_quantity, :decimal,
        precision: 20,
        scale: 10,
        from: {:decimal, precision: 14, scale: 4}
    end
  end
end
