defmodule Backend.Repo.Migrations.AddShipToFieldsToThreePlDispatches do
  @moduledoc """
  Portal dispatch request → customer names the delivery target.

  Bailee stock lives long enough that the ship-to details on the
  original CO (or the customer's legal address) are often not where
  the customer actually wants each individual send-out to go — they
  might be dropping this batch at a marketplace warehouse, a pop-up
  retailer, or a friend's flat while the rest stays with us. Before
  this migration the picker's paperwork form guessed from the
  customer / CO record and the operator had to hand-type overrides.

  Adds three nullable fields on ``three_pl_dispatches`` so the
  portal ``Request dispatch`` dialog can capture the address up
  front, and ``Backend.ThreePL.spawn_outbound_shipment`` can
  hand those values straight to ``Backend.Shipments.create_from_lot``
  as the shipment's initial recipient / address / country.

  Existing rows stay valid — nullable columns, no default value,
  the create + complete flows read them as "not provided, fall
  back to CO / customer defaults".
  """

  use Ecto.Migration

  def change do
    alter table(:three_pl_dispatches) do
      add :ship_to_name, :string
      add :ship_to_address, :string
      add :ship_to_country, :string, size: 2
    end
  end
end
