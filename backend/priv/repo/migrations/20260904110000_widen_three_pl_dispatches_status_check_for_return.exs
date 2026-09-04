defmodule Backend.Repo.Migrations.WidenThreePlDispatchesStatusCheckForReturn do
  @moduledoc """
  The status CHECK constraint on ``three_pl_dispatches`` (added by
  ``20260702240000_split_dispatch_pending_completed``) only allows
  ``pending | completed | cancelled``. The cancel-and-return flow
  introduced a fourth value — ``return_pending`` — for the transient
  state between the shipment being cancelled and the picker walking
  the goods back into bailee custody. Widen the CHECK to include it.

  Rollback narrows the CHECK back to the pre-return set. Any row in
  ``return_pending`` at rollback time WILL fail the tightened
  constraint, so the down step also converts them to ``cancelled``
  (the terminal state that would eventually apply once the walk-back
  completed) so ``ecto.rollback`` doesn't wedge.
  """

  use Ecto.Migration

  def up do
    execute("""
      ALTER TABLE three_pl_dispatches
        DROP CONSTRAINT IF EXISTS three_pl_dispatches_status_check
    """)

    execute("""
      ALTER TABLE three_pl_dispatches
        ADD CONSTRAINT three_pl_dispatches_status_check
        CHECK (status IN ('pending','completed','return_pending','cancelled'))
    """)
  end

  def down do
    execute("""
      UPDATE three_pl_dispatches
      SET status = 'cancelled'
      WHERE status = 'return_pending'
    """)

    execute("""
      ALTER TABLE three_pl_dispatches
        DROP CONSTRAINT IF EXISTS three_pl_dispatches_status_check
    """)

    execute("""
      ALTER TABLE three_pl_dispatches
        ADD CONSTRAINT three_pl_dispatches_status_check
        CHECK (status IN ('pending','completed','cancelled'))
    """)
  end
end
