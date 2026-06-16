defmodule Backend.Repo.Migrations.CreateWorkstationGroups do
  use Ecto.Migration

  # Workstation group — a named cluster of one or more identical
  # workstations (an oven bank, a packaging line, a blending station).
  #
  # Groups carry the production attributes shared by every workstation
  # inside them: kind (active vs passive processing), instance count,
  # hourly rate, optional overrides for working hours / holidays, plus
  # a colour for the schedule view. Individual workstations and their
  # link to operators land in a follow-up migration; this table is the
  # parent every workstation will reference.
  #
  # `kind` is constrained to two values for now — `active_processing`
  # (operator-driven; consumes labour) and `passive_processing`
  # (machine runs unattended after setup — ovens, curing, fermentation).
  # MRPEasy adds subcontracting and meeting types; we'll extend the
  # enum when those use cases appear.
  def change do
    create table(:workstation_groups) do
      add :uuid, :uuid, null: false
      add :name, :string, size: 200, null: false
      add :notes, :text
      add :instances, :integer, default: 1, null: false
      add :kind, :string, size: 40, null: false, default: "active_processing"

      # Hourly rate enabled toggle keeps the column nullable while
      # signalling intent: the operator deliberately ticked the box
      # rather than the default never being filled in. Pair lives in
      # the FE form as the checkbox shown in the MRPEasy screenshot.
      add :hourly_rate_enabled, :boolean, default: false, null: false
      add :hourly_rate, :decimal, precision: 12, scale: 4

      # Working hours / holidays overrides — when enabled, the group
      # ignores the company-level working_hours / holidays. The shape
      # of the jsonb mirrors `companies.working_hours` so the FE can
      # reuse the same editor.
      add :custom_working_hours, :boolean, default: false, null: false
      add :working_hours, :map, default: %{}
      add :custom_holidays, :boolean, default: false, null: false
      add :holidays, {:array, :date}, default: []

      add :color, :string, size: 16
      add :is_active, :boolean, default: true, null: false

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:workstation_groups, [:uuid])
    create index(:workstation_groups, [:company_id])
    # Names are unique per company so the schedule view can address a
    # group by a memorable label ("Capsulator A") without colliding.
    create unique_index(:workstation_groups, [:company_id, :name],
             name: :workstation_groups_company_name_index
           )

    create constraint(:workstation_groups, :workstation_groups_instances_positive,
             check: "instances >= 1"
           )

    create constraint(:workstation_groups, :workstation_groups_kind_known,
             check: "kind in ('active_processing', 'passive_processing')"
           )
  end
end
