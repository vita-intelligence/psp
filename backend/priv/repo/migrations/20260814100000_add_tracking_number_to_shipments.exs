defmodule Backend.Repo.Migrations.AddTrackingNumberToShipments do
  @moduledoc """
  Add a `tracking_number` field to shipments so the desk can attach
  the carrier's tracking reference (e.g. DHL waybill, DPD parcel id)
  at any point in the shipment lifecycle and have it flow through
  to the customer portal's Dispatch card.

  Distinct from `consignment_note_ref` (the trader's own CN paperwork
  reference, set at truck arrival). Tracking numbers are frequently
  issued AFTER the truck departs, by the carrier's system — so this
  column has to stay editable through `picked_up` and `delivered`,
  unlike the checklist / carrier / vehicle_registration fields that
  the pickup changeset freezes at truck arrival.
  """

  use Ecto.Migration

  def change do
    alter table(:shipments) do
      add :tracking_number, :string, size: 120
    end
  end
end
