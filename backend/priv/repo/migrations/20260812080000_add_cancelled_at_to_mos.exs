defmodule Backend.Repo.Migrations.AddCancelledAtToMos do
  use Ecto.Migration

  # First-class "when + who" for MO cancellation. Before this,
  # ``status = "cancelled"`` was the only signal — no timestamp,
  # no actor — so the CO timeline had nothing to render for a
  # cancellation and a cancelled MO looked identical to a drafted
  # one on the project control board.
  #
  # Nullable so historic cancelled MOs stay valid; the timeline
  # just doesn't get a cancel row for them (no worse than the
  # pre-fix state).
  def change do
    alter table(:manufacturing_orders) do
      add :cancelled_at, :utc_datetime, null: true
      add :cancelled_by_id, references(:users, on_delete: :nilify_all), null: true
    end

    create index(:manufacturing_orders, [:cancelled_by_id],
             where: "cancelled_by_id IS NOT NULL",
             name: :manufacturing_orders_cancelled_by_id_idx
           )
  end
end
