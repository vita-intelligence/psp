defmodule Backend.Repo.Migrations.AddPerEventPaperworkFields do
  @moduledoc """
  Multi-visit pickup pushed the "one carrier / one tracking / one seal
  / one temperature per shipment" model to a per-truck-visit model.
  Add the three per-truck paperwork fields to ``shipment_pickup_events``
  so each visit carries its own trace: the customer needs the tracking
  number for THIS truck to follow it, the seal number is per-truck by
  regulation, and the temperature is a per-load measurement.

  ``carrier`` (delivery company) stays on the shipment because in
  practice the same carrier moves the whole consignment; ``ship-to``
  stays there too. Everything else that varies truck-to-truck moves
  onto the event.
  """

  use Ecto.Migration

  def change do
    alter table(:shipment_pickup_events) do
      add :tracking_number, :string
      add :seal_number, :string
      add :temperature_c, :decimal, precision: 6, scale: 2
    end
  end
end
