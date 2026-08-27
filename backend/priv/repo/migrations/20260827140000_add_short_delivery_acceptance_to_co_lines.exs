defmodule Backend.Repo.Migrations.AddShortDeliveryAcceptanceToCoLines do
  @moduledoc """
  Escape hatch for the yield-tolerance fulfilment gate: when a CO
  line comes in short of ordered qty by more than the company
  tolerance AND the customer has agreed to receive the reduced
  quantity, the operator can accept the short delivery on the
  wizard. This stamps ``short_delivery_accepted_at`` +
  ``short_delivery_accepted_reason`` on the line, which
  ``Backend.CustomerOrders.line_fulfilment_status/2`` treats as
  ``:satisfied`` from then on — the CO advances to ready-to-dispatch
  as if the shortfall never happened.

  The reason field is required by the controller (empty stamps get
  rejected up front) — the intent is compliance / audit, not silent
  bypass. The stamp is cleared to null if the line is later topped
  up so the fulfilment status re-derives naturally.
  """

  use Ecto.Migration

  def change do
    alter table(:customer_order_lines) do
      add :short_delivery_accepted_at, :utc_datetime, null: true
      add :short_delivery_accepted_reason, :text, null: true

      add :short_delivery_accepted_by_id,
          references(:users, on_delete: :nilify_all),
          null: true
    end
  end
end
