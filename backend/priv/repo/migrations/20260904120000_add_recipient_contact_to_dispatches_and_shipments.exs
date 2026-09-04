defmodule Backend.Repo.Migrations.AddRecipientContactToDispatchesAndShipments do
  @moduledoc """
  Courier hand-off requires a contact email + phone on the parcel —
  post offices refuse the drop when either is missing on the label.
  Adds two nullable columns each on ``three_pl_dispatches`` (portal
  captures at Request-dispatch time) and ``shipments`` (persisted on
  the outbound record so it prints on paperwork + shows on the mobile
  Paperwork form).

  Both nullable so legacy rows stay valid; the portal dialog nudges
  the customer for them going forward, and the picker's mobile
  Paperwork form can amend / fill in on our end when the customer
  left them blank.
  """

  use Ecto.Migration

  def change do
    alter table(:three_pl_dispatches) do
      add :ship_to_email, :string
      add :ship_to_phone, :string
    end

    alter table(:shipments) do
      add :recipient_email, :string
      add :recipient_phone, :string
    end
  end
end
