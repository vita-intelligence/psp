defmodule Backend.Repo.Migrations.AddProposalStatusToCustomerOrders do
  use Ecto.Migration

  @moduledoc """
  ``customer_orders.npd_proposal_status`` — the NPD-side proposal
  lifecycle stage, mirrored on every merge sync so the wizard can
  distinguish the three post-creation blocks:

    * ``draft`` / ``in_review`` → ``:awaiting_proposal_approval``
      (director hasn't signed off yet)
    * ``approved`` → ``:proposal_ready_to_send``
      (director signed; nobody's mailed it out)
    * ``sent`` → ``:awaiting_customer_signature``
      (out with the customer, kiosk link live)
    * ``accepted`` → the CO advances past these three, into the
      standard PSP setup / approval / production flow.

  Free-string column (no CHECK) — NPD is authoritative for its own
  vocabulary; PSP just mirrors and reads.
  """

  def change do
    alter table(:customer_orders) do
      add :npd_proposal_status, :string, size: 32
    end
  end
end
