defmodule Backend.Repo.Migrations.CreateMachines do
  use Ecto.Migration

  @moduledoc """
  Machines — physical assets attached to a Workstation. Distinct from
  the Workstation itself because a single station may host multiple
  machines (e.g. two mixers on the same weighing bench) and each has
  its own hourly running cost, asset tag, and calibration schedule.

  Cost cascade (implemented in Backend.Production.Costing):

      SUM(active_machines.hourly_rate)  when the station has ≥1 rate-enabled
                                        machine attached
      → workstation.hourly_rate         (station override)
      → workstation_group.hourly_rate   (group default)
      → 0

  Calibration fields track BRCGS 3.5.1 / FSSC 22000 audit requirements
  — an out-of-cal scale on a food-safety-critical weigh step is an
  audit finding. Overdue-badge on the ledger + Recalibrate action
  handled in the context layer.
  """

  def change do
    create table(:machines) do
      add :uuid, :uuid, null: false

      add :name, :string, size: 200, null: false
      add :notes, :text

      # Attach to a workstation. Delete-restrict — you can't nuke a
      # workstation while machines still hang off it; archive them
      # first. Matches the workstation → group behaviour.
      add :workstation_id, references(:workstations, on_delete: :restrict),
        null: false

      # Machine-level cost per hour. Same override pattern as workstations:
      # toggle off ⇒ this machine contributes £0 to the cascade sum.
      add :hourly_rate_enabled, :boolean, default: false, null: false
      add :hourly_rate, :decimal, precision: 12, scale: 4

      # Traceability / audit trail. All optional — a manual bench with
      # no meaningful serial doesn't need them.
      add :asset_tag, :string, size: 100
      add :serial_number, :string, size: 200
      add :manufacturer, :string, size: 200
      add :model, :string, size: 200

      # Calibration cadence. `calibration_frequency_months` drives the
      # auto-recompute of `next_calibration_due_at` on Recalibrate.
      # NULL = no calibration required (a plain conveyor).
      add :commissioned_at, :date
      add :last_calibrated_at, :date
      add :next_calibration_due_at, :date
      add :calibration_frequency_months, :integer

      add :is_active, :boolean, default: true, null: false

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:machines, [:uuid])
    create index(:machines, [:company_id])
    create index(:machines, [:workstation_id])
    create index(:machines, [:next_calibration_due_at],
             where: "next_calibration_due_at IS NOT NULL AND is_active = true",
             name: :machines_active_calibration_due_index
           )

    create unique_index(:machines, [:company_id, :name],
             name: :machines_company_name_index
           )

    # Asset tag unique per tenant when set — factories rely on the
    # sticker being unambiguous. NULL allowed for manual benches with
    # no tag.
    create unique_index(:machines, [:company_id, :asset_tag],
             where: "asset_tag IS NOT NULL",
             name: :machines_company_asset_tag_index
           )

    create constraint(:machines, :machines_hourly_rate_non_negative,
             check: "hourly_rate IS NULL OR hourly_rate >= 0"
           )

    create constraint(:machines, :machines_calibration_frequency_positive,
             check:
               "calibration_frequency_months IS NULL OR calibration_frequency_months > 0"
           )
  end
end
