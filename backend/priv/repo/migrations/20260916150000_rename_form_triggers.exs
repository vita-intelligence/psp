defmodule Backend.Repo.Migrations.RenameFormTriggers do
  @moduledoc """
  The `start_of_shift` / `end_of_shift` trigger names have always
  been misleading — they don't fire on shift clock-in / clock-out;
  they fire when a WorkSession starts / ends on the workstation the
  form is assigned to. Rename to make that honest.

    * `form_templates.trigger`: `start_of_shift` → `workstation_start`,
      `end_of_shift` → `workstation_end`. `cleaning` unchanged.
    * `workstations.start_of_shift_form_template_id` →
      `workstations.workstation_start_form_template_id`
    * `workstations.end_of_shift_form_template_id` →
      `workstations.workstation_end_form_template_id`

  Nothing is in production yet, so this is a straight rename — no
  legacy compat needed.
  """

  use Ecto.Migration

  def change do
    # Drop the old check constraint before mutating rows so the UPDATE
    # doesn't hit a stale gate.
    drop constraint(:form_templates, :form_templates_trigger_valid)

    execute(
      """
      UPDATE form_templates
         SET trigger = 'workstation_start'
       WHERE trigger = 'start_of_shift'
      """,
      """
      UPDATE form_templates
         SET trigger = 'start_of_shift'
       WHERE trigger = 'workstation_start'
      """
    )

    execute(
      """
      UPDATE form_templates
         SET trigger = 'workstation_end'
       WHERE trigger = 'end_of_shift'
      """,
      """
      UPDATE form_templates
         SET trigger = 'end_of_shift'
       WHERE trigger = 'workstation_end'
      """
    )

    create constraint(:form_templates, :form_templates_trigger_valid,
             check: "trigger IN ('workstation_start', 'workstation_end', 'cleaning')"
           )

    rename table(:workstations),
      :start_of_shift_form_template_id,
      to: :workstation_start_form_template_id

    rename table(:workstations),
      :end_of_shift_form_template_id,
      to: :workstation_end_form_template_id

    # Rename the FK constraints so pg_dump + schema-diff stays clean.
    execute(
      """
      ALTER TABLE workstations
        RENAME CONSTRAINT workstations_start_of_shift_form_template_id_fkey
                       TO workstations_workstation_start_form_template_id_fkey
      """,
      """
      ALTER TABLE workstations
        RENAME CONSTRAINT workstations_workstation_start_form_template_id_fkey
                       TO workstations_start_of_shift_form_template_id_fkey
      """
    )

    execute(
      """
      ALTER TABLE workstations
        RENAME CONSTRAINT workstations_end_of_shift_form_template_id_fkey
                       TO workstations_workstation_end_form_template_id_fkey
      """,
      """
      ALTER TABLE workstations
        RENAME CONSTRAINT workstations_workstation_end_form_template_id_fkey
                       TO workstations_end_of_shift_form_template_id_fkey
      """
    )

    execute(
      """
      ALTER INDEX workstations_start_of_shift_form_template_id_index
            RENAME TO workstations_workstation_start_form_template_id_index
      """,
      """
      ALTER INDEX workstations_workstation_start_form_template_id_index
            RENAME TO workstations_start_of_shift_form_template_id_index
      """
    )

    execute(
      """
      ALTER INDEX workstations_end_of_shift_form_template_id_index
            RENAME TO workstations_workstation_end_form_template_id_index
      """,
      """
      ALTER INDEX workstations_workstation_end_form_template_id_index
            RENAME TO workstations_end_of_shift_form_template_id_index
      """
    )
  end
end
