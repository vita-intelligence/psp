defmodule Backend.Repo.Migrations.BackfillWorkstationsFromInstances do
  use Ecto.Migration

  @moduledoc """
  Backfill stub Workstation rows from every WorkstationGroup's
  `instances` field, then drop the column. Capacity becomes a derived
  fact: `count(workstations WHERE workstation_group_id = wsg.id AND is_active = true)`.

  Before this migration, a WSG carried a manual `instances` count that
  the FE form exposed but the scheduler ignored — so capacity wasn't
  enforced anywhere and two MOs could land on the same machine at the
  same time. Now the scheduler reads capacity from real Workstation
  rows, so the count has to live there.

  For every WSG with fewer Workstation children than its `instances`,
  we generate stub rows named `'{WSG name} #N'` starting from the next
  free index. Stubs are pinned to the company's first
  production_facility warehouse (Workstation requires a warehouse FK
  and the WSG doesn't carry one). Companies with no
  production_facility warehouse skip backfill — their capacity becomes
  zero until they create Workstation rows manually.

  One-way: `down` recreates the column with default 1, but the stub
  rows are indistinguishable from user-created rows so we don't
  attempt to delete them.
  """

  def up do
    execute """
    WITH grp AS (
      SELECT
        g.id AS group_id,
        g.company_id,
        g.name AS group_name,
        COALESCE(g.instances, 1) AS target,
        COALESCE(
          (SELECT COUNT(*)::int FROM workstations w
            WHERE w.workstation_group_id = g.id),
          0
        ) AS have,
        (SELECT w.id FROM warehouses w
          WHERE w.company_id = g.company_id
            AND w.kind = 'production_facility'
          ORDER BY w.id LIMIT 1) AS warehouse_id
      FROM workstation_groups g
    )
    INSERT INTO workstations (
      uuid, name, workstation_group_id, warehouse_id, company_id,
      hourly_rate_enabled, productivity, is_active, inserted_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      grp.group_name || ' #' || (grp.have + s.idx),
      grp.group_id,
      grp.warehouse_id,
      grp.company_id,
      false,
      1.0,
      true,
      NOW(),
      NOW()
    FROM grp
    JOIN generate_series(1, GREATEST(0, grp.target - grp.have)) AS s(idx) ON true
    WHERE grp.warehouse_id IS NOT NULL
    ON CONFLICT (company_id, name) DO NOTHING;
    """

    drop_if_exists constraint(:workstation_groups, :workstation_groups_instances_positive)

    alter table(:workstation_groups) do
      remove :instances
    end
  end

  def down do
    alter table(:workstation_groups) do
      add :instances, :integer, default: 1, null: false
    end

    create constraint(:workstation_groups, :workstation_groups_instances_positive,
             check: "instances >= 1"
           )
  end
end
