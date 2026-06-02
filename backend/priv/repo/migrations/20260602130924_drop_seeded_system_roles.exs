defmodule Backend.Repo.Migrations.DropSeededSystemRoles do
  use Ecto.Migration

  @moduledoc """
  Wipe the seeded Owner/Admin/Member system roles and tear down the
  vestigial role-assignment machinery.

  Access is now per-user (`users.is_admin` + `users.permissions[]`).
  The `roles` table is repurposed as the home of admin-defined
  permission templates — a fresh-canvas feature that doesn't ship with
  starter rows. Side cleanup:

    * `user_roles` join table — no longer referenced; drop it.
    * `roles.is_owner` column — meaningful only on the legacy seeded
      Owner row; drop the column with the seeded rows.

  Forward-only: a rollback won't re-seed because the application no
  longer depends on the seeded rows.
  """

  def up do
    execute("DROP TABLE IF EXISTS user_roles")
    execute("DELETE FROM roles WHERE is_system = true")
    alter table(:roles) do
      remove_if_exists(:is_owner, :boolean)
    end
  end

  def down, do: :ok
end
