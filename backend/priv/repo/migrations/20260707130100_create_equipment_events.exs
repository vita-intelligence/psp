defmodule Backend.Repo.Migrations.CreateEquipmentEvents do
  use Ecto.Migration

  # Append-only lifecycle log for equipment — mirrors lot_events for
  # stock lots. Every state transition (received, in_service,
  # maintenance_started, calibrated, moved, retired, etc.) writes
  # one row here. `equipment.status` is a projection of these events;
  # never edit the projection directly.
  #
  # `evidence_file_id` carries the calibration certificate / service
  # report / retirement authorisation photo. Nullable — some
  # transitions (a note, an internal move) don't need evidence.
  def change do
    create table(:equipment_events) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :equipment_id, references(:equipment, on_delete: :restrict), null: false

      # Event vocabulary. Enforced at the changeset boundary
      # (Backend.Equipment.Event), not by a DB CHECK constraint —
      # keeps the enum extensible without migrations.
      #
      #   received              — goods-in receive (spawns unit)
      #   in_service            — put_in_service action
      #   maintenance_started   — moved to under_maintenance
      #   maintenance_completed — returned to in_service
      #   calibrated            — cal event recorded
      #   moved                 — cell change (routine relocation)
      #   assigned              — assigned to a user
      #   unassigned            — user assignment cleared
      #   retired               — end of useful life, not disposed yet
      #   disposed              — physically disposed / sold / scrapped
      #   note                  — free-form planner note
      add :kind, :string, size: 32, null: false

      add :actor_id, references(:users, on_delete: :nilify_all)
      # `actor_kind` mirrors lot_events — "user" for operator actions,
      # "system" for auto-computed events (e.g. cadence auto-flip).
      add :actor_kind, :string, size: 16, null: false, default: "user"

      # Free-text audit line. Required by the changeset for kinds
      # like retire / dispose / maintenance_started so the reason
      # is on record.
      add :reason, :text

      # Structured payload — cadence next-due dates, assigned user
      # snapshot, cell breadcrumb, etc. Same shape as lot_events.
      add :metadata, :map, default: %{}

      # Location trail — set on `moved` events + on any event that
      # implicitly changes the equipment's home (e.g. moved to a
      # maintenance cell during maintenance_started).
      add :from_cell_id, references(:storage_cells, on_delete: :nilify_all)
      add :to_cell_id, references(:storage_cells, on_delete: :nilify_all)

      # Assignment snapshot on `assigned` / `unassigned` events.
      add :assigned_to_user_id, references(:users, on_delete: :nilify_all)

      # When the event actually occurred (may be back-dated by the
      # operator on retro entries). Distinct from inserted_at
      # which is always "now".
      add :occurred_at, :utc_datetime, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:equipment_events, [:uuid])
    create index(:equipment_events, [:equipment_id, :occurred_at, :id])
    create index(:equipment_events, [:company_id, :occurred_at])
  end
end
