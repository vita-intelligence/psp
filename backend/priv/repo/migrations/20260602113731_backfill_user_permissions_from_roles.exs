defmodule Backend.Repo.Migrations.BackfillUserPermissionsFromRoles do
  use Ecto.Migration

  @disable_ddl_transaction true
  @disable_migration_lock true

  @doc """
  Backfill `users.is_admin` and `users.permissions` from the existing
  role assignments. The previous migration added the columns; this
  one does the data move so a re-run of the ALTER doesn't trip a
  "column already exists" error.

  Idempotent — re-running just rewrites the same derived values.
  """
  def up do
    # `is_admin` = the user holds any role with `is_owner = true`.
    repo().query!("""
    UPDATE users u
       SET is_admin = true
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = u.id
       AND r.is_owner = true
    """)

    # `permissions` = de-duped union of every code from every role
    # the user holds. Explicit cast keeps `varchar[]` ↔ `text[]`
    # type-checker happy.
    repo().query!("""
    UPDATE users u
       SET permissions = (
             SELECT ARRAY(
               SELECT DISTINCT UNNEST(r.permissions)
                 FROM user_roles ur
                 JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = u.id
             )::varchar[]
           )
     WHERE EXISTS (
             SELECT 1 FROM user_roles ur2 WHERE ur2.user_id = u.id
           )
    """)
  end

  def down do
    repo().query!("UPDATE users SET is_admin = false, permissions = ARRAY[]::varchar[]")
  end
end
