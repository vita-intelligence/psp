defmodule Backend.Repo.Migrations.AddNpdValidationStateToMos do
  use Ecto.Migration

  # Snapshot of the NPD ProductValidation state for a trial/sample MO.
  # Populated by the /api/integration/trial-validations/sync webhook
  # every time NPD flips the state machine; read by the PSP Output QC
  # gate to decide whether the operator can pass the lot.
  #
  # All four columns are nullable — legacy MOs, non-R&D MOs, and
  # trial/sample MOs where NPD hasn't yet fired the webhook all sit
  # at NULL. The gate treats NULL as "not yet passed" for R&D MOs.
  def change do
    alter table(:manufacturing_orders) do
      add :npd_validation_uuid, :uuid, null: true
      # draft | in_progress | passed | failed. Kept as a plain string
      # so the exact NPD vocabulary can drift without a PSP migration
      # (the gate only checks for the literal "passed").
      add :npd_validation_status, :string, null: true
      add :npd_validation_synced_at, :utc_datetime, null: true
      add :npd_validation_failure_reason, :text, null: true
    end

    # Composite lookup key for the webhook: trial batch uuid + status.
    # The primary trial-batch lookup uses the existing
    # `manufacturing_orders_npd_trial_batch_uuid_unique` index; this
    # secondary index is only for admin dashboards that want to
    # "count MOs waiting on NPD validation" without a table scan.
    create index(:manufacturing_orders, [:npd_validation_status],
             where: "npd_validation_status IS NOT NULL",
             name: :manufacturing_orders_npd_validation_status_idx
           )
  end
end
