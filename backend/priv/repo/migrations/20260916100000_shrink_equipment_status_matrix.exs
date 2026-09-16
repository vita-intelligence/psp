defmodule Backend.Repo.Migrations.ShrinkEquipmentStatusMatrix do
  @moduledoc """
  ERPNext-style consolidation. `under_maintenance` / `out_for_repair`
  / `awaiting_calibration` overlapped with the MaintenanceTasks +
  Repairs modules — an operator recording maintenance had to touch
  two places to keep the ledger honest. Retire those statuses and
  remap any existing rows to `in_service`; the operational-availability
  signal now comes from tasks + repairs, not the lifecycle status.
  """

  use Ecto.Migration

  def up do
    execute("""
    UPDATE equipment
       SET status = 'in_service'
     WHERE status IN ('under_maintenance', 'out_for_repair', 'awaiting_calibration')
    """)
  end

  def down do
    # No reverse migration — the old statuses no longer exist in the
    # application matrix, so remapping back would leave the app
    # unable to project or transition those rows.
    :ok
  end
end
