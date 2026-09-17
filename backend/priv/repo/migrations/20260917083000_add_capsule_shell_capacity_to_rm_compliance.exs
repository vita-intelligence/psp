defmodule Backend.Repo.Migrations.AddCapsuleShellCapacityToRmCompliance do
  use Ecto.Migration

  @moduledoc """
  Adds `max_fill_mg` + `shell_weight_mg` to `item_raw_material_compliance`.

  These two columns are meaningful only when `use_as = 'capsule_shell'`
  (the compliance sub-table is a good home because it's already the
  side-table that carries per-item traceability data). They replace
  the hardcoded `CAPSULE_SIZES` table that used to live in
  `vita-cff/apps/formulations/constants.py` — NPD now reads capacity
  and empty-shell mass off the PSP capsule shell item so the
  scientist can add / edit capsule sizes without a code deploy.

  Both columns are nullable — non-capsule-shell raw materials leave
  them empty, and even a capsule shell can exist in `draft` before
  the scientist fills the numbers.
  """

  def change do
    alter table(:item_raw_material_compliance) do
      add :max_fill_mg, :decimal, precision: 8, scale: 2
      add :shell_weight_mg, :decimal, precision: 8, scale: 2
    end
  end
end
