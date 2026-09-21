defmodule Backend.Repo.Migrations.CreateWorkstationEvents do
  @moduledoc """
  Append-only audit log per workstation for cleaning + maintenance
  activity. Mirrors ``equipment_events`` — same event-sourcing shape,
  same actor + metadata columns — so the two audit trails can be
  queried with matching primitives from the FE.

  Why not just ``equipment_events`` for both? Because a workstation
  isn't a piece of equipment. Cleaning "Blending #1" ("wiped down
  the cell") is auditor-distinct from cleaning the V-blender on it
  ("CIP'd the machine"), and BRCGS / FSSC 22000 auditors ask about
  each level independently. The two-table split makes that
  distinction visible in the schema instead of hiding it behind a
  polymorphic FK.

  Cadence scalars (``last_cleaning_at`` / ``next_cleaning_due_at`` +
  the new ``last_maintenance_at`` / ``next_maintenance_due_at``)
  live on the ``workstations`` row itself — this table is the full
  history, that's the memo.
  """

  use Ecto.Migration

  def change do
    create table(:workstation_events) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :restrict), null: false

      add :workstation_id,
          references(:workstations, on_delete: :restrict),
          null: false

      # Event vocabulary — enforced at the changeset boundary, not
      # by DB CHECK. Keeps the enum extensible without a migration.
      #
      #   cleaning_completed    — kiosk cleaning session ended
      #   maintenance_completed — kiosk maintenance session ended
      #   cleaning_started      — reserved for future in-flight tracking
      #   maintenance_started   — reserved for future in-flight tracking
      #   note                  — free-form audit note
      add :kind, :string, size: 32, null: false

      # vita-perf shift + session identifiers so audit rows link
      # back to the WorkSession that produced them. Nullable so a
      # manually-authored note (from PSP itself) doesn't require a
      # vp round-trip.
      add :vp_session_id, :integer
      add :vp_shift_id, :integer

      # Worker snapshot at time of event. PSP mirrors employees via
      # ``external_id`` so we store that here (uuid across services);
      # the display name is denormalised so the audit row still
      # renders if the worker is later archived.
      add :worker_external_id, :string, size: 128
      add :worker_name, :string, size: 200

      # Optional link to the DynamicForm response the operator filled
      # in when they closed the session. Nullable — some forms are
      # skippable and manual notes never have one.
      add :form_response_uuid, :uuid

      # Actor. ``actor_kind`` mirrors equipment_events — "user" for
      # operator actions (fills in ``actor_id``), "system" for
      # auto-computed events (e.g. reconciler backfill from vp).
      add :actor_id, references(:users, on_delete: :nilify_all)
      add :actor_kind, :string, size: 16, null: false, default: "user"

      # Session envelope — copied from the vp callback so the audit
      # row is self-contained. Duration is denormalised to save the
      # FE from arithmetic on every row render.
      add :started_at, :utc_datetime, null: false
      add :ended_at, :utc_datetime
      add :duration_seconds, :integer

      # Free-text audit line + structured payload — matches the
      # equipment_events pattern so the FE can render a unified
      # audit row component across both tables.
      add :reason, :text
      add :metadata, :map, default: %{}

      timestamps(type: :utc_datetime)
    end

    create unique_index(:workstation_events, [:uuid])
    create index(:workstation_events, [:workstation_id, :started_at, :id])
    create index(:workstation_events, [:company_id, :started_at])
    create index(:workstation_events, [:workstation_id, :kind, :started_at])
  end
end
