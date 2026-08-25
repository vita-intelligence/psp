defmodule Backend.Repo.Migrations.CascadeDeleteMoBomOverridesOnBomLine do
  use Ecto.Migration

  @moduledoc """
  Fix a pre-existing bad interaction between the integration BOM push
  and the mo_bom_overrides check constraint.

  `mo_bom_overrides.bom_line_id` was ON DELETE SET NULL. When
  vita-cff pushes a BOM update PSP treats it as a wholesale replace
  of every line — the old bom_lines rows are deleted, the new ones
  inserted. Any existing `removed` / `qty_changed` override for a
  replaced line has its `bom_line_id` set to NULL by the cascade,
  which violates the `edit_shape_matches_action` check
  (`removed` / `qty_changed` require `bom_line_id IS NOT NULL`) and
  rolls the whole push back.

  Symptom: `PspUnreachable: PSP returned HTTP 500 ... check_violation
  ... edit_shape_matches_action` on any project whose active MOs
  carry overrides when NPD pushes a BOM refresh.

  Fix: switch the FK to ON DELETE CASCADE. An override attached to a
  line that no longer exists in the master BOM has no meaning
  anyway — deleting the override is the correct semantic. The MO's
  effective-BOM projection already handles missing lines gracefully.
  """

  def up do
    execute("""
    ALTER TABLE mo_bom_overrides
      DROP CONSTRAINT mo_bom_overrides_bom_line_id_fkey,
      ADD CONSTRAINT mo_bom_overrides_bom_line_id_fkey
        FOREIGN KEY (bom_line_id) REFERENCES bom_lines(id) ON DELETE CASCADE
    """)
  end

  def down do
    execute("""
    ALTER TABLE mo_bom_overrides
      DROP CONSTRAINT mo_bom_overrides_bom_line_id_fkey,
      ADD CONSTRAINT mo_bom_overrides_bom_line_id_fkey
        FOREIGN KEY (bom_line_id) REFERENCES bom_lines(id) ON DELETE SET NULL
    """)
  end
end
