defmodule Backend.Repo.Migrations.AddBookingPreflightFields do
  use Ecto.Migration

  # Pre-production receipt check. After the warehouse picker has
  # transferred a lot to the production_feed cell, the PRODUCTION
  # operator (different role from the picker) confirms each booking:
  # weighs / counts the actual qty, records any quality remarks, and
  # signs off. Production can't start (`status="in_progress"`) until
  # every raw_material/packaging booking on the MO carries
  # `received_at IS NOT NULL`.
  #
  # `received_qty` is whatever the operator actually measured —
  # almost always equal to `quantity`, but stored separately so a
  # 100g weighing variance on a 50kg booking is queryable later. No
  # ledger entry yet — that lands on consumption.
  def change do
    alter table(:manufacturing_order_bookings) do
      add :received_at, :utc_datetime
      add :received_by_id, references(:users, on_delete: :nilify_all)
      add :received_qty, :decimal, precision: 18, scale: 4
      add :received_notes, :text
    end

    create index(:manufacturing_order_bookings, [:received_at])
  end
end
