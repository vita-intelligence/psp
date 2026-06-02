defmodule Backend.Repo.Migrations.AddMatrixAccessToUsers do
  use Ecto.Migration

  @disable_ddl_transaction true
  @disable_migration_lock true

  @doc """
  Add the per-user matrix-permission columns. Data backfill of the
  existing role-derived perms happens in the sibling migration
  `BackfillUserPermissionsFromRoles` — keeping schema and data in
  separate migrations means each can be re-run on a partial-state
  database without tripping a "column already exists" error.

    * `is_admin`     — single bypass flag, true for the seed Owner.
    * `permissions`  — direct grant array; the new source of truth
                       for `has_permission?`.
    * `hourly_wage`  — admin-set decimal, NULL until filled in.

  Uses `IF NOT EXISTS` so a re-run on a partially-applied DB
  no-ops the column adds.
  """
  def up do
    execute("""
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_admin    boolean   NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS permissions varchar[] NOT NULL DEFAULT ARRAY[]::varchar[],
      ADD COLUMN IF NOT EXISTS hourly_wage numeric(10, 2)
    """)

    execute("CREATE INDEX IF NOT EXISTS users_is_admin_index ON users (is_admin)")
  end

  def down do
    execute("DROP INDEX IF EXISTS users_is_admin_index")

    execute("""
    ALTER TABLE users
      DROP COLUMN IF EXISTS is_admin,
      DROP COLUMN IF EXISTS permissions,
      DROP COLUMN IF EXISTS hourly_wage
    """)
  end
end
