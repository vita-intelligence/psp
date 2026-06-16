defmodule Backend.Repo.Migrations.CreateRoutings do
  use Ecto.Migration

  @moduledoc """
  Routings — ordered list of operations against workstation groups
  that turns a BOM's inputs into a finished item. Each routing belongs
  to one Item (the output product); the optional `bom_id` FK is the
  "Connected BOM" toggle from MRPEasy: when set, the routing is
  scoped to that specific BOM recipe; when NULL it applies to the
  item generally.

  `routing_steps` is the ordered operations table. Each step:
    * references one workstation_group (the "Type" column on the form)
    * carries setup/cycle time in minutes (decimal so half-minute
      cycles still scale cleanly)
    * carries fixed + variable cost in the company's base currency
    * carries a capacity multiplier (defaults to 1 — "each" cycle
      produces one output unit)
    * has free-text operation_description for SOP notes
    * has multiple default workers via `routing_step_workers` M2M

  Wholesale-replace pattern on save (like BOM lines): the FE sends
  the full step list, the BE wipes + reinserts inside one transaction
  so audit captures a single update event.
  """

  def change do
    create table(:routings) do
      add :uuid, :uuid, null: false
      add :name, :string, size: 200, null: false
      add :notes, :text
      add :is_active, :boolean, default: true, null: false

      add :company_id, references(:companies, on_delete: :restrict), null: false

      # Output item — same `:restrict` rationale as BOM: orphaning the
      # FK would silently break every MO ever run.
      add :item_id, references(:items, on_delete: :restrict), null: false

      # Optional connected BOM. NULL means "applies to any BOM for
      # this item". Restrict on delete so removing a BOM doesn't
      # silently unlink active routings — operators handle the
      # transition deliberately.
      add :bom_id, references(:boms, on_delete: :restrict)

      # "Other" cost row at the bottom of the MRPEasy form — fixed
      # cost not tied to a specific step + variable cost per output
      # batch divisor.
      add :other_fixed_cost, :decimal, precision: 14, scale: 4
      add :other_variable_cost, :decimal, precision: 14, scale: 4
      add :other_variable_cost_basis, :decimal,
        precision: 14,
        scale: 4,
        default: 1.0

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:routings, [:uuid])
    create index(:routings, [:company_id])
    create index(:routings, [:item_id])
    create index(:routings, [:bom_id])

    # One name per company keeps the search + dropdown UX sane.
    create unique_index(:routings, [:company_id, :name],
             name: :routings_company_name_index
           )

    # ----- steps ----------------------------------------------------

    create table(:routing_steps) do
      add :uuid, :uuid, null: false
      add :sort_order, :integer, default: 0, null: false

      add :operation_description, :text

      # Times in minutes. precision: 12 / scale: 4 so a step like
      # "0.018 min" (~1 second) keeps its fidelity without rounding.
      add :setup_time_min, :decimal, precision: 12, scale: 4
      add :cycle_time_min, :decimal, precision: 12, scale: 4

      # Costs in the company's base currency. Same precision as PO
      # line money so cross-context joins compare cleanly.
      add :fixed_cost, :decimal, precision: 14, scale: 4
      add :variable_cost, :decimal, precision: 14, scale: 4

      # MRPEasy "Capacity" — how many output units one cycle covers.
      # Default 1 = "each" cycle produces one unit.
      add :capacity, :decimal, precision: 14, scale: 4, default: 1.0, null: false

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :routing_id, references(:routings, on_delete: :delete_all), null: false

      add :workstation_group_id,
          references(:workstation_groups, on_delete: :restrict),
          null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:routing_steps, [:uuid])
    create index(:routing_steps, [:routing_id])
    create index(:routing_steps, [:workstation_group_id])

    create constraint(:routing_steps, :routing_steps_capacity_positive,
             check: "capacity > 0"
           )

    create constraint(:routing_steps, :routing_steps_times_non_negative,
             check:
               "(setup_time_min IS NULL OR setup_time_min >= 0) AND " <>
                 "(cycle_time_min IS NULL OR cycle_time_min >= 0)"
           )

    # ----- step workers --------------------------------------------

    create table(:routing_step_workers) do
      add :routing_step_id, references(:routing_steps, on_delete: :delete_all),
        null: false

      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :company_id, references(:companies, on_delete: :restrict), null: false

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:routing_step_workers, [:routing_step_id, :user_id],
             name: :routing_step_workers_pair_index
           )

    create index(:routing_step_workers, [:user_id])
  end
end
