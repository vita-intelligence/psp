defmodule Backend.Repo.Migrations.SeparateMoFromScheduling do
  use Ecto.Migration

  @moduledoc """
  Split planning (the MO) from scheduling (the calendar).

  Before: MO carried `start_at` / `finish_at` and steps inherited
  derived times. Approving an MO implicitly meant "we've decided
  when to run it" — but that's a scheduling decision, not an
  approval decision.

  After:
    * MO has no `start_at` / `finish_at`. Timing lives on steps.
    * Each step gains `planned_duration_seconds` so that
      unscheduling clears the calendar position without losing
      how long the step takes.
    * New status `scheduled` sits between `approved` and
      `in_progress`. It's a projection: an approved MO whose
      every step has a `planned_start` is `scheduled`; clearing
      step times sends it back to `approved`.

  Forward-data migration:
    1. Add the new column.
    2. Backfill `planned_duration_seconds` from existing step
       `planned_finish - planned_start` where both are set.
    3. Flip every approved MO whose steps all have `planned_start`
       to `scheduled` so the existing demo data shows up on the
       calendar as already-placed.
    4. Drop the MO timing columns + the finish-after-start check.
  """

  def up do
    # 1. Step gains an explicit duration. utc_datetime + datediff in
    #    Postgres returns seconds, which fits an integer comfortably
    #    for any reasonable production step.
    alter table(:manufacturing_order_steps) do
      add :planned_duration_seconds, :integer
    end

    flush()

    # 2. Backfill from current planned times. Steps without a
    #    planned_start get zero duration so the column is non-null
    #    after we fix it up. Use FLOOR to drop sub-second precision.
    execute("""
    UPDATE manufacturing_order_steps
    SET planned_duration_seconds = COALESCE(
      FLOOR(EXTRACT(EPOCH FROM (planned_finish - planned_start)))::integer,
      0
    )
    """)

    # Tighten the column now that it's populated.
    alter table(:manufacturing_order_steps) do
      modify :planned_duration_seconds, :integer, null: false, default: 0
    end

    # 3. Update status constraint first (so the next UPDATE can
    #    write 'scheduled' without violating it).
    drop constraint(:manufacturing_orders, :manufacturing_orders_status_known)

    create constraint(:manufacturing_orders, :manufacturing_orders_status_known,
             check:
               "status IN ('draft', 'prepared', 'approved', 'scheduled', 'in_progress', 'completed', 'cancelled')"
           )

    # Auto-promote currently-approved MOs whose steps are all timed
    # to 'scheduled'. NULL step counts as "not scheduled".
    execute("""
    UPDATE manufacturing_orders mo
    SET status = 'scheduled'
    WHERE mo.status = 'approved'
      AND EXISTS (
        SELECT 1 FROM manufacturing_order_steps s WHERE s.manufacturing_order_id = mo.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM manufacturing_order_steps s
        WHERE s.manufacturing_order_id = mo.id
          AND s.planned_start IS NULL
      )
    """)

    # 4. MO no longer owns timing. Drop the check first or
    #    Postgres will reject the column removal.
    drop constraint(:manufacturing_orders, :manufacturing_orders_finish_after_start)

    alter table(:manufacturing_orders) do
      remove :start_at
      remove :finish_at
    end
  end

  def down do
    alter table(:manufacturing_orders) do
      add :start_at, :utc_datetime
      add :finish_at, :utc_datetime
    end

    flush()

    # Best-effort backfill from step bounds so the columns aren't
    # all-null after rollback.
    execute("""
    UPDATE manufacturing_orders mo
    SET start_at = sub.min_start,
        finish_at = sub.max_finish
    FROM (
      SELECT manufacturing_order_id,
             MIN(planned_start) AS min_start,
             MAX(planned_finish) AS max_finish
        FROM manufacturing_order_steps
       WHERE planned_start IS NOT NULL
         AND planned_finish IS NOT NULL
       GROUP BY manufacturing_order_id
    ) sub
    WHERE mo.id = sub.manufacturing_order_id
    """)

    # Pull anything still null forward to inserted_at so the
    # NOT NULL constraint below holds.
    execute("UPDATE manufacturing_orders SET start_at = inserted_at WHERE start_at IS NULL")
    execute("UPDATE manufacturing_orders SET finish_at = inserted_at WHERE finish_at IS NULL")

    alter table(:manufacturing_orders) do
      modify :start_at, :utc_datetime, null: false
      modify :finish_at, :utc_datetime, null: false
    end

    create constraint(:manufacturing_orders, :manufacturing_orders_finish_after_start,
             check: "finish_at >= start_at"
           )

    execute("UPDATE manufacturing_orders SET status = 'approved' WHERE status = 'scheduled'")

    drop constraint(:manufacturing_orders, :manufacturing_orders_status_known)

    create constraint(:manufacturing_orders, :manufacturing_orders_status_known,
             check:
               "status IN ('draft', 'prepared', 'approved', 'in_progress', 'completed', 'cancelled')"
           )

    alter table(:manufacturing_order_steps) do
      remove :planned_duration_seconds
    end
  end
end
