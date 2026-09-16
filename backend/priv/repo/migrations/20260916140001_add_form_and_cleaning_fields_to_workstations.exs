defmodule Backend.Repo.Migrations.AddFormAndCleaningFieldsToWorkstations do
  @moduledoc """
  Wire form templates + cleaning cadence directly onto workstations.

  Each workstation gets up to three assigned form templates
  (start-of-shift, end-of-shift, cleaning) and its own cleaning
  schedule cadence. Cleaning history is not stored here — the ledger
  lives on `equipment_events` (per-attached-piece `cleaning_completed`
  events written on callback from vita-perf). This table only caches
  the "last done" + "next due" so the kiosk WS picker can show
  due-soon chips without joining events on every read.

  On-delete: `:nilify_all` on the form FKs so archiving a template
  doesn't cascade-break workstations. The context layer refuses to
  save-and-publish a workstation with an inactive template, but
  archived assignments stay visible in read paths.
  """

  use Ecto.Migration

  def change do
    alter table(:workstations) do
      add :start_of_shift_form_template_id,
          references(:form_templates, on_delete: :nilify_all)

      add :end_of_shift_form_template_id,
          references(:form_templates, on_delete: :nilify_all)

      add :cleaning_form_template_id,
          references(:form_templates, on_delete: :nilify_all)

      # Cadence — mirrors the maintenance_task periodicity enum so
      # the same compute_next_due math applies.
      add :cleaning_periodicity, :string, size: 32
      add :cleaning_periodicity_interval, :integer

      # Cached scalars for due-soon queries + kiosk chips. Recomputed
      # on every cleaning-complete callback from vita-perf.
      add :last_cleaning_at, :utc_datetime
      add :next_cleaning_due_at, :date
    end

    create index(:workstations, [:start_of_shift_form_template_id])
    create index(:workstations, [:end_of_shift_form_template_id])
    create index(:workstations, [:cleaning_form_template_id])
    create index(:workstations, [:next_cleaning_due_at])
  end
end
