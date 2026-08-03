defmodule Backend.Repo.Migrations.AddNpdTrialBatchUuidToMo do
  use Ecto.Migration

  @moduledoc """
  Idempotency handle for the NPD trial-batch → PSP MO creation flow.

  NPD stores its own `TrialBatch.id`. When the scientist clicks
  "Create MO on PSP", NPD sends that UUID along with the create
  payload. PSP writes it here so a re-fire of the same request
  (network blip, page refresh, retry from a queue) returns the
  existing MO instead of spawning a duplicate.

  Nullable — every existing (non-NPD) MO leaves it blank. Unique
  partial index enforces one MO per trial batch when set, while
  allowing many NULLs.
  """

  def change do
    alter table(:manufacturing_orders) do
      add :npd_trial_batch_uuid, :uuid
    end

    create unique_index(:manufacturing_orders, [:npd_trial_batch_uuid],
             where: "npd_trial_batch_uuid IS NOT NULL",
             name: :manufacturing_orders_npd_trial_batch_uuid_unique
           )
  end
end
