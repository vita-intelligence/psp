defmodule Backend.Repo.Migrations.RefreshSystemRolePermissions do
  use Ecto.Migration

  @doc """
  Refresh the permission arrays held by system roles (Owner / Admin /
  Member) so existing companies pick up newly-registered permission
  codes without manual intervention.

  Owner's array doesn't really matter (the `is_owner` bypass makes it
  full-access regardless), but we keep it in sync so the future
  "Permissions" admin UI shows a coherent grant set.

  Idempotent: re-running just rewrites the same values.
  """
  def up do
    all_perms = Backend.RBAC.Permissions.all()

    # Owner and Admin = every code in the registry
    repo().query!(
      "UPDATE roles SET permissions = $1, updated_at = NOW() WHERE slug IN ('owner', 'admin') AND is_system = true",
      [all_perms]
    )

    # Member = read-only baseline across every resource we know about
    member_perms = ~w(
      company.view
      users.view
      roles.view
      warehouses.view
    )

    repo().query!(
      "UPDATE roles SET permissions = $1, updated_at = NOW() WHERE slug = 'member' AND is_system = true",
      [member_perms]
    )
  end

  def down do
    # No-op — there's no meaningful "old" value to restore, since the
    # registry itself is the source of truth for what's current.
    :ok
  end
end
