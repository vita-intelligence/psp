defmodule Backend.Repo.Migrations.AddCloseoutCompletedAt do
  @moduledoc """
  Adds `closeout_completed_at` to `manufacturing_orders`.

  Why: for R&D MOs on a single-cell facility, the output-lot side of
  closeout is a no-op — the lot is already at the "destination" cell,
  so `move_placement` short-circuits and the closeout leaves no trace
  on the DB. The mobile Closeout queue's `output_at_feed` predicate
  keeps matching the lot's shape (`status = available, at production
  cell`) forever, so the operator finishes closeout, refreshes, and
  the MO is still there like nothing happened.

  Fixing at the physical-stock layer (fake move, swap status) would
  be lying about traceability. Instead we track "closeout completed"
  as an operator-visible MO-level fact: stamped when the last output-
  lot closeout call resolves for a completed MO with no open bookings.
  The queue filter uses this to hide the row.
  """

  use Ecto.Migration

  def change do
    alter table(:manufacturing_orders) do
      add :closeout_completed_at, :utc_datetime, null: true
      add :closeout_completed_by_id,
          references(:users, on_delete: :nilify_all),
          null: true
    end
  end
end
