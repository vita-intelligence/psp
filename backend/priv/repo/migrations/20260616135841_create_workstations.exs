defmodule Backend.Repo.Migrations.CreateWorkstations do
  use Ecto.Migration

  @moduledoc """
  Workstations — individual machines / cells inside a workstation
  group on a production site. The future schedule + manufacturing
  orders consume time against these rows; performance reporting in
  vita-performance (sibling project) keys on `external_id`.

  Fields mirror MRPEasy's "Create a workstation" form plus the
  vita-performance sync hook:

    * `external_id` — nullable UUID, populated by the sync job when
      the workstation is mirrored into vita-performance's
      `Workstation.kiosk_token`. Lets either side address the same
      physical station without us bolting on a separate join table.
    * `workstation_group_id` — the "Type" in MRPEasy's UI.
    * `warehouse_id` — the "Site". Constrained to kind=production_facility
      via app-layer check (no DB constraint so the FK stays simple).
    * `productivity` — multiplier on theoretical throughput, default 1.0.
    * `hourly_rate_enabled` + `hourly_rate` — per-station override of the
      group's rate. When toggle off, scheduling reads the group rate.
    * `idle_from` + `idle_to` — single-window planned downtime
      (maintenance, refurb). Future passes can extend to a per-day
      override jsonb if needed.

  Default workers ride on a separate join (`workstation_default_workers`)
  so we don't need a schema migration to add / drop assignments.
  """

  def change do
    create table(:workstations) do
      add :uuid, :uuid, null: false
      # vita-performance sync hook — written by the sync job, NULL
      # until the workstation is mirrored. Unique when present.
      add :external_id, :uuid

      add :name, :string, size: 200, null: false
      add :notes, :text

      add :workstation_group_id,
          references(:workstation_groups, on_delete: :restrict),
          null: false

      # The hosting production-facility-kind warehouse. We check
      # `warehouses.kind == "production_facility"` in the context
      # layer (`Backend.Production.create_workstation/2`) rather
      # than constrain at the DB level — the column type stays a
      # straight integer FK so generic stock-placement code still
      # works without per-table casing.
      add :warehouse_id, references(:warehouses, on_delete: :restrict),
        null: false

      add :hourly_rate_enabled, :boolean, default: false, null: false
      add :hourly_rate, :decimal, precision: 12, scale: 4

      add :productivity, :decimal, precision: 6, scale: 4, default: 1.0, null: false

      add :idle_from, :date
      add :idle_to, :date

      add :is_active, :boolean, default: true, null: false

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:workstations, [:uuid])
    create unique_index(:workstations, [:external_id], where: "external_id IS NOT NULL")
    create index(:workstations, [:company_id])
    create index(:workstations, [:workstation_group_id])
    create index(:workstations, [:warehouse_id])
    create unique_index(:workstations, [:company_id, :name],
             name: :workstations_company_name_index
           )

    create constraint(:workstations, :workstations_productivity_positive,
             check: "productivity > 0"
           )

    create constraint(:workstations, :workstations_idle_window_valid,
             check: "(idle_from IS NULL AND idle_to IS NULL) OR " <>
                    "(idle_from IS NOT NULL AND idle_to IS NOT NULL AND idle_to >= idle_from)"
           )

    # M2M join for default workers — the operators the schedule
    # pre-fills on MOs running at this workstation. Order doesn't
    # matter (set semantics).
    create table(:workstation_default_workers) do
      add :workstation_id, references(:workstations, on_delete: :delete_all),
        null: false

      add :user_id, references(:users, on_delete: :delete_all), null: false
      # Denormalised so the audit log's company_id filter stays a
      # single-index lookup (same reason floors / locations carry it).
      add :company_id, references(:companies, on_delete: :restrict), null: false

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:workstation_default_workers, [:workstation_id, :user_id],
             name: :workstation_default_workers_pair_index
           )
    create index(:workstation_default_workers, [:user_id])
  end
end
