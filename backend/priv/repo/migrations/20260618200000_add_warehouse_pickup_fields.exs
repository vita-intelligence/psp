defmodule Backend.Repo.Migrations.AddWarehousePickupFields do
  use Ecto.Migration

  # Warehouse pickup workflow — the gate between "MO is scheduled"
  # and "operator on the floor starts production". Planner explicitly
  # releases the MO to the warehouse; picker (head-of-picker lock)
  # walks the bookings, scans each lot + cell, then transfers the
  # whole load to a production_feed cell with per-lot photo evidence.
  #
  # All state is column-based — no new status enum. Picker queries
  # project state from these timestamps:
  #
  #   ready-to-pick   ← released_to_warehouse_at IS NOT NULL
  #                     AND now() >= max(released_at, planned_start - window)
  #                     AND pickup_started_at IS NULL
  #   in-progress     ← pickup_started_at IS NOT NULL AND completed_at IS NULL
  #   handed-off      ← pickup_completed_at IS NOT NULL
  #
  # Booking-level pickup:
  #   pending         ← picked_at IS NULL
  #   on-trolley      ← picked_at IS NOT NULL AND mo.pickup_completed_at IS NULL
  #   transferred     ← mo.pickup_completed_at IS NOT NULL
  def change do
    alter table(:manufacturing_orders) do
      add :released_to_warehouse_at, :utc_datetime
      add :released_to_warehouse_by_id, references(:users, on_delete: :nilify_all)

      # Per-MO override. NULL → falls back to company.default_pickup_window_hours
      # at query time. Lets a planner give a fresh-produce batch a tighter
      # window or a frozen-goods batch a longer one without touching the
      # company default.
      add :pickup_window_hours, :integer

      add :pickup_started_at, :utc_datetime
      add :pickup_started_by_id, references(:users, on_delete: :nilify_all)

      add :pickup_completed_at, :utc_datetime
      add :pickup_completed_by_id, references(:users, on_delete: :nilify_all)

      # Production-side cell the load was transferred to. Picker scans
      # this cell at confirm-transfer time; one move movement per
      # booked lot lands here.
      add :production_cell_id, references(:storage_cells, on_delete: :nilify_all)
    end

    # Per-booking pickup stamp. picked_at IS NOT NULL means the lot is
    # physically on the picker's trolley (logically still at its
    # original cell — no movement emitted until confirm-transfer).
    alter table(:manufacturing_order_bookings) do
      add :picked_at, :utc_datetime
      add :picked_by_id, references(:users, on_delete: :nilify_all)
    end

    # Company-wide default for the pickup visibility window. Operators
    # configure on /settings/company; per-MO override on the Release
    # confirm modal.
    alter table(:companies) do
      add :default_pickup_window_hours, :integer, default: 24, null: false
    end

    create index(:manufacturing_orders, [:released_to_warehouse_at])
    create index(:manufacturing_orders, [:pickup_started_at])
    create index(:manufacturing_orders, [:pickup_completed_at])
    create index(:manufacturing_order_bookings, [:picked_at])

    # Pickup window must be positive when set; NULL is fine (falls back
    # to company default).
    create constraint(:manufacturing_orders, :mo_pickup_window_positive,
             check: "pickup_window_hours IS NULL OR pickup_window_hours > 0"
           )

    create constraint(:companies, :companies_default_pickup_window_positive,
             check: "default_pickup_window_hours > 0"
           )
  end
end
