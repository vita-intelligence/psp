defmodule Backend.Repo.Migrations.BackfillEquipmentNextDueFromTasks do
  @moduledoc """
  After the Phase A consolidation, `equipment.next_calibration_at` +
  `next_maintenance_at` are a cache derived from the active
  MaintenanceTask rows — not seed-time snapshots. This migration
  resets the cache across every equipment unit so the ledger's
  next-due columns match reality.

  Any unit without an active task ends up with both columns null;
  once an operator adds a task, the write path
  (``Backend.Equipment.MaintenanceTasks``) refreshes the cache and
  the ledger updates.

  Legacy `last_calibrated_at` / `last_maintenance_at` are refreshed
  the same way — from max(task.last_completion_date) per partition.
  """

  use Ecto.Migration

  def up do
    # Calibration cache — earliest active due date, latest done date.
    execute("""
    UPDATE equipment e
       SET next_calibration_at = agg.next_due,
           last_calibrated_at  = agg.last_done
      FROM (
        SELECT
          t.equipment_id,
          MIN(t.next_due_date) FILTER (WHERE t.is_active AND t.next_due_date IS NOT NULL) AS next_due,
          MAX(t.last_completion_date) FILTER (WHERE t.last_completion_date IS NOT NULL) AS last_done
        FROM equipment_maintenance_tasks t
        WHERE t.task_type = 'calibration'
        GROUP BY t.equipment_id
      ) agg
     WHERE agg.equipment_id = e.id
    """)

    # Everything-else cache (preventive / inspection / safety_check /
    # cleaning / other).
    execute("""
    UPDATE equipment e
       SET next_maintenance_at = agg.next_due,
           last_maintenance_at = agg.last_done
      FROM (
        SELECT
          t.equipment_id,
          MIN(t.next_due_date) FILTER (WHERE t.is_active AND t.next_due_date IS NOT NULL) AS next_due,
          MAX(t.last_completion_date) FILTER (WHERE t.last_completion_date IS NOT NULL) AS last_done
        FROM equipment_maintenance_tasks t
        WHERE t.task_type <> 'calibration'
        GROUP BY t.equipment_id
      ) agg
     WHERE agg.equipment_id = e.id
    """)

    # Wipe stale seed-time values on units with no tasks yet — those
    # were computed from acquired_at + cadence_months at seed time and
    # no longer reflect the schedule (there is no schedule until an
    # operator adds a task). Null is the honest state.
    execute("""
    UPDATE equipment
       SET next_calibration_at = NULL,
           last_calibrated_at  = NULL
     WHERE id NOT IN (
       SELECT DISTINCT equipment_id
         FROM equipment_maintenance_tasks
        WHERE task_type = 'calibration'
     )
    """)

    execute("""
    UPDATE equipment
       SET next_maintenance_at = NULL,
           last_maintenance_at = NULL
     WHERE id NOT IN (
       SELECT DISTINCT equipment_id
         FROM equipment_maintenance_tasks
        WHERE task_type <> 'calibration'
     )
    """)
  end

  def down do
    # No reverse — the seed values are unrecoverable. If you need
    # them back, re-run the seed script against an empty ledger.
    :ok
  end
end
