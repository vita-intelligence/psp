defmodule Backend.Repo.Migrations.AddShipmentsReadyQueueIndex do
  use Ecto.Migration

  # Partial composite index for the mobile pickup queue
  # (``/m/dispatch``) — the list every warehouse operator opens
  # when a truck is due. Query shape:
  #
  #     SELECT ...
  #     FROM shipments
  #     WHERE company_id = $1
  #       AND status = 'ready'
  #       AND (planned_ship_at, id) > ($2, $3)  -- keyset cursor
  #     ORDER BY planned_ship_at ASC NULLS LAST, id ASC
  #     LIMIT $4
  #
  # Without a purpose-built index this degrades to a bitmap scan on
  # ``shipments_status_index`` + in-memory sort — fine at seed scale
  # but a full scan of every ready row for the tenant at 100k+
  # shipments per year, which is exactly the "handles millions"
  # requirement.
  #
  # A partial index keyed on the filter tuple + sort keys stays
  # small (only ``status = 'ready'`` rows, which is a tiny slice of
  # the total table — most shipments are ``picked_up`` /
  # ``delivered`` and drop out) and answers the query with a single
  # index-only range scan.
  #
  # ``concurrently: true`` avoids locking writes on the shipments
  # table during the migration — production may have live inserts
  # from the mark-ready action. Must run outside a transaction
  # (``@disable_ddl_transaction true``) and against ``DDL_LOCK_TIMEOUT``
  # so a long-running scan of a huge table doesn't wait forever.
  @disable_ddl_transaction true
  @disable_migration_lock true

  def change do
    create_if_not_exists index(
                          :shipments,
                          [:company_id, :planned_ship_at, :id],
                          where: "status = 'ready'",
                          name: :shipments_ready_queue_idx,
                          concurrently: true
                        )
  end
end
