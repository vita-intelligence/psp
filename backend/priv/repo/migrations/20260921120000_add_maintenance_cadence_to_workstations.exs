defmodule Backend.Repo.Migrations.AddMaintenanceCadenceToWorkstations do
  @moduledoc """
  Mirror the cleaning cadence on workstations for maintenance. Same
  shape — periodicity enum + interval + cached ``last_maintenance_at``
  / ``next_maintenance_due_at`` scalars — so the kiosk can render
  due-soon chips + the /production/workstations/[uuid] detail page can
  answer "how often is this workstation maintained" without joining
  the events table on every read.

  History still lives on ``workstation_events`` (see the
  ``create_workstation_events`` migration in this bundle) — these
  fields are just the memo.
  """

  use Ecto.Migration

  def change do
    alter table(:workstations) do
      add :maintenance_periodicity, :string, size: 32
      add :maintenance_periodicity_interval, :integer

      add :last_maintenance_at, :utc_datetime
      add :next_maintenance_due_at, :date
    end

    create index(:workstations, [:next_maintenance_due_at])
  end
end
