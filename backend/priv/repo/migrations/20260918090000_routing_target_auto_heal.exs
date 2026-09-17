defmodule Backend.Repo.Migrations.RoutingTargetAutoHeal do
  @moduledoc """
  Phase-1 schema for the routing-step auto-heal.

  Adds healed-target columns to `routing_steps` + `manufacturing_order_steps`
  so the nightly `RoutingHealer` job can write observed setup / cycle
  seconds without disturbing the planner-authored values. Costing +
  performance scoring read the healed values when present via
  `COALESCE`; when absent, behaviour is unchanged.

  Also creates `routing_heal_events` — one row per heal write. Feeds
  the audit drawer that answers "why did this target move?"
  """

  use Ecto.Migration

  def change do
    alter table(:routing_steps) do
      # Healed observations, in seconds (not minutes) so the DB values
      # match the units the healer's regression works in and vita-perf's
      # `override_target_duration` (hours-based) stays independent.
      add :actual_setup_seconds, :decimal, precision: 12, scale: 2
      add :actual_cycle_seconds, :decimal, precision: 12, scale: 4
      # How many completed WorkstationSessions fed the last heal —
      # confidence + UI banner both key off this.
      add :sample_size, :integer, default: 0, null: false
      # 0.0 – 1.0. Blends the healed value with the authored one when
      # the sample is small (R² × sample_size / (sample_size + 10)).
      add :confidence, :decimal, precision: 4, scale: 3
      # Planner freeze — routing intentionally out-of-touch with
      # reality (e.g. bug being fixed next week). Healer skips.
      add :manual_override_locked, :boolean, default: false, null: false
      add :heal_computed_at, :utc_datetime
    end

    alter table(:manufacturing_order_steps) do
      # Same fields snapshotted onto the per-MO step so a live MO's
      # session-scoring target doesn't shift mid-run when the parent
      # routing heals. Stamped from routing_step at MO creation and
      # re-stamped on the next heal only if the MO hasn't started yet.
      add :actual_setup_seconds, :decimal, precision: 12, scale: 2
      add :actual_cycle_seconds, :decimal, precision: 12, scale: 4
      add :sample_size, :integer, default: 0, null: false
      add :confidence, :decimal, precision: 4, scale: 3
      add :manual_override_locked, :boolean, default: false, null: false
      add :heal_computed_at, :utc_datetime
    end

    create table(:routing_heal_events) do
      add :routing_step_id,
          references(:routing_steps, on_delete: :delete_all),
          null: false

      add :company_id,
          references(:companies, on_delete: :delete_all),
          null: false

      add :from_setup_seconds, :decimal, precision: 12, scale: 2
      add :to_setup_seconds, :decimal, precision: 12, scale: 2
      add :from_cycle_seconds, :decimal, precision: 12, scale: 4
      add :to_cycle_seconds, :decimal, precision: 12, scale: 4

      add :sample_size, :integer, default: 0, null: false
      add :confidence, :decimal, precision: 4, scale: 3

      # "regression" | "median" | "insufficient_data" | "locked".
      # Explains at a glance why the heal took the shape it did.
      add :method, :string, size: 32, null: false

      add :window_days, :integer, default: 30, null: false
      add :computed_at, :utc_datetime, null: false, default: fragment("NOW()")
    end

    create index(:routing_heal_events, [:routing_step_id, :computed_at])
    create index(:routing_heal_events, [:company_id, :computed_at])
  end
end
