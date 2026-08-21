defmodule Backend.Repo.Migrations.WidenMoQtyPrecision do
  use Ecto.Migration

  # ``manufacturing_orders.quantity`` was ``numeric(14,4)`` — 4
  # decimals. ``bom_lines.qty`` was widened to ``numeric(20,10)`` in
  # ``WidenBomLineQtyPrecision`` so trace ingredients don't get
  # silently truncated. But every downstream multiplication
  # (parts-view required = bom_line.qty × mo.quantity) collapsed
  # back to 4 decimals when it hit the MO / booking / step tables,
  # producing phantom shortages: a 1080-cap encaps MO with a 0.000453
  # kg/cap blend line computes required = 0.48924 kg, but the child
  # MO spawned to fulfil it stored ``quantity`` at 4 decimals →
  # 0.4892 → the parent's parts view shows "required 0.48924 booked
  # 0.4892" with 0.00004 kg "still needed" that no operator can
  # actually fulfil (Postgres would truncate any 5-decimal booking
  # back to 4).
  #
  # Widening to ``numeric(20,10)`` gives:
  #
  #   * 10 decimals — 0.01 mg precision when stored in kg. Well
  #     inside the 10 mg / 0.01 g precision of R&D-scale lab
  #     balances; matches the ``bom_lines`` widen already in place.
  #   * 10 integer digits — up to 10 billion of the source unit,
  #     covers every bulk MO the system ever handles (multi-kg oil
  #     tanks, 500 kg powder blends, etc).
  #
  # Widening is a compatible ``ALTER TYPE`` on Postgres 12+ —
  # existing numeric(14,4) values fit exactly in numeric(20,10) with
  # no data loss and no need to rewrite the table.
  #
  # Companion FE change: display these fields at fixed 5 decimals
  # for mass / volume (with trailing zeros, pharma-audit convention:
  # ``5.00000`` communicates "recorded to 10 mg precision", not
  # "exactly 5"). Count-dimension items keep whole-integer display.
  def change do
    alter table(:manufacturing_orders) do
      modify :quantity, :decimal,
        precision: 20,
        scale: 10,
        from: {:decimal, precision: 14, scale: 4}

      modify :quantity_produced, :decimal,
        precision: 20,
        scale: 10,
        from: {:decimal, precision: 18, scale: 4}
    end

    alter table(:manufacturing_order_bookings) do
      modify :quantity, :decimal,
        precision: 20,
        scale: 10,
        from: {:decimal, precision: 14, scale: 4}

      modify :consumed_quantity, :decimal,
        precision: 20,
        scale: 10,
        from: {:decimal, precision: 14, scale: 4}

      modify :received_qty, :decimal,
        precision: 20,
        scale: 10,
        from: {:decimal, precision: 18, scale: 4}
    end

    alter table(:manufacturing_order_steps) do
      modify :quantity, :decimal,
        precision: 20,
        scale: 10,
        from: {:decimal, precision: 14, scale: 4}
    end
  end
end
