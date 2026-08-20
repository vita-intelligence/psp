defmodule Backend.Repo.Migrations.AddDepositPaidAtToCustomerOrders do
  use Ecto.Migration

  @moduledoc """
  Adds ``npd_deposit_paid_at`` to `customer_orders`. Populated by the
  vita-cff proposal-sync payload once the bundled deposit+samples
  Payment is approved by finance. Presence of this timestamp drives
  the new ``:trial_batches_in_flight`` kanban phase that sits between
  ``:proposal_accepted`` ("Awaiting R&D payment") and ``:setup``
  ("Order setup") — so operators can see at a glance that a
  custom-formulation project is mid-trial-batch cycle vs. still
  waiting on the customer to pay the deposit.
  """

  def change do
    alter table(:customer_orders) do
      add :npd_deposit_paid_at, :utc_datetime
    end
  end
end
