defmodule Backend.Repo.Migrations.CreateMoBookings do
  use Ecto.Migration

  @moduledoc """
  Per-MO stock reservations. A booking row reserves `quantity` of a
  specific `stock_lot` against a manufacturing order so the same
  units can't be sold or booked by another MO. Lots stay physically
  where they are — bookings are a logical hold.

  Lot availability for a fresh booking is computed live as:
  `sum(placements.qty) - sum(active bookings)`. No counter column on
  the lot row, so concurrent bookings don't race on a single hot
  field.

  `status`:
    - `requested`   — booking is alive and holding stock
    - `consumed`    — execution layer rolled this into the MO output
    - `cancelled`   — operator released back to the lot

  `consumed_quantity` lets a single booking get partially consumed
  without flipping the whole row; the remainder stays held. Defaults
  to 0 on insert.
  """

  def change do
    create table(:manufacturing_order_bookings) do
      add :uuid, :uuid, null: false

      add :quantity, :decimal, precision: 14, scale: 4, null: false
      add :consumed_quantity, :decimal, precision: 14, scale: 4, default: 0, null: false

      add :status, :string, null: false, default: "requested"

      # Single-line operator note on the reservation itself. Longer
      # discussion lives in the polymorphic Comments table when we
      # need it.
      add :note, :string, size: 500

      add :company_id, references(:companies, on_delete: :restrict), null: false

      add :manufacturing_order_id,
          references(:manufacturing_orders, on_delete: :delete_all),
          null: false

      # Denormalised: BOM lines hold (item, qty) so booking against
      # a specific item is the natural grain. Cascade-delete is
      # deliberately *not* enabled — removing an item shouldn't wipe
      # historical bookings.
      add :item_id, references(:items, on_delete: :restrict), null: false

      # The reserved lot. Restrict on delete so we can't orphan a
      # booking by hard-deleting its lot — releases happen via the
      # context, never via cascade.
      add :stock_lot_id, references(:stock_lots, on_delete: :restrict), null: false

      # Cell snapshot at booking time — operator needs to know where
      # the held qty physically sits. nilify if the cell gets deleted
      # before the booking is released.
      add :storage_cell_id, references(:storage_cells, on_delete: :nilify_all)

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:manufacturing_order_bookings, [:uuid])
    create index(:manufacturing_order_bookings, [:manufacturing_order_id])
    create index(:manufacturing_order_bookings, [:item_id])
    create index(:manufacturing_order_bookings, [:stock_lot_id])

    # Hot path: "what's actively booked against lot X?" runs on every
    # availability query.
    create index(:manufacturing_order_bookings, [:stock_lot_id, :status],
             where: "status = 'requested'",
             name: :mo_bookings_active_by_lot_index
           )

    create constraint(:manufacturing_order_bookings, :mo_bookings_quantity_positive,
             check: "quantity > 0"
           )

    create constraint(:manufacturing_order_bookings, :mo_bookings_consumed_non_negative,
             check: "consumed_quantity >= 0"
           )

    create constraint(:manufacturing_order_bookings, :mo_bookings_consumed_le_qty,
             check: "consumed_quantity <= quantity"
           )

    create constraint(:manufacturing_order_bookings, :mo_bookings_status_known,
             check: "status IN ('requested', 'consumed', 'cancelled')"
           )
  end
end
