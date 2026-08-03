defmodule Backend.Repo.Migrations.RelaxNpdTrialBatchUniqueToActive do
  @moduledoc """
  Loosens the ``manufacturing_orders_npd_trial_batch_uuid_unique``
  index so a cancelled MO frees its trial-batch "slot" and NPD can
  re-fire ``Create MO`` against the same trial batch to spawn a
  fresh chain.

  Old behaviour: any MO carrying an ``npd_trial_batch_uuid`` locked
  that uuid forever, forcing the scientist to create a whole new
  trial batch after a cancellation just to re-attempt the run.

  New behaviour: the constraint only enforces uniqueness across MOs
  that are NOT ``cancelled``, which matches the operator's mental
  model — a cancellation abandons the run, not the plan.
  """

  use Ecto.Migration

  def up do
    drop_if_exists index(:manufacturing_orders, [:npd_trial_batch_uuid],
                     name: :manufacturing_orders_npd_trial_batch_uuid_unique
                   )

    create unique_index(:manufacturing_orders, [:npd_trial_batch_uuid],
             where: "npd_trial_batch_uuid IS NOT NULL AND status <> 'cancelled'",
             name: :manufacturing_orders_npd_trial_batch_uuid_active_unique
           )
  end

  def down do
    drop_if_exists index(:manufacturing_orders, [:npd_trial_batch_uuid],
                     name: :manufacturing_orders_npd_trial_batch_uuid_active_unique
                   )

    create unique_index(:manufacturing_orders, [:npd_trial_batch_uuid],
             where: "npd_trial_batch_uuid IS NOT NULL",
             name: :manufacturing_orders_npd_trial_batch_uuid_unique
           )
  end
end
