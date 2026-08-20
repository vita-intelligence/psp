defmodule Backend.Repo.Migrations.AddTrialBatchCycleMirrorToCustomerOrders do
  use Ecto.Migration

  @moduledoc """
  Mirror columns for the vita-cff trial-batch cycle. Populated by
  `NpdSync.upsert_sample_from_npd` when the incoming sample CO carries
  cycle context (the trial batch is linked to a
  `TrialBatchSlot`). Drives the `↳ Trial N/M · <ref>` badge on the
  /projects kanban so scientists can eyeball which sample MO cards
  are siblings of the same custom-formulation CO.

  All four columns are nullable — sample COs from the storefront
  sample-kit flow (no cycle involved) leave them at nil, matching
  today's behaviour.
  """

  def change do
    alter table(:customer_orders) do
      # Parent (custom-formulation) CO on PSP. Points at another
      # customer_orders row whose sample_kind=false — the row that
      # was created when the proposal was bundled and against which
      # the deposit + final-spec-sign gates run. FE renders "sibling"
      # groups by this uuid.
      add :parent_customer_order_uuid, :uuid

      # Denormalised human-readable reference (formulation code like
      # "MA01440"). Sent by vita-cff in the sync payload so the badge
      # can render "Trial 2/3 · MA01440" without a second lookup.
      add :parent_customer_order_reference, :string

      # Position of this slot within its trial-batch cycle. Sent by
      # vita-cff; a value of 1..total. Nil on non-cycle samples.
      add :npd_trial_slot_sequence_no, :integer

      # Total number of slots in the cycle at the moment this sample
      # CO was created. May be lower than the eventual total if the
      # customer requests additional samples after this CO landed —
      # snapshotting matches how npd_payment_amount is treated.
      add :npd_trial_slot_total, :integer
    end

    create index(:customer_orders, [:parent_customer_order_uuid])
  end
end
