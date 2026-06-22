defmodule Backend.Repo.Migrations.AddPostProductionReturnFields do
  use Ecto.Migration

  # Post-production return — the mobile flow that closes out an MO.
  # Per-booking: how much was actually consumed + when + by whom.
  # Anything left over moves to a scanned destination cell (recorded
  # via the existing Stock.Movement + Placement tables, no new column
  # needed for that). Photos travel via stock_movement_photos as the
  # rest of the move flows do.
  #
  # `consumed_at IS NOT NULL` AND `consumed_quantity` set = booking is
  # closed for this MO. The mobile queue projects state from those
  # two columns + the parent MO's status=completed.
  def change do
    alter table(:manufacturing_order_bookings) do
      add :consumed_at, :utc_datetime
      add :consumed_by_id, references(:users, on_delete: :nilify_all)
    end

    create index(:manufacturing_order_bookings, [:consumed_at])
  end
end
