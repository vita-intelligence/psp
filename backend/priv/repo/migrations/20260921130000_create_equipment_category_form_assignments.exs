defmodule Backend.Repo.Migrations.CreateEquipmentCategoryFormAssignments do
  @moduledoc """
  Attach form templates to equipment categories — one assignment
  per (category × template × slot). Powers the "V-blender CIP
  checklist runs on every V-blender" reuse pattern.

  Parallel table to `workstation_form_assignments` but keyed on
  the equipment category, so a single form authored once fires on
  every equipment tagged with that category. Slot is the trigger
  the form serves — ``equipment_cleaning`` or
  ``equipment_maintenance``. When a form template has a
  workstation-scoped trigger (``workstation_start`` / _end /
  ``cleaning`` / ``maintenance``), it MUST NOT be attached here —
  enforced at the context boundary.

  On-delete: ``:nilify_all`` on the template FK so archiving a
  template doesn't cascade-break categories. ``:restrict`` on the
  category FK so archiving a category with attachments is a two-
  step (detach first, then archive) — matches the workstation-
  side ergonomics.
  """

  use Ecto.Migration

  def change do
    create table(:equipment_category_form_assignments) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :equipment_category_id,
          references(:equipment_categories, on_delete: :restrict),
          null: false
      add :form_template_id,
          references(:form_templates, on_delete: :nilify_all),
          null: false

      # Slot enum — matches Backend.Forms.FormTemplate.@equipment_scoped_triggers.
      # Enforced at the changeset layer, not by a DB CHECK, so the
      # vocabulary is extensible without a migration.
      add :slot, :string, size: 32, null: false

      # Kiosk walks forms in this order per slot when the machine
      # is picked on a cleaning / maintenance session.
      add :sort_order, :integer, default: 0, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:equipment_category_form_assignments, [:uuid])

    create unique_index(
             :equipment_category_form_assignments,
             [:company_id, :equipment_category_id, :form_template_id, :slot],
             name: :ec_form_assignments_company_cat_tpl_slot_index
           )

    create index(:equipment_category_form_assignments, [:equipment_category_id])
    create index(:equipment_category_form_assignments, [:form_template_id])
  end
end
