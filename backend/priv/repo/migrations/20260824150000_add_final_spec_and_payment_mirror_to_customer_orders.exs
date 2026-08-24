defmodule Backend.Repo.Migrations.AddFinalSpecAndPaymentMirrorToCustomerOrders do
  use Ecto.Migration

  @moduledoc """
  Mirror columns for the vita-cff FINAL-spec + FINAL-payment lifecycle.
  Populated by the proposal-merge sync (and future FINAL-specific
  sync hooks). These are the gate signals that let
  `OrderWizard.derive_phase/3` split the post-trial-batches slice of
  the kanban into two new columns:

    * `:awaiting_final_spec` — customer confirmed "we're done" on
      trial batches OR a FINAL spec exists (any status short of
      accepted+paid). "Team owes the customer a FINAL, or the
      customer owes us a signature, or finance owes us an approval."
    * `:needs_mo_creation` — FINAL signed AND FINAL payment
      approved. Production is authorised; scientist owes the shop
      floor an MO.

  Rejection is self-healing: when the customer rejects a FINAL,
  vita-cff clears its own `customer_confirmed_done_at` via the
  reopen-cycle hook and re-fires the sync, which nulls
  `npd_customer_confirmed_done_at` here — the CO falls back to
  `:trial_batches_in_flight` on the next `derive_phase` call
  automatically.

  All columns nullable — legacy COs from before this ships keep
  working (they land in the existing `:trial_batches_in_flight`
  branch until they leave `status: "draft"`).
  """

  def change do
    alter table(:customer_orders) do
      # Customer's "we're done, please prepare the final spec" click
      # on the trial-batches portal card. Cleared when they reject a
      # FINAL and the cycle reopens — that's how PSP falls back to
      # `:trial_batches_in_flight` without a special-case reset path.
      add :npd_customer_confirmed_done_at, :utc_datetime

      # The active FINAL SpecificationSheet on vita-cff. "Active" means
      # not rejected — a rejected FINAL is dead-weight (customer sent
      # us back to trials) so the sync leaves these columns nulled out
      # for a rejected sheet, and the phase logic reads that as "no
      # FINAL in flight."
      add :npd_final_spec_uuid, :uuid
      add :npd_final_spec_status, :string
      add :npd_final_spec_signed_at, :utc_datetime
      # Kept even for the "rejected sheet, no active FINAL" case so the
      # scientist card can render a "Customer rejected: <date>" audit
      # badge if we want it later. Not gate-signal for phase logic.
      add :npd_final_spec_rejected_at, :utc_datetime

      # Finance's approval of the FINAL invoice on vita-cff. Presence
      # here promotes the CO from `:awaiting_final_spec` to
      # `:needs_mo_creation` — production is authorised.
      add :npd_final_payment_approved_at, :utc_datetime
    end

    # Index on `npd_final_spec_uuid` so a future sync path keyed off
    # the spec uuid (rather than the proposal uuid) can find the CO
    # in O(log n). Same shape as the existing spec-sheet-uuid index.
    create index(:customer_orders, [:npd_final_spec_uuid])
  end
end
