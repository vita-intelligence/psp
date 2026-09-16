defmodule Backend.Repo.Migrations.WorkstationFormAssignments do
  @moduledoc """
  Move workstation ↔ form_template from three 1:1 FK columns to a
  proper join table so a single workstation can carry multiple
  forms per trigger.

  The kiosk walks these in `sort_order` on start / end / cleaning
  so an operator sees "safety check → material check → product-
  specific form" in sequence. Audience filter (form_templates.worker_uuids)
  still applies per-form, so different workers can see different
  subsets from the same attached list.

  Migration:
    1. Create `workstation_form_assignments` with the composite key
       `(workstation_id, form_template_id, slot)` — a template can be
       attached to a workstation once per slot (attaching the same
       template as "start" AND "end" is fine; attaching the same
       template twice as "start" is not).
    2. Backfill each of the three legacy FKs as a single join row
       with `sort_order = 0`.
    3. Drop the FK columns from workstations.

  Cleaning-related workstation-level state (cleaning_periodicity,
  last_cleaning_at, next_cleaning_due_at) stays on `workstations` —
  it's per-workstation metadata, not per-form.
  """

  use Ecto.Migration

  def change do
    create table(:workstation_form_assignments) do
      add :workstation_id, references(:workstations, on_delete: :delete_all), null: false
      add :form_template_id, references(:form_templates, on_delete: :restrict), null: false
      add :slot, :string, size: 32, null: false
      add :sort_order, :integer, null: false, default: 0
      timestamps(type: :utc_datetime)
    end

    create unique_index(:workstation_form_assignments,
             [:workstation_id, :form_template_id, :slot],
             name: :workstation_form_assignments_wid_tid_slot_index
           )

    create index(:workstation_form_assignments, [:workstation_id, :slot, :sort_order])
    create index(:workstation_form_assignments, [:form_template_id])

    create constraint(:workstation_form_assignments, :workstation_form_assignments_slot_valid,
             check: "slot IN ('workstation_start', 'workstation_end', 'cleaning')"
           )

    # Backfill from the three FK columns. Each existing FK becomes
    # one join row with sort_order = 0.
    execute(
      """
      INSERT INTO workstation_form_assignments
        (workstation_id, form_template_id, slot, sort_order, inserted_at, updated_at)
      SELECT id, workstation_start_form_template_id, 'workstation_start', 0, NOW(), NOW()
      FROM workstations
      WHERE workstation_start_form_template_id IS NOT NULL
      """,
      "" # no-op down
    )

    execute(
      """
      INSERT INTO workstation_form_assignments
        (workstation_id, form_template_id, slot, sort_order, inserted_at, updated_at)
      SELECT id, workstation_end_form_template_id, 'workstation_end', 0, NOW(), NOW()
      FROM workstations
      WHERE workstation_end_form_template_id IS NOT NULL
      """,
      ""
    )

    execute(
      """
      INSERT INTO workstation_form_assignments
        (workstation_id, form_template_id, slot, sort_order, inserted_at, updated_at)
      SELECT id, cleaning_form_template_id, 'cleaning', 0, NOW(), NOW()
      FROM workstations
      WHERE cleaning_form_template_id IS NOT NULL
      """,
      ""
    )

    alter table(:workstations) do
      remove :workstation_start_form_template_id, references(:form_templates)
      remove :workstation_end_form_template_id, references(:form_templates)
      remove :cleaning_form_template_id, references(:form_templates)
    end
  end
end
