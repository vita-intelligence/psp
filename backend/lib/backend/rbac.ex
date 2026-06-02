defmodule Backend.RBAC do
  @moduledoc """
  Boundary for role-based access control: permission checks, role
  CRUD, system-role seeding.

  Every endpoint that mutates state must run through
  `require_permission/2` (the plug) or call `has_permission?/2`
  directly. Owner role bypasses every check — there must be exactly
  one Owner per company, enforced at the seed layer.
  """

  import Ecto.Query, warn: false

  alias Backend.Repo
  alias Backend.Accounts.User
  alias Backend.RBAC.{Role, Permissions}

  ## Bootstrap --------------------------------------------------------

  @doc """
  Seed the three default roles for a freshly-created company:

    * **Owner** — bypasses every check; holds the all-permissions array
      anyway so the future UI can render its grant set.
    * **Admin** — every permission today, no Owner bypass.
    * **Member** — read-only baseline (view company + view team).
  """
  def seed_system_roles!(company) do
    all = Permissions.all()

    {:ok, owner} =
      %Role{}
      |> Role.changeset(%{
        company_id: company.id,
        name: "Owner",
        slug: "owner",
        description: "Full access — bypasses every permission check.",
        is_system: true,
        is_owner: true,
        permissions: all
      })
      |> Repo.insert()

    {:ok, _admin} =
      %Role{}
      |> Role.changeset(%{
        company_id: company.id,
        name: "Admin",
        slug: "admin",
        description: "Full access without the Owner bypass.",
        is_system: true,
        is_owner: false,
        permissions: all
      })
      |> Repo.insert()

    {:ok, _member} =
      %Role{}
      |> Role.changeset(%{
        company_id: company.id,
        name: "Member",
        slug: "member",
        description: "Default read-only baseline.",
        is_system: true,
        is_owner: false,
        permissions: ["company.view", "users.view", "roles.view"]
      })
      |> Repo.insert()

    {:ok, owner}
  end

  ## Lookups ----------------------------------------------------------

  def get_role!(id), do: Repo.get!(Role, id)
  def get_role_by_slug(company_id, slug) when is_binary(slug) do
    Repo.get_by(Role, company_id: company_id, slug: slug)
  end

  def list_roles(company_id) do
    Role
    |> where([r], r.company_id == ^company_id)
    |> order_by([r], asc: r.is_owner == false, asc: r.name)
    |> Repo.all()
  end

  ## Assignment -------------------------------------------------------

  @doc """
  Attach `role` to `user` (idempotent — calling twice is a no-op).
  Returns `{:ok, user}` with roles preloaded.
  """
  def assign_role(%User{} = user, %Role{} = role) do
    Repo.insert_all(
      "user_roles",
      [%{user_id: user.id, role_id: role.id}],
      on_conflict: :nothing
    )

    {:ok, user |> Repo.preload(:roles, force: true)}
  end

  def user_with_roles(user_id) do
    User
    |> where([u], u.id == ^user_id)
    |> preload(:roles)
    |> Repo.one()
  end

  ## Permission checks ------------------------------------------------

  @doc """
  Returns the deduped union of permission codes for the user across
  every role they hold. Owner short-circuits to the full registry.
  """
  def effective_permissions(%User{} = user) do
    user = ensure_roles_loaded(user)

    cond do
      Enum.any?(user.roles, & &1.is_owner) ->
        Permissions.all()

      true ->
        user.roles
        |> Enum.flat_map(& &1.permissions)
        |> Enum.uniq()
        |> Enum.sort()
    end
  end

  @doc """
  True if the user has the given permission. Owner role bypasses; any
  matching code in any held role grants. Unknown user → false.
  """
  def has_permission?(nil, _), do: false

  def has_permission?(%User{} = user, code) when is_binary(code) do
    user = ensure_roles_loaded(user)

    cond do
      Enum.any?(user.roles, & &1.is_owner) -> true
      true -> Enum.any?(user.roles, fn r -> code in r.permissions end)
    end
  end

  defp ensure_roles_loaded(%User{} = user) do
    case user.roles do
      %Ecto.Association.NotLoaded{} -> Repo.preload(user, :roles)
      _ -> user
    end
  end
end
