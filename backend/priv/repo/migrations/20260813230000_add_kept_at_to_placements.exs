defmodule Backend.Repo.Migrations.AddKeptAtToPlacements do
  use Ecto.Migration

  # ``kept_at`` timestamps a placement's role transition from "output
  # of a running MO" to "leftover the operator deliberately kept at
  # production_feed for a downstream MO" (the ``keep_in_place`` route
  # choice on closeout).
  #
  # Without this field, the system has no way to tell a "just parked
  # here 5 minutes ago" placement from a "stranded for 3 days waiting
  # on an MO that never came" placement. Both look identical: qty > 0
  # at a production_feed cell. The stranded-lots dashboard depends on
  # this column to compute "kept for > 24 hours" and surface the miss
  # to the warehouse manager.
  #
  # Nullable: existing placements + placements at other purposes
  # (regular / quarantine / etc.) never carry this stamp. Only lots
  # that the operator explicitly chose to keep at production get it.
  # Cleared to nil when the placement is drained (fully consumed) or
  # returned to warehouse via return-pickup — the ``kept`` state is
  # exclusive to production_feed residence.
  def change do
    alter table(:stock_lot_placements) do
      add :kept_at, :utc_datetime, null: true
    end
  end
end
