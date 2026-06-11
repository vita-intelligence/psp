defmodule Backend.Repo.Migrations.BackfillLotEventsForExistingLots do
  use Ecto.Migration

  @moduledoc """
  One-off backfill: synthesise a `received` event for every existing
  `stock_lots` row so the lifecycle projection works on day one.

  Without this the new `Lifecycle.project_status/1` would return
  `:expected` for every legacy lot (no events ⇒ no recorded receive),
  which would silently flip the status column out from under the FE.
  Pre-existing rows have already been through the manual-receive
  pathway, so a synthesised `received` row with `actor_kind = "system"`
  + `reason = "lifecycle backfill"` records the truth.

  Idempotency: only inserts events for lots that don't already have
  any. Running this twice is a no-op — the second pass finds every
  lot already covered by the first.
  """

  def up do
    # Pass 1 — every lot gets a synthesised `received` event so the
    # projection has the receive root. Idempotent via the LEFT JOIN
    # guard: lots already carrying any event are skipped.
    execute("""
    INSERT INTO lot_events (
      uuid, company_id, stock_lot_id, kind, actor_kind, reason,
      metadata, occurred_at, inserted_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      l.company_id,
      l.id,
      'received',
      'system',
      'lifecycle backfill',
      '{}'::jsonb,
      COALESCE(l.received_at, l.inserted_at),
      now(),
      now()
    FROM stock_lots l
    LEFT JOIN lot_events e ON e.stock_lot_id = l.id
    WHERE e.id IS NULL
    """)

    # Pass 2 — synthesise a terminal event for lots whose current
    # status implies one. Without this, `project_status/1` on a
    # legacy `depleted` / `disposed` / `rejected` lot would walk
    # backward to `received` the next time an event is recorded.
    # Each pass is guarded so re-running the migration is safe.
    execute("""
    INSERT INTO lot_events (
      uuid, company_id, stock_lot_id, kind, actor_kind, reason,
      metadata, occurred_at, inserted_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      l.company_id,
      l.id,
      'qc_failed',
      'system',
      'lifecycle backfill — legacy rejected status',
      '{}'::jsonb,
      COALESCE(l.received_at, l.inserted_at) + INTERVAL '1 microsecond',
      now(),
      now()
    FROM stock_lots l
    WHERE l.status = 'rejected'
      AND NOT EXISTS (
        SELECT 1 FROM lot_events e
        WHERE e.stock_lot_id = l.id AND e.kind = 'qc_failed'
      )
    """)

    execute("""
    INSERT INTO lot_events (
      uuid, company_id, stock_lot_id, kind, actor_kind, reason,
      metadata, occurred_at, inserted_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      l.company_id,
      l.id,
      'routed_to_quarantine',
      'system',
      'lifecycle backfill — legacy quarantine status',
      '{}'::jsonb,
      COALESCE(l.received_at, l.inserted_at) + INTERVAL '1 microsecond',
      now(),
      now()
    FROM stock_lots l
    WHERE l.status = 'quarantine'
      AND NOT EXISTS (
        SELECT 1 FROM lot_events e
        WHERE e.stock_lot_id = l.id AND e.kind = 'routed_to_quarantine'
      )
    """)

    execute("""
    INSERT INTO lot_events (
      uuid, company_id, stock_lot_id, kind, actor_kind, reason,
      metadata, occurred_at, inserted_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      l.company_id,
      l.id,
      'disposed',
      'system',
      'lifecycle backfill — legacy disposed status',
      '{}'::jsonb,
      COALESCE(l.received_at, l.inserted_at) + INTERVAL '2 microsecond',
      now(),
      now()
    FROM stock_lots l
    WHERE l.status = 'disposed'
      AND NOT EXISTS (
        SELECT 1 FROM lot_events e
        WHERE e.stock_lot_id = l.id AND e.kind = 'disposed'
      )
    """)

    execute("""
    INSERT INTO lot_events (
      uuid, company_id, stock_lot_id, kind, actor_kind, reason,
      metadata, occurred_at, inserted_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      l.company_id,
      l.id,
      'consumed_to_zero',
      'system',
      'lifecycle backfill — legacy depleted status',
      '{}'::jsonb,
      COALESCE(l.received_at, l.inserted_at) + INTERVAL '2 microsecond',
      now(),
      now()
    FROM stock_lots l
    WHERE l.status = 'depleted'
      AND NOT EXISTS (
        SELECT 1 FROM lot_events e
        WHERE e.stock_lot_id = l.id AND e.kind = 'consumed_to_zero'
      )
    """)
  end

  def down do
    execute(
      "DELETE FROM lot_events WHERE actor_kind = 'system' AND reason LIKE 'lifecycle backfill%'"
    )
  end
end
