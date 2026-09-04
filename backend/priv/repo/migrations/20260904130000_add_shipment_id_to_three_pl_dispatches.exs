defmodule Backend.Repo.Migrations.AddShipmentIdToThreePlDispatches do
  use Ecto.Migration

  # Explicit 1:1 link from a completed 3PL dispatch to the shipment
  # that spawned from it. Timestamp-based matching in the portal
  # payload enrichment was fragile in Shopify-style bursts — many
  # dispatches walking within the same second would all resolve to
  # the oldest shipment on the lot, leaking pickup evidence + a
  # "Mark as delivered" button onto sibling customers' rows.
  def change do
    alter table(:three_pl_dispatches) do
      add :shipment_id, references(:shipments, on_delete: :nilify_all)
    end

    create index(:three_pl_dispatches, [:shipment_id])
  end
end
