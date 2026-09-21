defmodule Backend.Repo.Migrations.AddCleaningCadenceToEquipment do
  @moduledoc """
  Give every piece of equipment its own cleaning cadence + cached
  scalars, in the same shape workstations already carry. The two
  levels of cleaning are auditor-distinct: cleaning a workstation
  ("the cell was wiped down between two MOs") is NOT the same as
  cleaning the machine on it ("the V-blender was CIP'd on Tuesday
  before the next batch"). BRCGS / FSSC 22000 audits ask about each
  independently, so each level tracks its own last-done + next-due.

  History lives on ``equipment_events`` (kind = ``cleaning_completed``,
  added on the application layer — the DB doesn't enforce the enum).
  """

  use Ecto.Migration

  def change do
    alter table(:equipment) do
      add :cleaning_periodicity, :string, size: 32
      add :cleaning_periodicity_interval, :integer

      add :last_cleaning_at, :utc_datetime
      add :next_cleaning_due_at, :date
    end

    create index(:equipment, [:next_cleaning_due_at])
  end
end
