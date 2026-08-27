defmodule Backend.Repo.Migrations.AddPerEventDelivery do
  @moduledoc """
  Per-event delivery confirmation. Physical reality: if a truck
  takes 3_000 units on Monday and another 4_000 on Wednesday, they
  land at the customer's site on Tuesday + Thursday and each needs
  its own POD. Today we only have ONE delivery confirmation per
  shipment which forces the customer to accept every visit as one
  bundle — wrong for staggered receipts.

  Two parts:

    1. New per-event delivery columns on ``shipment_pickup_events``
       — ``delivered_at``, ``delivered_by_id``, ``recipient_signatory``,
       ``delivery_notes``.
    2. ``shipment_delivery_files`` gains
       ``shipment_pickup_event_id`` FK so POD photos anchor to the
       specific event they document. Backfill: any file on a
       shipment that already had a single-event backfill points at
       that same event.
  """

  use Ecto.Migration

  def change do
    alter table(:shipment_pickup_events) do
      add :delivered_at, :utc_datetime, null: true

      add :delivered_by_id,
          references(:users, on_delete: :nilify_all),
          null: true

      add :recipient_signatory, :string
      add :delivery_notes, :string
    end

    alter table(:shipment_delivery_files) do
      add :shipment_pickup_event_id,
          references(:shipment_pickup_events, on_delete: :delete_all),
          null: true
    end

    create index(:shipment_delivery_files, [:shipment_pickup_event_id])

    # Backfill: for every ``delivered`` shipment, mirror its
    # delivered_at / recipient / notes onto its single backfilled
    # event, and re-parent its delivery files to that event.
    execute """
    UPDATE shipment_pickup_events e
    SET
      delivered_at = s.delivered_at,
      delivered_by_id = s.delivered_by_id,
      recipient_signatory = s.recipient_signatory,
      delivery_notes = s.delivery_notes
    FROM shipments s
    WHERE e.shipment_id = s.id
      AND s.status = 'delivered'
      AND s.delivered_at IS NOT NULL;
    """,
            "UPDATE shipment_pickup_events SET delivered_at = NULL, delivered_by_id = NULL, recipient_signatory = NULL, delivery_notes = NULL;"

    execute """
    UPDATE shipment_delivery_files f
    SET shipment_pickup_event_id = e.id
    FROM shipment_pickup_events e
    WHERE e.shipment_id = f.shipment_id
      AND f.shipment_pickup_event_id IS NULL;
    """,
            "UPDATE shipment_delivery_files SET shipment_pickup_event_id = NULL;"
  end
end
