defmodule Backend.Repo.Migrations.CreateEquipment do
  use Ecto.Migration

  # Equipment tracks individual physical units (mixers, forklifts,
  # scales, pH meters, tablets). Each row is one serial-numbered
  # unit — distinct from stock_lots which track qty-based batches
  # of consumables / raw materials / packaging.
  #
  # Origin trail runs through the same PO pipeline as consumables:
  # a PO line with an equipment-type item spawns N equipment rows
  # at goods-in (one per serial). `purchase_order_line_id` is the
  # link back to that origin PO. Nullable for legacy imports /
  # opening-balance data / donations.
  #
  # Location lives on `current_cell_id` (FK to storage_cells) so a
  # mixer "lives" in cell A-3-2 the same way a lot does. Nullable
  # for retired / disposed units and while an item is in transit
  # between cells.
  #
  # Cadence fields drive BRCGS 4.13 (calibration) + 4.11.6
  # (planned preventive maintenance) posture. `next_*_at` is
  # computed on completion of the respective event; the my-tasks
  # module surfaces upcoming + overdue as tasks in a follow-up PR.
  def change do
    create table(:equipment) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :restrict), null: false

      # The item this unit is an instance of — e.g. "Kenwood KM520
      # 5L mixer". Item's item_type must be "equipment"; the
      # context module enforces this before insert.
      add :item_id, references(:items, on_delete: :restrict), null: false

      # Unit identity. `serial_number` is what the operator scans /
      # types at goods-in. `manufacturer_serial` is the OEM's own
      # SN when it differs from ours (some sites relabel).
      add :serial_number, :string, size: 120, null: false
      add :manufacturer_serial, :string, size: 120
      add :manufacturer, :string, size: 120
      add :model, :string, size: 120

      # Lifecycle projection column (like stock_lots.status). Written
      # by the Backend.Equipment.Lifecycle module in response to
      # events; never edited directly by a controller.
      add :status, :string, size: 32, null: false, default: "expected"

      # Financials — carried forward from the PO line at receive
      # time. Depreciation runs off `useful_life_years` + `acquired_at`
      # + `unit_cost`; not computed here, exposed for a reports PR
      # to consume.
      add :unit_cost, :decimal, precision: 14, scale: 2
      add :currency, :string, size: 3
      add :acquired_at, :utc_datetime
      add :warranty_end_at, :date
      add :useful_life_years, :integer

      # Physical location + assignment. Location is a storage_cell
      # FK because equipment lives on the same warehouse-plan
      # schema as stock lots (a laptop is in cell "IT-STORE-1", a
      # mixer is in cell "PROD-A-3"). Assignment is optional and
      # only meaningful for a subset of equipment (laptops,
      # phones); most floor equipment lives in a cell without a
      # named owner.
      add :current_cell_id, references(:storage_cells, on_delete: :nilify_all)
      add :assigned_to_id, references(:users, on_delete: :nilify_all)

      # Origin PO line. Same shape as stock_lots.purchase_order_line_id
      # (nilify_all on delete so an audit-trail row survives).
      add :purchase_order_line_id,
        references(:purchase_order_lines, on_delete: :nilify_all)

      # Cadence — everything BRCGS 4.13 wants.
      add :calibration_frequency_months, :integer
      add :last_calibrated_at, :utc_datetime
      add :next_calibration_at, :utc_datetime
      add :maintenance_frequency_months, :integer
      add :last_maintenance_at, :utc_datetime
      add :next_maintenance_at, :utc_datetime

      # Terminal timestamps — populated on `retired` / `disposed`
      # lifecycle events. Kept as first-class columns (not just
      # events) so status projections + reports stay fast.
      add :retired_at, :utc_datetime
      add :disposed_at, :utc_datetime

      add :notes, :text

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    # Serial numbers are unique per company — the scan flow relies
    # on this to identify a unit unambiguously across sites.
    create unique_index(:equipment, [:company_id, :serial_number])
    create unique_index(:equipment, [:uuid])

    create index(:equipment, [:company_id])
    create index(:equipment, [:company_id, :status])
    create index(:equipment, [:item_id])
    create index(:equipment, [:current_cell_id])
    create index(:equipment, [:assigned_to_id])
    create index(:equipment, [:purchase_order_line_id])
    # Fast "what's due for calibration / maintenance in the next
    # N days" — the my-tasks projection uses these.
    create index(:equipment, [:company_id, :next_calibration_at])
    create index(:equipment, [:company_id, :next_maintenance_at])
  end
end
