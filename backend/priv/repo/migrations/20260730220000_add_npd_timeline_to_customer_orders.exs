defmodule Backend.Repo.Migrations.AddNpdTimelineToCustomerOrders do
  use Ecto.Migration

  @moduledoc """
  ``customer_orders.npd_timeline`` — full audit-preserving event log
  mirrored from NPD.

  The per-status timestamps (added in the previous migration) capture
  the LATEST transition to each state; they're still useful for the
  wizard's phase-gate derivation. But an audit-safe timeline needs
  EVERY event: two spec approvals need two rows, a revert-and-redo
  cycle needs both attempts, each merged R&D formulation's creation
  needs its own line.

  Shape (list of maps, each with):

      %{
        "at"     => "2026-07-30T14:00:00Z",  # ISO-8601, UTC
        "label"  => "Proposal moved from in_review to approved",
        "actor"  => "Alex Cherya",           # denormalised name
        "href"   => "https://npd/…",         # optional deep link
        "kind"   => "proposal_transition"    # semantic tag for icons
      }

  Rendered as-is by ``OrderWizard.timeline`` — no schema on the
  entries beyond the four keys above so NPD can add fields freely
  (e.g. ``notes`` on a rejection) without a PSP migration.
  """

  def change do
    alter table(:customer_orders) do
      add :npd_timeline, {:array, :map}, default: []
    end
  end
end
