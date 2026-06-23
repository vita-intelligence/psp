defmodule Backend.Repo.Migrations.AddBookingPurchaseOrderLineId do
  use Ecto.Migration

  # Placeholder bookings — reservations against an in-flight PO line
  # for which no stock_lot exists yet (goods haven't landed). The
  # XOR constraint guarantees a booking either points at a real lot
  # (today's normal case) or at a PO line awaiting receipt — never
  # both, never neither. On `qc_passed` of the lot produced by the
  # PO receipt, the placeholder upgrades: `stock_lot_id` set,
  # `purchase_order_line_id` nulled.
  def change do
    alter table(:manufacturing_order_bookings) do
      add :purchase_order_line_id,
        references(:purchase_order_lines, on_delete: :delete_all),
        null: true
    end

    create index(:manufacturing_order_bookings, [:purchase_order_line_id])

    # Drop the not-null on stock_lot_id since placeholders won't have
    # it. The XOR check below replaces the implicit "must be present"
    # invariant.
    execute(
      "ALTER TABLE manufacturing_order_bookings ALTER COLUMN stock_lot_id DROP NOT NULL",
      "ALTER TABLE manufacturing_order_bookings ALTER COLUMN stock_lot_id SET NOT NULL"
    )

    # XOR: exactly one of stock_lot_id / purchase_order_line_id is set.
    create constraint(
             :manufacturing_order_bookings,
             :mo_bookings_lot_xor_po_line,
             check:
               "(stock_lot_id IS NOT NULL AND purchase_order_line_id IS NULL) " <>
                 "OR (stock_lot_id IS NULL AND purchase_order_line_id IS NOT NULL)"
           )
  end
end
