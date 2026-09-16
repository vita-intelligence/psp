defmodule Backend.Repo.Migrations.CreateEquipmentRepairs do
  @moduledoc """
  Reactive-breakdown record for equipment. Distinct from preventive
  maintenance tasks — a repair captures an UNPLANNED failure event
  with downtime, cost, actions taken, and any spare parts consumed
  (linked back to the items catalog so material draw-down flows into
  procurement's usage stats).

  Modelled on ERPNext's Asset Repair + Asset Repair Consumed Item
  pair, minus the accounting/journal-entry pieces (PSP has no GL
  today). Repairs still emit an ``equipment_events`` row so the
  timeline shows failure → repair-in-progress → completion.
  """

  use Ecto.Migration

  def change do
    create table(:equipment_repairs) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :equipment_id, references(:equipment, on_delete: :delete_all), null: false

      # Failure occurred at → tech started → tech finished. The
      # difference between started_at (or failure_date when the tech
      # never started tracking) and completion_date is the downtime
      # window. `downtime_minutes` is a cached scalar so the
      # dashboard doesn't recompute per row.
      add :failure_date, :utc_datetime, null: false
      add :started_at, :utc_datetime
      add :completion_date, :utc_datetime
      add :downtime_minutes, :integer

      add :status, :string, size: 32, null: false, default: "reported"

      # Symptom the operator reported vs. what was actually done.
      # Separating the two keeps a clean root-cause vs remediation
      # split for post-mortems.
      add :description, :text
      add :actions_performed, :text

      # Direct labour + external service cost (invoices come in via
      # /po flow separately; a repair can be capitalised into the
      # asset's book value once we add depreciation math).
      add :repair_cost, :decimal, precision: 14, scale: 2
      add :currency, :string, size: 3

      # Who did the work — internal user OR free-text vendor.
      add :assigned_to_user_id, references(:users, on_delete: :nilify_all)
      add :external_vendor_name, :string, size: 200

      # Optional link to an equipment_events row so the timeline can
      # cross-reference back into the structured repair record.
      add :equipment_event_id, references(:equipment_events, on_delete: :nilify_all)

      add :notes, :text

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)
      timestamps(type: :utc_datetime)
    end

    create index(:equipment_repairs, [:equipment_id])
    create index(:equipment_repairs, [:company_id])
    create index(:equipment_repairs, [:status])
    create index(:equipment_repairs, [:failure_date])
    create unique_index(:equipment_repairs, [:uuid])

    # Parts consumed during the repair — each row draws down against a
    # catalog item (bearings, motor brushes, hydraulic oil…). Unit cost
    # is snapshotted at consume time so a later price change doesn't
    # rewrite the repair's historical total.
    create table(:equipment_repair_parts) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :repair_id, references(:equipment_repairs, on_delete: :delete_all), null: false
      add :item_id, references(:items, on_delete: :restrict), null: false

      add :quantity, :decimal, precision: 14, scale: 5, null: false
      add :unit_cost, :decimal, precision: 14, scale: 4
      add :currency, :string, size: 3

      add :notes, :text

      add :created_by_id, references(:users, on_delete: :nilify_all)
      timestamps(type: :utc_datetime)
    end

    create index(:equipment_repair_parts, [:repair_id])
    create index(:equipment_repair_parts, [:item_id])
    create unique_index(:equipment_repair_parts, [:uuid])
  end
end
