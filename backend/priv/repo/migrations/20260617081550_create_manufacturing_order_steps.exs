defmodule Backend.Repo.Migrations.CreateManufacturingOrderSteps do
  use Ecto.Migration

  @moduledoc """
  Per-MO snapshot of the routing's operations. Routing steps are the
  template; an MO step is the live instance — it carries everything
  the operator types or measures as the run actually happens (long
  description override, planned + actual times, applied overhead,
  per-step labor cost, quantity produced).

  Snapshot semantics: on MO create we copy the routing's steps row by
  row, including default workers. Later edits to the routing template
  do NOT bleed back into in-flight MOs.

  `routing_step_id` is kept for traceability (so audits can answer
  "which template did this come from") but uses `on_delete: :nilify_all`
  — the operator can still finish an MO whose template was removed.
  """

  def change do
    create table(:manufacturing_order_steps) do
      add :uuid, :uuid, null: false
      add :sort_order, :integer, default: 0, null: false

      add :operation_description, :text

      add :setup_time_min, :decimal, precision: 12, scale: 4
      add :cycle_time_min, :decimal, precision: 12, scale: 4

      add :fixed_cost, :decimal, precision: 14, scale: 4
      add :variable_cost, :decimal, precision: 14, scale: 4

      add :capacity, :decimal, precision: 14, scale: 4, default: 1.0, null: false

      # Schedule + execution columns. Planned values get a default on
      # snapshot (derived from MO start + setup + cycle × qty); operator
      # can override. Actual values are filled in by the execution layer
      # (or typed by hand on the modify-operation page).
      add :planned_start, :utc_datetime
      add :planned_finish, :utc_datetime
      add :actual_start, :utc_datetime
      add :actual_finish, :utc_datetime

      # Money columns in the company base currency, same precision
      # as PO lines so cross-context joins compare cleanly.
      add :applied_overhead_cost, :decimal, precision: 14, scale: 4
      add :labor_cost, :decimal, precision: 14, scale: 4

      # Actual produced quantity on this op (defaults to MO qty on
      # snapshot but partial runs / scrap let it diverge).
      add :quantity, :decimal, precision: 14, scale: 4

      # Optional per-step note kept on the row itself for the immutable
      # SOP / instruction line. The collaborative discussion lives in
      # the polymorphic Comments table (entity_type "manufacturing_order_step").
      add :notes, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false

      add :manufacturing_order_id,
          references(:manufacturing_orders, on_delete: :delete_all),
          null: false

      add :workstation_group_id,
          references(:workstation_groups, on_delete: :restrict),
          null: false

      # Traceability back to the template — nilify_all so removing
      # the routing template doesn't cascade-delete in-flight MOs'
      # operations.
      add :routing_step_id, references(:routing_steps, on_delete: :nilify_all)

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:manufacturing_order_steps, [:uuid])
    create index(:manufacturing_order_steps, [:manufacturing_order_id])
    create index(:manufacturing_order_steps, [:workstation_group_id])
    create index(:manufacturing_order_steps, [:routing_step_id])

    create constraint(:manufacturing_order_steps, :mo_steps_capacity_positive,
             check: "capacity > 0"
           )

    create constraint(:manufacturing_order_steps, :mo_steps_times_non_negative,
             check:
               "(setup_time_min IS NULL OR setup_time_min >= 0) AND " <>
                 "(cycle_time_min IS NULL OR cycle_time_min >= 0)"
           )

    create constraint(:manufacturing_order_steps, :mo_steps_costs_non_negative,
             check:
               "(fixed_cost IS NULL OR fixed_cost >= 0) AND " <>
                 "(variable_cost IS NULL OR variable_cost >= 0) AND " <>
                 "(applied_overhead_cost IS NULL OR applied_overhead_cost >= 0) AND " <>
                 "(labor_cost IS NULL OR labor_cost >= 0)"
           )

    # actual_finish must be >= actual_start when both are set.
    create constraint(:manufacturing_order_steps, :mo_steps_actual_order,
             check:
               "actual_finish IS NULL OR actual_start IS NULL OR " <>
                 "actual_finish >= actual_start"
           )

    # ----- per-step workers --------------------------------------

    create table(:manufacturing_order_step_workers) do
      add :manufacturing_order_step_id,
          references(:manufacturing_order_steps, on_delete: :delete_all),
          null: false

      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :company_id, references(:companies, on_delete: :restrict), null: false

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(
             :manufacturing_order_step_workers,
             [:manufacturing_order_step_id, :user_id],
             name: :mo_step_workers_pair_index
           )

    create index(:manufacturing_order_step_workers, [:user_id])
  end
end
