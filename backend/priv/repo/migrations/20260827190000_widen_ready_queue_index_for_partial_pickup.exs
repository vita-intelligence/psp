defmodule Backend.Repo.Migrations.WidenReadyQueueIndexForPartialPickup do
  @moduledoc """
  ``list_ready_for_pickup/2`` now returns shipments in ``ready`` OR
  ``partially_picked`` state — the second and subsequent trucks on
  a multi-visit shipment need to appear on the mobile dispatch
  queue for the operator meeting the truck to find them.

  The partial index ``shipments_ready_queue_idx`` was scoped to
  ``status = 'ready'``. Rebuild it with the widened predicate so
  the index-only range scan still covers the query cleanly. Using
  ``concurrently: true`` + ``@disable_ddl_transaction true`` for
  the same reasons the original migration did — production may
  have live writes and we don't want to lock the table.
  """

  use Ecto.Migration

  @disable_ddl_transaction true
  @disable_migration_lock true

  def change do
    drop_if_exists index(
                     :shipments,
                     [:company_id, :planned_ship_at, :id],
                     name: :shipments_ready_queue_idx,
                     concurrently: true
                   )

    create_if_not_exists index(
                           :shipments,
                           [:company_id, :planned_ship_at, :id],
                           where: "status IN ('ready', 'partially_picked')",
                           name: :shipments_ready_queue_idx,
                           concurrently: true
                         )
  end
end
