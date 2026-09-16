defmodule Backend.Repo.Migrations.CreateEquipmentRunningCostComponents do
  @moduledoc """
  Per-equipment hourly running-cost line items. Each component
  represents one recurring cost the unit incurs *while it's
  operating* — electricity, compressed air, consumables,
  maintenance reserve, software licence, etc. The sum of active
  components is what feeds workstation cost roll-ups when the unit
  is attached to a workstation.

  Deliberately generic: we don't hard-code "electricity" or
  "amortisation" as fields. Operators can add whatever line items
  the cost model needs and label them however makes sense — a
  precision balance might have "Reference-weight service" but a
  forklift wouldn't; a capsule filler might have "Compressed air"
  but a laptop wouldn't.

  Also caches the running-total on `equipment.hourly_running_cost`
  so hot-path cost queries (workstation cost roll-up) don't need
  to join and sum per equipment row. The context module recomputes
  the cache on any component insert / update / delete.
  """

  use Ecto.Migration

  def change do
    create table(:equipment_running_cost_components) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :equipment_id, references(:equipment, on_delete: :delete_all), null: false

      # Short human label — "Electricity", "Compressed air",
      # "Maintenance reserve", "Software licence". Free-text; not a
      # lookup table because the vocabulary is small per company and
      # constrained by the operator, not by the app.
      add :label, :string, size: 120, null: false

      # Cost incurred per operating hour, in the currency below.
      # Decimal so 5-dp precision applies consistently with the rest
      # of the PSP quantity/cost surface.
      add :amount_per_hour, :decimal, precision: 14, scale: 5, null: false
      add :currency, :string, size: 3

      # Free-text explaining what the line covers so a future
      # operator understands the number (rate assumptions, source
      # of the estimate, formula behind an amortisation figure).
      add :notes, :text

      add :is_active, :boolean, null: false, default: true

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create index(:equipment_running_cost_components, [:equipment_id])
    create unique_index(:equipment_running_cost_components, [:uuid])

    # Cached rollup — SUM(amount_per_hour) across active components.
    # Populated / maintained by Backend.Equipment.RunningCosts.
    # Currency comes from the first active component's currency;
    # mixed-currency stacks are the operator's problem to reconcile.
    alter table(:equipment) do
      add :hourly_running_cost, :decimal, precision: 14, scale: 5
      add :hourly_running_cost_currency, :string, size: 3
    end
  end
end
