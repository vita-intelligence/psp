defmodule Backend.Repo.Migrations.NormaliseQuantityPrecisionTo5dp do
  @moduledoc """
  Standardise every physical-quantity column across PSP to
  ``numeric(14, 5)`` — the tenant-wide pharmaceutical-standard 5 dp
  precision (see memory ``feedback_psp_quantity_precision``).

  Why: the legacy schema mixed 4 dp (placements, shipments,
  purchase orders, goods-in) with 10 dp (bookings, MOs, BOM lines,
  reservations). The mismatch produced phantom under-booked
  residues in every release-check / shortage / coverage comparison
  the moment a fractional cascade landed on a placement — a
  0.0036209509 kg booking could never equal a 0.0036 kg placement
  even when every gram was physically in the warehouse. Rounding
  helpers now normalise to 5 dp everywhere; this migration aligns
  the storage layer to match.

  Handles existing 6+ dp values by rounding them down to 5 dp
  BEFORE the ALTER TYPE, so the narrow (10 → 5) doesn't fail on
  legacy rows the fractional-cascade fix wrote. Widening (4 → 5)
  is a pure add with no risk.

  Non-quantity ``numeric`` columns (money, ratios, volumes,
  percentages) keep their own precisions — this migration only
  targets `qty` / `quantity` fields where the pharmaceutical rule
  applies.
  """

  use Ecto.Migration

  # (table, column) pairs to normalise. Grouped by current precision
  # for the pre-round step; every one ends at ``numeric(14, 5)``.
  @columns_to_10dp [
    {"bom_lines", "qty"},
    {"co_line_lot_reservations", "quantity"},
    {"manufacturing_order_bookings", "consumed_quantity"},
    {"manufacturing_order_bookings", "quantity"},
    {"manufacturing_order_bookings", "received_qty"},
    {"manufacturing_order_steps", "quantity"},
    {"manufacturing_orders", "quantity"},
    {"manufacturing_orders", "quantity_produced"},
    {"mo_bom_overrides", "from_qty"},
    {"mo_bom_overrides", "to_qty"},
    {"shipment_pickup_events", "qty"}
  ]

  @columns_to_4dp [
    {"customer_invoice_lines", "qty"},
    {"customer_order_lines", "qty_ordered"},
    {"customer_return_lines", "qty_accepted"},
    {"customer_return_lines", "qty_returned"},
    {"goods_in_inspection_items", "qty_received"},
    {"mo_consumer_links", "shared_qty"},
    {"pricelist_items", "min_quantity"},
    {"purchase_order_lines", "qty_ordered"},
    {"purchase_order_lines", "qty_received"},
    {"shipments", "qty"},
    {"stock_lot_placements", "qty"},
    {"stock_lots", "qty_received"},
    {"stock_movements", "delta_qty"},
    {"three_pl_dispatches", "qty"},
    {"vendor_item_prices", "qty_purchased"},
    {"vendor_item_purchase_terms", "min_quantity"},
    {"warehouse_return_picks", "qty"}
  ]

  # Threshold columns that carry 3 dp today. Widen to 5 for consistency.
  @columns_to_3dp [
    {"items", "min_stock_qty"},
    {"items", "target_stock_qty"},
    {"item_finished_product_spec", "net_quantity"}
  ]

  # Kiosk piece-counts land as integers, but the column is 2 dp.
  # Widen to 5 for uniformity — no data changes, integer values
  # already round trivially.
  @columns_to_2dp [
    {"workstation_sessions", "quantity_produced"},
    {"workstation_sessions", "quantity_rejected"}
  ]

  def up do
    # 1) Pre-round existing rows that carry 6+ dp. Narrowing an
    #    ALTER TYPE on a column with values past the target scale
    #    raises ``numeric field overflow``; the round step ensures
    #    every value fits the new (14, 5) profile.
    for {table, column} <- @columns_to_10dp do
      execute("""
      UPDATE #{table}
      SET #{column} = ROUND(#{column}, 5)
      WHERE #{column} IS NOT NULL AND #{column} <> ROUND(#{column}, 5)
      """)
    end

    # 2) Alter every column to numeric(14, 5).
    all_columns =
      @columns_to_10dp ++ @columns_to_4dp ++ @columns_to_3dp ++ @columns_to_2dp

    for {table, column} <- all_columns do
      execute("""
      ALTER TABLE #{table} ALTER COLUMN #{column}
        TYPE numeric(14, 5) USING #{column}::numeric(14, 5)
      """)
    end
  end

  def down do
    # Restore each column to its original precision. Values already
    # at 5 dp fit every historical scale (2, 3, 4, 10), so no data
    # loss on rollback.
    downgrades = [
      # to 10 dp
      {@columns_to_10dp, "numeric(20, 10)"},
      # to 4 dp
      {@columns_to_4dp, "numeric(14, 4)"},
      # to 3 dp
      {@columns_to_3dp, "numeric(14, 3)"},
      # to 2 dp
      {@columns_to_2dp, "numeric(12, 2)"}
    ]

    for {cols, type} <- downgrades, {table, column} <- cols do
      execute("""
      ALTER TABLE #{table} ALTER COLUMN #{column}
        TYPE #{type} USING #{column}::#{type}
      """)
    end
  end
end
