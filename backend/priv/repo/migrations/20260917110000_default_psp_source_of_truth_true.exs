defmodule Backend.Repo.Migrations.DefaultPspSourceOfTruthTrue do
  use Ecto.Migration

  @moduledoc """
  Flip the ``workstations.psp_source_of_truth`` default from false →
  true, and back-fill every existing row.

  Historical intent: the flag was defensive — new workstations
  started "local only" so a half-configured PSP row wouldn't
  accidentally show up on the vita-performance kiosk before the
  operator had finished wiring workstation groups + cost fields.

  Actual usage: nobody remembers to flip it, so freshly-created
  workstations stay invisible to the kiosk forever. The confusion
  ("why is my station missing from the kiosk?") is more costly than
  the original defensive value, and the workstation form still has a
  "Local only" toggle for the rare case where you genuinely want to
  hide a station.

  Additive change — flips the default for future writes AND flips
  every existing row so the current tenants' catalogues appear on
  the kiosk without a per-workstation UI dance. Anyone who
  intentionally set a station to local-only will need to re-tick the
  toggle after this ships (rare on dev; document on prod deploy).
  """

  def up do
    alter table(:workstations) do
      modify :psp_source_of_truth, :boolean, default: true, null: false
    end

    execute "UPDATE workstations SET psp_source_of_truth = true WHERE psp_source_of_truth = false"
  end

  def down do
    alter table(:workstations) do
      modify :psp_source_of_truth, :boolean, default: false, null: false
    end
  end
end
