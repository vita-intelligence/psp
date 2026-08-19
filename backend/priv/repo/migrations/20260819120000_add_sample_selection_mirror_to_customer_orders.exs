defmodule Backend.Repo.Migrations.AddSampleSelectionMirrorToCustomerOrders do
  @moduledoc """
  Mirror the vita-cff sample-selection state onto the customer_orders
  table so the kanban's ``derive_phase`` can split the sent
  ``npd_proposal_status`` into distinct columns:

    * ``sent`` + ``npd_customer_signed_at`` nil
      → ``:awaiting_customer_signature`` ("Sent to client")
    * ``sent`` + signed + allocation not yet ``"confirmed"``
      → ``:awaiting_sample_selection`` ("Choose samples") ← new
    * ``sent`` + signed + allocation ``"confirmed"``
      → ``:proposal_accepted`` ("Awaiting R&D payment")

  Both columns are populated by the NPD sync payload that vita-cff
  already ships (``npd_customer_signed_at`` at top level +
  per-line ``npd_sample_allocation_status``). Nullable so the
  migration is safe on a rehearsal DB with existing rows.
  """

  use Ecto.Migration

  def change do
    alter table(:customer_orders) do
      add :npd_customer_signed_at, :utc_datetime, null: true
      add :npd_sample_allocation_status, :string, null: true
    end
  end
end
