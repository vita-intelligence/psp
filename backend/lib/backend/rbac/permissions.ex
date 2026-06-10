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

  # Unit of measurement registry — global units (kg, mL, pcs, …) used
  # by stock + recipes. View is split from manage because every
  # operator reads the list (pickers), but only admins should be able
  # to add/edit/delete the company-wide vocabulary.
  @units [
    {"units.view", "View the company unit-of-measurement registry"},
    {"units.manage", "Create, edit, and delete units of measurement"}
  ]

  # Stock items — raw materials, semi-finished, finished products,
  # packaging. Read/create/edit/delete are split because operators
  # need to read for stock moves and BOMs but only specific roles
  # should change the catalogue.
  @items [
    {"items.view", "View stock items"},
    {"items.create", "Create new stock items"},
    {"items.edit", "Edit stock items"},
    {"items.delete", "Delete stock items"}
  ]

  # Product families and the AttributeDefinition admin tool sit
  # behind a single admin-level permission — both are catalogue
  # shape concerns rather than per-row operational changes.
  @catalogues [
    {"product_families.manage", "Create, edit, and delete product families"},
    {"attribute_definitions.manage", "Create, edit, and delete custom attribute definitions"}
  ]

  # Risk assessment is intentionally separate from items.edit so a
  # senior QA can hold the override gate even when ops can edit
  # item identity.
  @risk_assessments [
    {"risk_assessments.view", "View raw-material risk assessments"},
    {"risk_assessments.create", "Create / update risk assessments"},
    {"risk_assessments.approve", "Override the computed risk level (with justification)"}
  ]

  @certificates [
    {"certificates.view", "View supplier / ingredient certificates"},
    {"certificates.manage", "Create, edit, and delete certificates"}
  ]

  # Stock operations — lots, placements, movements. View is the read
  # baseline (lot list + detail + movement history). Receive lets the
  # operator create manual lots; Move and Adjust each carry their own
  # gate so an audit of "who moved what" stays distinct from "who
  # adjusted a stock-take count". Edit (lot identity + packaging) and
  # Dispose are separate seniority gates.
  @stock [
    {"stock.view", "View stock lots, placements, and movement history"},
    {"stock.receive", "Receive new lots (manual create)"},
    {"stock.edit", "Edit lot identity + packaging dimensions"},
    {"stock.move", "Move stock between cells"},
    {"stock.adjust", "Manually adjust qty (stock-take corrections, shrinkage)"},
    {"stock.dispose", "Dispose of stock"}
  ]

  def all do
    Enum.map(
      @company ++
        @users ++
        @roles ++
        @warehouses ++
        @storage_tags ++
        @units ++
        @items ++
        @catalogues ++
        @risk_assessments ++
        @certificates ++
        @stock,
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
      storage_tags: @storage_tags,
      units: @units,
      items: @items,
      catalogues: @catalogues,
      risk_assessments: @risk_assessments,
      certificates: @certificates,
      stock: @stock
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
          },
          %{
            key: "units_of_measurement",
            label: "Units of measurement",
            description:
              "Global unit registry — mass, volume, count, length. Drives stock + recipe conversions.",
            read: "units.view",
            create: "units.manage",
            update: "units.manage",
            delete: "units.manage"
          }
        ]
      },
      %{
        section: "Catalogue",
        resources: [
          %{
            key: "items",
            label: "Stock items",
            description:
              "Raw materials, semi-finished, finished products, packaging. Carries the regulatory compliance subtables.",
            read: "items.view",
            create: "items.create",
            update: "items.edit",
            delete: "items.delete"
          },
          %{
            key: "product_families",
            label: "Product families",
            description:
              "Marketing-level grouping of variant SKUs (e.g. Vitamin D 30/60/90).",
            read: nil,
            create: "product_families.manage",
            update: "product_families.manage",
            delete: "product_families.manage"
          },
          %{
            key: "attribute_definitions",
            label: "Custom attribute definitions",
            description:
              "Admin-extensible typed custom fields per item type. Values stored on items.attributes JSONB.",
            read: nil,
            create: "attribute_definitions.manage",
            update: "attribute_definitions.manage",
            delete: "attribute_definitions.manage"
          },
          %{
            key: "risk_assessments",
            label: "Risk assessments",
            description:
              "TACCP / VACCP / HACCP scorecards on raw materials. `Approve` gates the override on the computed level.",
            read: "risk_assessments.view",
            create: "risk_assessments.create",
            update: "risk_assessments.create",
            delete: nil
          },
          %{
            key: "certificates",
            label: "Certificates",
            description:
              "Supplier and ingredient certificates (organic, halal, GMP, ISO 22000, etc.).",
            read: "certificates.view",
            create: "certificates.manage",
            update: "certificates.manage",
            delete: "certificates.manage"
          }
        ]
      },
      %{
        section: "Operations",
        resources: [
          %{
            key: "stock_lots",
            label: "Stock lots",
            description:
              "Received batches with placements, movements, and packaging dims.",
            read: "stock.view",
            create: "stock.receive",
            update: "stock.edit",
            delete: nil
          },
          %{
            key: "stock_movements",
            label: "Stock movements",
            description:
              "Between-cell moves and manual qty adjustments (stock-take, shrinkage).",
            read: "stock.view",
            create: "stock.move",
            update: "stock.adjust",
            delete: "stock.dispose"
          }
        ]
      }
    ]
  end
end
