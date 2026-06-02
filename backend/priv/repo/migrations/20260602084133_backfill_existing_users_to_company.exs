defmodule Backend.Repo.Migrations.BackfillExistingUsersToCompany do
  use Ecto.Migration

  @disable_ddl_transaction true
  @disable_migration_lock true

  @doc """
  Backfill existing users into the singleton Company + assign Owner.

  Pure SQL on purpose — keeps the migration runnable without booting
  the full app (which it can't, since it migrates the very schemas
  the app expects). Idempotent: re-running is safe.

  After this migration:
    * exactly one row in `companies`
    * three system roles (owner / admin / member)
    * every existing user has `company_id` set
    * the earliest-registered user holds the Owner role
    * everyone else holds Member
  """
  def up do
    company_name = System.get_env("PSP_COMPANY_NAME", "Vita Manufacture Limited")

    repo().query!(
      """
      INSERT INTO companies (name, inserted_at, updated_at)
      VALUES ($1, NOW(), NOW())
      ON CONFLICT (name) DO NOTHING
      """,
      [company_name]
    )

    %{rows: [[company_id]]} =
      repo().query!("SELECT id FROM companies WHERE name = $1 LIMIT 1", [company_name])

    all_perms =
      Backend.RBAC.Permissions.all()

    insert_role!(company_id, "Owner", "owner", "Full access — bypasses every permission check.", true, true, all_perms)
    insert_role!(company_id, "Admin", "admin", "Full access without the Owner bypass.", true, false, all_perms)
    insert_role!(company_id, "Member", "member", "Default read-only baseline.", true, false, ~w(company.view users.view roles.view))

    repo().query!(
      "UPDATE users SET company_id = $1 WHERE company_id IS NULL",
      [company_id]
    )

    # Earliest user → Owner; everyone else → Member.
    %{rows: rows} =
      repo().query!(
        "SELECT id FROM users WHERE company_id = $1 ORDER BY inserted_at ASC",
        [company_id]
      )

    case rows do
      [] ->
        :ok

      [[owner_id] | rest] ->
        assign_role!(company_id, owner_id, "owner")

        for [user_id] <- rest do
          assign_role!(company_id, user_id, "member")
        end
    end
  end

  def down do
    # Backfill is irreversible — destructive rollback would mean
    # deleting roles + nullifying foreign keys. Use the schema
    # migration's `down` to drop the tables instead.
    :ok
  end

  defp insert_role!(company_id, name, slug, description, is_system, is_owner, perms) do
    repo().query!(
      """
      INSERT INTO roles (company_id, name, slug, description, is_system, is_owner, permissions, inserted_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (company_id, slug) DO NOTHING
      """,
      [company_id, name, slug, description, is_system, is_owner, perms]
    )
  end

  defp assign_role!(company_id, user_id, slug) do
    repo().query!(
      """
      INSERT INTO user_roles (user_id, role_id, assigned_at)
      SELECT $1, r.id, NOW()
      FROM roles r
      WHERE r.company_id = $2 AND r.slug = $3
      ON CONFLICT DO NOTHING
      """,
      [user_id, company_id, slug]
    )
  end
end
