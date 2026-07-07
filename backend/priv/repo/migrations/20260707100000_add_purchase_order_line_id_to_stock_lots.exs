defmodule Backend.Repo.Migrations.AddPurchaseOrderLineIdToStockLots do
  use Ecto.Migration

  # Direct FK from `stock_lots` to the PO line that spawned it.
  # Introduced when child-lot creation moved from `mark_ordered` back
  # to PO line insert — every PO line now carries a matching lot from
  # the moment it's persisted (status `requested` while the PO is
  # still on the paperwork side of the workflow, promoted to
  # `expected` on `mark_ordered`).
  #
  # Before this migration the linkage lived in `lot_events.metadata`
  # (JSON, `po_line_id` key). We keep the event log intact for audit
  # continuity but backfill the FK here so day-forward code can query
  # `stock_lots.purchase_order_line_id` directly instead of joining
  # through JSON.
  #
  # `on_delete: :nilify_all` — a PO line can only be hard-deleted
  # while the PO is still `draft`, and the app cancels the child lot
  # before deleting the line. If a rogue direct DELETE bypasses the
  # app, the lot survives at `canceled` with the FK nulled so the
  # audit trail stays intact.
  def change do
    alter table(:stock_lots) do
      add :purchase_order_line_id,
        references(:purchase_order_lines, on_delete: :nilify_all),
        null: true
    end

    create index(:stock_lots, [:purchase_order_line_id])

    # Backfill from the event log. Only touch lots that were minted
    # from a PO — manual receives, opening balances, MO outputs stay
    # NULL. The oldest `expected` event carries the origin line id.
    execute(
      """
      UPDATE stock_lots sl
      SET purchase_order_line_id = (
        SELECT ((le.metadata ->> 'po_line_id')::bigint)
        FROM lot_events le
        WHERE le.stock_lot_id = sl.id
          AND le.kind = 'expected'
          AND (le.metadata ->> 'po_line_id') IS NOT NULL
        ORDER BY le.occurred_at ASC, le.id ASC
        LIMIT 1
      )
      WHERE sl.source_kind = 'purchase_order'
        AND sl.purchase_order_line_id IS NULL
      """,
      "SELECT 1"
    )
  end
end
