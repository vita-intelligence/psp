defmodule Backend.Repo.Migrations.AddCompanyIdToFloorsAndLocations do
  use Ecto.Migration

  @moduledoc """
  Hotfix for the plan-editor phase 1/2.

  `audit_events.company_id` is NOT NULL — the Audit module reads
  `company_id` straight off the entity being recorded. Floors and
  storage locations didn't carry the column (only `warehouse_id`),
  so the audit insert exploded on the first floor creation.

  Denormalising `company_id` onto both child tables mirrors the
  `warehouse_id` denormalisation we already did for storage_locations
  (audit / list queries become single-index lookups). Backfill from
  the parent warehouse, then mark NOT NULL.
  """

  def up do
    for tbl <- ~w(warehouse_floors storage_locations) do
      execute("""
      ALTER TABLE #{tbl}
        ADD COLUMN IF NOT EXISTS company_id bigint
          REFERENCES companies(id) ON DELETE CASCADE
      """)

      # Backfill from the parent warehouse. Both tables already carry
      # warehouse_id so the join is cheap.
      execute("""
      UPDATE #{tbl} c
      SET company_id = w.company_id
      FROM warehouses w
      WHERE c.warehouse_id = w.id
        AND c.company_id IS NULL
      """)

      execute("ALTER TABLE #{tbl} ALTER COLUMN company_id SET NOT NULL")
      execute(
        "CREATE INDEX IF NOT EXISTS #{tbl}_company_id_index ON #{tbl} (company_id)"
      )
    end
  end

  def down do
    for tbl <- ~w(warehouse_floors storage_locations) do
      execute("DROP INDEX IF EXISTS #{tbl}_company_id_index")
      alter table(tbl) do
        remove_if_exists(:company_id, :bigint)
      end
    end
  end
end
