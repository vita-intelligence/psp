defmodule Backend.RBAC.Permissions do
  @moduledoc """
  Permission registry — the single source of truth for every action
  the platform recognises.

  A permission code is a `"<resource>.<action>"` string. Resources are
  the noun (`company`, `users`, `roles`); actions are the verb (`view`,
  `edit`, `invite`, `deactivate`, …). Keep codes stable forever —
  changing a code is a breaking change for every user holding it.

  The matrix presentation (resource rows × Read/Create/Update/Delete
  columns) is built from `matrix/0` — that's what the user-admin UI
  reads to draw the grid. New permissions land here AND in matrix/0.
  """

  @company [
    {"company.view", "View company settings"},
    {"company.edit", "Edit company settings"}
  ]

  @users [
    {"users.view", "View team members"},
    {"users.invite", "Invite new users"},
    {"users.deactivate", "Deactivate users"}
  ]

  # "roles" is the DB term — kept stable because changing perm codes is
  # a breaking change for everyone holding them. The UI surfaces them
  # as "Permission templates": named bundles of permission codes admins
  # can apply to a user with one click. No persistent user→template
  # link; applying just unions the codes into user.permissions.
  @roles [
    {"roles.view", "View permission templates"},
    {"roles.create", "Create new templates"},
    {"roles.edit", "Edit templates and apply them to users"},
    {"roles.delete", "Delete templates"}
  ]

  @warehouses [
    {"warehouses.view", "View warehouses"},
    {"warehouses.create", "Create new warehouses"},
    {"warehouses.edit", "Edit warehouse details, plans, and hours"},
    {"warehouses.delete", "Delete warehouses"}
  ]

  # Storage tag vocabulary — the company-wide classification labels
  # picked from the chip-picker on storage locations and cells. View
  # is implicit in `warehouses.view` (the picker reads it on every
  # plan-tab load); only the admin-level vocabulary management gets
  # its own permission because a warehouse operator shouldn't be
  # redefining the categories everyone else uses.
  @storage_tags [
    {"storage_tags.manage", "Manage the company-wide storage tag vocabulary"}
  ]

  def all do
    Enum.map(
      @company ++ @users ++ @roles ++ @warehouses ++ @storage_tags,
      &elem(&1, 0)
    )
  end

  @doc "Permissions grouped by resource for the future admin UI."
  def grouped do
    %{
      company: @company,
      users: @users,
      roles: @roles,
      warehouses: @warehouses,
      storage_tags: @storage_tags
    }
  end

  @doc "Check that a permission code is a known one."
  def valid?(code) when is_binary(code), do: code in all()
  def valid?(_), do: false

  @doc """
  The per-user access matrix — sections × resources × action columns.
  Each resource row maps the four canonical columns (read / create /
  update / delete) to a permission code, or to `nil` if that action
  doesn't apply to the resource.

  Frontend reads this and draws the grid. Keep additive — never rename
  a code or shuffle column meanings; downstream users hold the codes
  in their `permissions` array.
  """
  def matrix do
    [
      %{
        section: "Settings",
        resources: [
          %{
            key: "company",
            label: "Company settings",
            description: "Identity, locale, working hours, holidays, IPs.",
            read: "company.view",
            create: nil,
            update: "company.edit",
            delete: nil
          },
          %{
            key: "warehouses",
            label: "Warehouses",
            description: "Physical stock locations and their plans.",
            read: "warehouses.view",
            create: "warehouses.create",
            update: "warehouses.edit",
            delete: "warehouses.delete"
          },
          %{
            key: "users",
            label: "Users",
            description: "Team members — invites, access, deactivation.",
            read: "users.view",
            create: "users.invite",
            update: nil,
            delete: "users.deactivate"
          },
          %{
            key: "templates",
            label: "Permission templates",
            description: "Saved permission combos admins apply to users.",
            read: "roles.view",
            create: "roles.create",
            update: "roles.edit",
            delete: "roles.delete"
          },
          %{
            key: "storage_tags",
            label: "Storage tag vocabulary",
            description:
              "Company-wide classification labels used on storage locations and shelves (cold-zone, pallet, hazmat-3, etc.).",
            read: nil,
            create: "storage_tags.manage",
            update: "storage_tags.manage",
            delete: "storage_tags.manage"
          }
        ]
      }
    ]
  end
end
