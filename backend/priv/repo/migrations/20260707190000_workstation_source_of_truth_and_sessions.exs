defmodule Backend.Repo.Migrations.WorkstationSourceOfTruthAndSessions do
  use Ecto.Migration

  # Two changes bundled — they always ship together because the
  # WorkstationSession pushback endpoint checks the flag on the
  # target workstation before accepting the write:
  #
  #   1. `workstations.psp_source_of_truth` — feature flag from
  #      phase 6 of docs/PSP_INTEGRATION_PROPOSAL.md. When true,
  #      the vita-performance kiosk mirrors this workstation and
  #      routes its sessions here instead of the legacy local
  #      Item picker.
  #
  #   2. `workstation_sessions` — Backend.Production.WorkstationSession,
  #      the destination for kiosk-generated session events.
  #      Supports both MO-attached and non-MO sessions
  #      (cleaning / maintenance / other) via `activity_kind`.
  def change do
    alter table(:workstations) do
      add :psp_source_of_truth, :boolean, null: false, default: false
    end

    create table(:workstation_sessions) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :workstation_id, references(:workstations, on_delete: :restrict), null: false

      # Nullable when activity_kind != :mo (cleaning / maintenance / other).
      add :manufacturing_order_step_id,
          references(:manufacturing_order_steps, on_delete: :restrict)

      # External correlation — the vita-performance WorkSession uuid
      # that spawned this row. Unique per company for idempotent
      # writeback (the outbox retries the same payload on transient
      # failures).
      add :external_id, :string, size: 64

      add :activity_kind, :string, size: 16, null: false, default: "mo"
      add :activity_label, :string, size: 200

      # Array of Employee uuids present on the session. Kept as a
      # simple array rather than a join table because sessions are
      # append-only leaf events — resolving employee_id lookups on
      # the way in is enough.
      add :employee_uuids, {:array, :binary_id}, null: false, default: []

      add :started_at, :utc_datetime, null: false
      add :finished_at, :utc_datetime

      add :quantity_produced, :decimal, precision: 12, scale: 2
      add :quantity_rejected, :decimal, precision: 12, scale: 2
      add :performance_percentage, :float

      # Free-form operator notes + a JSONB bag for the DynamicForm
      # answers vita-performance forwards alongside the session.
      add :notes, :string
      add :form_responses, :map, null: false, default: %{}

      # Status projection: :active → :completed → :verified.
      add :status, :string, size: 16, null: false, default: "completed"

      timestamps(type: :utc_datetime)
    end

    create unique_index(:workstation_sessions, [:uuid])
    create unique_index(:workstation_sessions, [:company_id, :external_id],
             where: "external_id IS NOT NULL",
             name: :workstation_sessions_company_external_index
           )
    create index(:workstation_sessions, [:workstation_id, :started_at])
    create index(:workstation_sessions, [:manufacturing_order_step_id])
    create index(:workstation_sessions, [:company_id, :activity_kind])
  end
end
