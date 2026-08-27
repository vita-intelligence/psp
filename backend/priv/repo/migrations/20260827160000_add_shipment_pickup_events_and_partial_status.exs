defmodule Backend.Repo.Migrations.AddShipmentPickupEventsAndPartialStatus do
  @moduledoc """
  Multi-visit pickups. Today's model is 1 shipment → 1 pickup event
  (``ready`` flips to ``picked_up`` in one call); if the truck can
  only take part of the qty in one visit there's no clean path.

  Three parts:

    1. New ``shipment_pickup_events`` table — one row per truck
       visit. Carries qty, driver + vehicle, the BRCGS Issue 9
       § 5.4.6 checklist, and its own timestamp / actor.

    2. New status ``partially_picked`` — sits between ``ready``
       and ``picked_up``. The shipment auto-transitions to it after
       the first event and to ``picked_up`` when accumulated event
       qty equals the shipment qty.

    3. FK on ``shipment_pickup_files`` so evidence photos anchor to
       the pickup event they document (rather than to the shipment
       as a whole). Nullable for legacy rows uploaded before the
       events table shipped.

  Backfill:

    * Every shipment currently in ``picked_up`` or ``delivered``
      gets ONE synthesised event row carrying its ``qty``,
      ``picked_up_at``, ``picked_up_by_id``, and every checklist +
      driver / vehicle field.
    * Every existing pickup file for those shipments points at the
      backfilled event.

  After backfill the denormalised checklist / driver fields on the
  ``shipments`` table stay in place (backward compat with existing
  consumers) — the events table becomes the source of truth going
  forward.
  """

  use Ecto.Migration

  def change do
    create table(:shipment_pickup_events) do
      add :uuid, :uuid, null: false

      add :company_id,
          references(:companies, on_delete: :restrict),
          null: false

      add :shipment_id,
          references(:shipments, on_delete: :delete_all),
          null: false

      add :qty, :decimal, precision: 20, scale: 10, null: false

      add :picked_up_at, :utc_datetime, null: false

      add :picked_up_by_id,
          references(:users, on_delete: :nilify_all),
          null: true

      add :driver_name, :string
      add :vehicle_registration, :string
      add :consignment_note_ref, :string

      # Truck-arrival checklist (BRCGS Issue 9 § 5.4.6). Every value
      # must be ``true`` for the event to be accepted — mirrored
      # per-event so a second visit re-verifies the truck.
      add :packaging_intact, :boolean, null: false, default: false
      add :labels_verified, :boolean, null: false, default: false
      add :vehicle_clean_suitable, :boolean, null: false, default: false
      add :transport_condition_acceptable, :boolean, null: false, default: false
      add :dispatch_approved, :boolean, null: false, default: false

      add :notes, :string

      add :created_by_id,
          references(:users, on_delete: :nilify_all),
          null: true

      add :updated_by_id,
          references(:users, on_delete: :nilify_all),
          null: true

      timestamps(type: :utc_datetime)
    end

    create unique_index(:shipment_pickup_events, [:uuid])
    create index(:shipment_pickup_events, [:shipment_id])
    create index(:shipment_pickup_events, [:company_id])

    create constraint(:shipment_pickup_events, :shipment_pickup_events_qty_positive,
             check: "qty > 0"
           )

    alter table(:shipment_pickup_files) do
      add :shipment_pickup_event_id,
          references(:shipment_pickup_events, on_delete: :delete_all),
          null: true
    end

    create index(:shipment_pickup_files, [:shipment_pickup_event_id])

    # ── Backfill ─────────────────────────────────────────────────────
    #
    # We're in the ``change`` callback but the backfill is a data
    # migration — Ecto lets us run raw SQL inline. Wrapped so
    # ``mix ecto.rollback`` re-drops the backfilled rows via the
    # normal cascade (the table gets dropped).
    execute """
    INSERT INTO shipment_pickup_events (
      uuid,
      company_id,
      shipment_id,
      qty,
      picked_up_at,
      picked_up_by_id,
      driver_name,
      vehicle_registration,
      consignment_note_ref,
      packaging_intact,
      labels_verified,
      vehicle_clean_suitable,
      transport_condition_acceptable,
      dispatch_approved,
      notes,
      created_by_id,
      updated_by_id,
      inserted_at,
      updated_at
    )
    SELECT
      gen_random_uuid(),
      s.company_id,
      s.id,
      s.qty,
      COALESCE(s.picked_up_at, s.updated_at),
      s.picked_up_by_id,
      s.driver_name,
      s.vehicle_registration,
      s.consignment_note_ref,
      COALESCE(s.packaging_intact, false),
      COALESCE(s.labels_verified, false),
      COALESCE(s.vehicle_clean_suitable, false),
      COALESCE(s.transport_condition_acceptable, false),
      COALESCE(s.dispatch_approved, false),
      s.notes,
      s.picked_up_by_id,
      s.picked_up_by_id,
      COALESCE(s.picked_up_at, s.updated_at),
      COALESCE(s.picked_up_at, s.updated_at)
    FROM shipments s
    WHERE s.status IN ('picked_up', 'delivered');
    """,
            "DELETE FROM shipment_pickup_events;"

    # Point every existing pickup file at the backfilled event for
    # its shipment. Legacy files whose shipment hasn't been picked
    # up yet stay ``NULL`` — future evidence uploads will fill this
    # in.
    execute """
    UPDATE shipment_pickup_files f
    SET shipment_pickup_event_id = e.id
    FROM shipment_pickup_events e
    WHERE e.shipment_id = f.shipment_id
      AND f.shipment_pickup_event_id IS NULL;
    """,
            "UPDATE shipment_pickup_files SET shipment_pickup_event_id = NULL;"
  end
end
