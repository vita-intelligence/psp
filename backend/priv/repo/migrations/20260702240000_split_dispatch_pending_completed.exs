defmodule Backend.Repo.Migrations.SplitDispatchPendingCompleted do
  use Ecto.Migration

  # The 3PL dispatch flow is being split into two steps:
  #
  # 1. Desktop operator queues a dispatch request (qty + reference + notes).
  #    No photo, no Stock.Movement — just an ask on the mobile queue.
  # 2. Warehouse picker on mobile scans the 3PL cell, scans the lot,
  #    walks the qty to the shipping bay, scans the destination cell,
  #    takes a photo, confirms. THAT step creates the Stock.Movement +
  #    flips the row to "completed".
  #
  # We keep the existing row shape so `dispatched_at` = when the physical
  # move landed (populated at completion). Add `status`,
  # `requested_by_id`, and `requested_at` for the request half.
  def change do
    alter table(:three_pl_dispatches) do
      add :status, :string, null: false, default: "pending"
      add :requested_by_id, references(:users, on_delete: :nilify_all)
      add :requested_at, :utc_datetime
    end

    # Existing rows (from the one-shot flow) get backfilled to
    # `completed` so they don't accidentally appear on the picker's
    # queue, and pick up their existing dispatched_by/dispatched_at as
    # the request timestamps too (best-effort — the request pre-dated
    # the split so there's no other data to fall back on).
    execute(
      """
      UPDATE three_pl_dispatches
        SET status = 'completed',
            requested_at = dispatched_at,
            requested_by_id = dispatched_by_id
        WHERE status = 'pending' AND dispatched_at IS NOT NULL
      """,
      """
      UPDATE three_pl_dispatches
        SET status = 'pending'
        WHERE requested_at IS NOT NULL
      """
    )

    # Once the backfill is done, `dispatched_at` is now nullable — a
    # pending row hasn't been physically dispatched yet. Same for
    # dispatched_by.
    execute(
      "ALTER TABLE three_pl_dispatches ALTER COLUMN dispatched_at DROP NOT NULL",
      "ALTER TABLE three_pl_dispatches ALTER COLUMN dispatched_at SET NOT NULL"
    )

    execute(
      """
      ALTER TABLE three_pl_dispatches
        ADD CONSTRAINT three_pl_dispatches_status_check
        CHECK (status IN ('pending','completed','cancelled'))
      """,
      """
      ALTER TABLE three_pl_dispatches
        DROP CONSTRAINT IF EXISTS three_pl_dispatches_status_check
      """
    )

    create index(:three_pl_dispatches, [:status])
  end
end
