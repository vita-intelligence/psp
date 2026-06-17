defmodule Backend.Repo.Migrations.AddPreparedToMos do
  use Ecto.Migration

  @moduledoc """
  Two-signature approval. `draft → prepared → approved` so a planner
  prepares the run, a scientist countersigns before production can
  schedule. Server-side 4-eyes rule blocks the same user from doing
  both signatures.

  `rejection_reason` is the text recorded when the scientist sends
  the root MO back to draft. Shown as a banner on the MO until the
  preparer re-signs.

  Existing `approved_by_id` + `approved_at` stay as the 2nd signature.
  """

  def change do
    alter table(:manufacturing_orders) do
      add :prepared_by_id, references(:users, on_delete: :nilify_all)
      add :prepared_at, :utc_datetime
      add :rejection_reason, :text
    end

    create index(:manufacturing_orders, [:prepared_by_id])

    # Replace the old status check constraint with one that knows
    # about the new state. Drop + create in one migration so the
    # rollback is symmetric.
    drop constraint(:manufacturing_orders, :manufacturing_orders_status_known)

    create constraint(:manufacturing_orders, :manufacturing_orders_status_known,
             check:
               "status IN ('draft', 'prepared', 'approved', 'in_progress', 'completed', 'cancelled')"
           )
  end
end
