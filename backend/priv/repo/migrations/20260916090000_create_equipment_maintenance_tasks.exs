defmodule Backend.Repo.Migrations.CreateEquipmentMaintenanceTasks do
  @moduledoc """
  Per-equipment preventive-maintenance / calibration task schedule.

  The existing `equipment.next_maintenance_at` + `next_calibration_at`
  scalars only carry ONE date each — fine for a lonely drill but
  useless for a real asset that has several PM tasks running at
  different cadences (daily clean, weekly inspection, quarterly
  calibration, yearly PAT-test). Each row here is one such task with
  its own periodicity + due-date + assignee.

  Completion is not a status flip — it's an event: on complete we
  bump `last_completion_date`, recompute `next_due_date` from the
  periodicity, and drop an `equipment_events` row so the timeline
  keeps the full history.
  """

  use Ecto.Migration

  def change do
    create table(:equipment_maintenance_tasks) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :equipment_id, references(:equipment, on_delete: :delete_all), null: false

      # Free-text task label — "Blade replacement", "Torque calibration",
      # "PAT test". Not enum'd because facility-specific vocabulary
      # matters more than a fixed taxonomy.
      add :task_name, :string, size: 200, null: false
      # Preventive vs calibration split — drives colour + icon in the UI
      # and lets Compliance filter by "just calibrations, please".
      add :task_type, :string, size: 32, null: false, default: "preventive"

      # Cadence enum matches ERPNext's list — Daily / Weekly / Monthly /
      # Quarterly / Half-yearly / Yearly / 2 Yearly / 3 Yearly. Nullable
      # for one-off tasks (single service visit, not recurring).
      add :periodicity, :string, size: 32
      add :periodicity_interval, :integer

      # Assignee — the person responsible for getting it done. Not a
      # gate on completion (any user with the permission can log a
      # completion), but drives the "my tasks" queue.
      add :assigned_to_user_id, references(:users, on_delete: :nilify_all)

      # When the task first became active + when it ends (nil = open-
      # ended). Both optional so a bare "recurring every Monday" needs
      # only the periodicity.
      add :start_date, :date
      add :end_date, :date

      # Cadence bookkeeping. `next_due_date` is derived from
      # `last_completion_date + periodicity`; we cache it so the
      # due-soon query stays a plain index scan instead of a
      # per-row computation.
      add :last_completion_date, :date
      add :next_due_date, :date

      # BRCGS / FSSC-flavoured extras — some tasks demand paper proof
      # (a calibration certificate PDF stapled to the record). When
      # `certificate_required` is true, the mobile "complete" flow
      # gates on a file upload.
      add :certificate_required, :boolean, null: false, default: false

      add :notes, :text
      add :is_active, :boolean, null: false, default: true

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)
      timestamps(type: :utc_datetime)
    end

    create index(:equipment_maintenance_tasks, [:equipment_id])
    create index(:equipment_maintenance_tasks, [:company_id])
    create index(:equipment_maintenance_tasks, [:next_due_date])
    create index(:equipment_maintenance_tasks, [:assigned_to_user_id])
    create unique_index(:equipment_maintenance_tasks, [:uuid])
  end
end
