defmodule Backend.Repo.Migrations.AddWorkstationIdToEquipment do
  @moduledoc """
  Phase B of the ERPNext-style consolidation. The old `machines`
  table overlapped with `equipment` — both tracked a physical
  serial-numbered unit belonging to a workstation. This adds the
  attachment link directly on equipment so we can retire the
  parallel machines table.

  `on_delete: :nilify_all` — if a workstation is deleted, the
  equipment survives detached; the operator can reassign or
  retire the unit independently.
  """

  use Ecto.Migration

  def change do
    alter table(:equipment) do
      add :workstation_id,
          references(:workstations, on_delete: :nilify_all),
          null: true
    end

    create index(:equipment, [:workstation_id])
  end
end
