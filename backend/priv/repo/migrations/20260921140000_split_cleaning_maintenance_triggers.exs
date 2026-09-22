defmodule Backend.Repo.Migrations.SplitCleaningMaintenanceTriggers do
  @moduledoc """
  Rename the single-phase cleaning + maintenance triggers into their
  ``_end`` counterparts across every place that stores a trigger
  string. This is the data half of the workstation-parity refactor —
  once this lands, admins can also attach ``cleaning_start`` /
  ``maintenance_start`` / ``equipment_cleaning_start`` /
  ``equipment_maintenance_start`` templates for pre-session
  checklists that fire before the kiosk timer starts.

  Historical semantic of the old trigger names: forms with
  ``trigger="cleaning"`` fired at end-of-session (post-Stop form
  walk-through). Renaming to ``cleaning_end`` matches how the code
  already treats them + makes the two-phase model explicit.

  Tables touched:
    * form_templates.trigger + the ``form_templates_trigger_valid``
      CHECK constraint (widened to the full new enum, including all
      four ``_start`` phases).
    * workstation_form_assignments.slot
    * equipment_category_form_assignments.slot

  Reversible — the down migration flips the strings back and
  restores the previous constraint.
  """

  use Ecto.Migration

  @renames [
    {"cleaning", "cleaning_end"},
    {"maintenance", "maintenance_end"},
    {"equipment_cleaning", "equipment_cleaning_end"},
    {"equipment_maintenance", "equipment_maintenance_end"}
  ]

  # Full trigger vocabulary AFTER this migration. Mirrors
  # `Backend.Forms.FormTemplate.@triggers`.
  @new_check_values [
    "workstation_start",
    "workstation_end",
    "cleaning_start",
    "cleaning_end",
    "maintenance_start",
    "maintenance_end",
    "equipment_cleaning_start",
    "equipment_cleaning_end",
    "equipment_maintenance_start",
    "equipment_maintenance_end"
  ]

  @old_check_values [
    "workstation_start",
    "workstation_end",
    "cleaning"
  ]

  # Workstation-attached slots (excludes the equipment-scoped ones —
  # those live on ``equipment_category_form_assignments``).
  @new_ws_slots [
    "workstation_start",
    "workstation_end",
    "cleaning_start",
    "cleaning_end",
    "maintenance_start",
    "maintenance_end"
  ]

  @old_ws_slots ["workstation_start", "workstation_end", "cleaning"]

  def up do
    # Drop all three CHECKs before mutating rows so UPDATEs don't
    # trip stale gates. Recreate them at the end with the full new
    # vocabulary each.
    drop constraint(:form_templates, :form_templates_trigger_valid)

    drop_if_exists constraint(
                     :workstation_form_assignments,
                     :workstation_form_assignments_slot_valid
                   )

    drop_if_exists constraint(
                     :equipment_category_form_assignments,
                     :equipment_category_form_assignments_slot_valid
                   )

    Enum.each(@renames, fn {old, new} ->
      execute("UPDATE form_templates SET trigger = '#{new}' WHERE trigger = '#{old}';")

      execute(
        "UPDATE workstation_form_assignments SET slot = '#{new}' WHERE slot = '#{old}';"
      )

      execute(
        "UPDATE equipment_category_form_assignments SET slot = '#{new}' WHERE slot = '#{old}';"
      )
    end)

    trigger_values = Enum.map_join(@new_check_values, ", ", &"'#{&1}'")
    ws_values = Enum.map_join(@new_ws_slots, ", ", &"'#{&1}'")

    create constraint(:form_templates, :form_templates_trigger_valid,
             check: "trigger IN (#{trigger_values})"
           )

    create constraint(
             :workstation_form_assignments,
             :workstation_form_assignments_slot_valid,
             check: "slot IN (#{ws_values})"
           )

    # equipment_category_form_assignments never had a DB CHECK on
    # slot in the original migration — enforcement lives on the
    # changeset (`CategoryFormAssignment.@slots`). Nothing to
    # recreate on that table.
  end

  def down do
    drop constraint(:form_templates, :form_templates_trigger_valid)

    drop_if_exists constraint(
                     :workstation_form_assignments,
                     :workstation_form_assignments_slot_valid
                   )

    Enum.each(@renames, fn {old, new} ->
      execute("UPDATE form_templates SET trigger = '#{old}' WHERE trigger = '#{new}';")

      execute(
        "UPDATE workstation_form_assignments SET slot = '#{old}' WHERE slot = '#{new}';"
      )

      execute(
        "UPDATE equipment_category_form_assignments SET slot = '#{old}' WHERE slot = '#{new}';"
      )
    end)

    trigger_values = Enum.map_join(@old_check_values, ", ", &"'#{&1}'")
    ws_values = Enum.map_join(@old_ws_slots, ", ", &"'#{&1}'")

    create constraint(:form_templates, :form_templates_trigger_valid,
             check: "trigger IN (#{trigger_values})"
           )

    create constraint(
             :workstation_form_assignments,
             :workstation_form_assignments_slot_valid,
             check: "slot IN (#{ws_values})"
           )
  end
end
