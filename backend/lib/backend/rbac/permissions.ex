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

  # Machine-to-machine bearer tokens for external systems (currently
  # vita-performance). One permission for read + write because
  # rotating a token is the only lifecycle event and belongs to the
  # same operator who mints them.
  @integrations [
    {"integrations.manage",
     "Mint, list, and revoke integration tokens for external systems"}
  ]

  # Stock operations — lots, placements, movements. View is the read
  # baseline (lot list + detail + movement history). Receive lets the
  # operator create manual lots; Move and Adjust each carry their own
  # gate so an audit of "who moved what" stays distinct from "who
  # adjusted a stock-take count". Edit (lot identity + packaging),
  # Hold (operator-initiated pause), QC (verdict-of-record), and
  # Dispose are separate seniority gates because the regulator wants
  # to see who pressed which button.
  @stock [
    {"stock.view", "View stock lots, placements, and movement history"},
    {"stock.receive", "Receive new lots (manual create)"},
    {"stock.edit", "Edit lot identity + packaging dimensions"},
    {"stock.move", "Move stock between cells"},
    {"stock.adjust", "Manually adjust qty (stock-take corrections, shrinkage)"},
    {"stock.hold", "Put a lot on hold / release it back"},
    {"stock.qc", "Record QC verdicts (pass / fail / route to quarantine)"},
    {"stock.dispose", "Dispose of stock"}
  ]

  # Equipment registry — serial-tracked units. Separate scope from
  # stock because the lifecycle model differs (units, not qty).
  # `equipment.act` covers all lifecycle transitions in Slice 1
  # (put_in_service, moved, maintenance, calibrate, retire, dispose).
  # A follow-up PR may split calibration and maintenance if a shop
  # wants segregation between the two roles.
  @equipment [
    {"equipment.view", "View equipment registry + per-unit detail"},
    {"equipment.create", "Add new equipment units (manual entry / opening balance)"},
    {"equipment.act",
     "Record lifecycle events on equipment (put in service, maintenance, calibrate, move, retire, dispose)"}
  ]

  # Vendors (suppliers) — the registry POs draw from. View is the read
  # baseline. Edit lets the buyer maintain identity + commercial terms.
  # Approve is the GFSI/HARPC gate — only the vendor-qualification
  # owner (typically QA / procurement lead) can move a vendor into
  # "approved" status, which is what unblocks PO creation downstream.
  @vendors [
    {"vendors.view", "View vendor registry + per-vendor detail"},
    {"vendors.create", "Add new vendors to the registry"},
    {"vendors.edit", "Edit vendor identity, contacts, and commercial terms"},
    {"vendors.delete", "Delete vendors"},
    {"vendors.approve", "Approve / suspend / reject vendors (qualification gate)"}
  ]

  # Customers (sell-side) — the buyer mirror of vendors. View is the
  # read baseline. Edit covers identity + commercial terms + contact
  # rows + contact-event logging. Approve is the 4-eyes gate that
  # unblocks Customer Order creation downstream (a different user
  # from the creator must sign off — see Backend.Customers).
  @customers [
    {"customers.view", "View customer registry + per-customer detail"},
    {"customers.create", "Add new customers to the registry"},
    {"customers.edit",
     "Edit customer identity, contacts, commercial terms, and log contact events"},
    {"customers.delete", "Delete customers"},
    {"customers.approve",
     "Approve / reject customers (4-eyes gate — must differ from creator)"}
  ]

  # Pricelists — sell-side price quotes. View is the read baseline.
  # Edit covers the line items (per-item tiered selling prices) and
  # the header. Delete is split out so admins can hand it off without
  # giving edit. No approve gate by design — pricelists are "save =
  # live"; audit history captures who changed what.
  @pricelists [
    {"pricelists.view", "View pricelists + per-pricelist line items"},
    {"pricelists.create", "Add new pricelists"},
    {"pricelists.edit", "Edit pricelist header + line items"},
    {"pricelists.delete", "Delete pricelists"}
  ]

  # Customer orders — sell-side mirror of PO. Two-tier ESIGN
  # (approver + director) before a CO can be confirmed. Customer
  # approval + credit limit + per-customer approved-items list are
  # the gates enforced at submit time.
  @customer_orders [
    {"customer_orders.view", "View customer orders"},
    {"customer_orders.create",
     "Create + edit draft customer orders; cancel non-confirmed"},
    {"customer_orders.submit", "Submit a draft CO for approval"},
    {"customer_orders.approve", "Sign off as approver tier (1st of 2)"},
    {"customer_orders.director_approve",
     "Sign off as director tier (2nd of 2) + mark approved COs as confirmed"},
    {"customer_orders.delete", "Delete draft customer orders"}
  ]

  # Customer invoices — sell-side back-half of the order-to-cash flow.
  # No approval gate (different posture from CO); the gate that matters
  # is `send`, which validates customer approved + lines present +
  # positive grand-total before the invoice is legally outstanding.
  @customer_invoices [
    {"customer_invoices.view", "View customer invoices + payments"},
    {"customer_invoices.create",
     "Create + edit draft customer invoices; cancel pre-payment"},
    {"customer_invoices.send",
     "Send a draft invoice — flips status to `sent` and locks edits"},
    {"customer_invoices.record_payment",
     "Record a payment against a sent invoice (or refund)"},
    {"customer_invoices.delete", "Delete draft invoices"}
  ]

  # Customer returns (RMAs) — sell-side post-shipment workflow.
  # Accept auto-generates a credit_note invoice; the receive +
  # resolve gates are separated so finance (resolve) and warehouse
  # (receive) can be delegated apart.
  @customer_returns [
    {"customer_returns.view", "View customer returns + inspection notes"},
    {"customer_returns.create",
     "Create + edit draft customer returns; cancel pre-resolution"},
    {"customer_returns.receive",
     "Mark customer goods as physically received (flips draft → received)"},
    {"customer_returns.resolve",
     "Accept or reject a received return; accept auto-issues a credit note"},
    {"customer_returns.delete", "Delete draft customer returns"}
  ]

  # Cash flow — finance dashboard projection over invoices + POs.
  # Read-only; the underlying writes happen on the sales-invoice + PO
  # workflows themselves.
  @cash_flow [
    {"cash_flow.view",
     "View the 12-week cash-flow forecast (A/R + A/P inflows + outflows)"}
  ]

  # Sales statistics — analytics dashboard projection over invoices.
  # Read-only.
  @statistics [
    {"statistics.view",
     "View sales statistics (revenue KPIs, top customers, top items, lifecycle funnel)"}
  ]

  # Sales management — book-of-business view per account manager.
  # Read-only; account manager is set on the customer record itself.
  @sales_management [
    {"sales_management.view",
     "View the sales management dashboard (account-manager leaderboard, CO funnel, unassigned customers)"}
  ]

  # Loyalty — tiered-rebate programs + the customer credits ledger.
  # `programs.manage` covers program CRUD (admin / finance lead);
  # `credits.grant` covers manual grants + redemptions (front-of-house);
  # `view` is the read-only consumer (account managers).
  @loyalty [
    {"loyalty.view",
     "View loyalty programs + customer credit balances and ledger"},
    {"loyalty.programs_manage",
     "Create, edit, activate / deactivate loyalty programs and their tiers"},
    {"loyalty.credits_grant",
     "Grant manual credits to a customer and redeem credit against an invoice"}
  ]

  # Procurement — purchase orders, invoices. Two-tier approval split
  # (po_approve = first signature, po_director_approve = second + ordered).
  @procurement [
    {"procurement.po_view", "View purchase orders"},
    {"procurement.po_create", "Create + edit draft purchase orders"},
    {"procurement.po_submit", "Submit a draft PO for approval"},
    {"procurement.po_approve", "Sign off as approver tier"},
    {"procurement.po_director_approve",
     "Sign off as director tier + mark approved POs as ordered"},
    {"procurement.po_receive", "Receive stock against an open PO"},
    {"procurement.invoice_view", "View invoices"},
    {"procurement.invoice_manage", "Create + edit + delete invoices"},
    {"procurement.invoice_approve", "Approve invoices and mark them paid"}
  ]

  # Goods-In Inspection — BRCGS / FSSC 22000 incoming-inspection
  # workflow. Two-signature flow:
  # `inspect` fills the form + signs as the goods-in operator;
  # `approve` reviews + signs as the quality approver. Same user
  # is permitted to hold both roles (our regulatory framework
  # allows it, see `Backend.GoodsIn.sign_quality_approver/3`).
  @goods_in [
    {"goods_in.view", "View Goods-In Inspections"},
    {"goods_in.inspect",
     "Create + fill + sign as goods-in operator on an inspection"},
    {"goods_in.approve",
     "Sign as quality approver and record the QC verdict on an inspection"}
  ]

  # Production — BOM management is the first piece. Manufacturing
  # orders, routings, workstations, and the schedule follow in
  # future passes; their permission codes will slot in here keeping
  # the `production.*` namespace stable.
  @production [
    {"production.bom_view", "View Bills of Materials"},
    {"production.bom_create", "Create new BOMs"},
    {"production.bom_edit", "Edit existing BOMs (lines, parts, primary flag)"},
    {"production.bom_delete", "Delete BOMs"},
    {"production.workstation_group_view", "View workstation groups"},
    {"production.workstation_group_create", "Create new workstation groups"},
    {"production.workstation_group_edit",
     "Edit existing workstation groups (rate, working hours, defaults)"},
    {"production.workstation_group_delete", "Delete workstation groups"},
    {"production.facility_view", "View production sites + their floor plans"},
    {"production.facility_create", "Create new production sites"},
    {"production.facility_edit",
     "Edit production sites (details, floors, locations, cells)"},
    {"production.facility_delete", "Delete production sites"},
    {"production.workstation_view", "View workstations"},
    {"production.workstation_create", "Create new workstations"},
    {"production.workstation_edit",
     "Edit workstations (group, rate, productivity, idle window, default workers)"},
    {"production.workstation_delete", "Delete workstations"},
    {"production.routing_view", "View routings"},
    {"production.routing_create", "Create new routings"},
    {"production.routing_edit",
     "Edit existing routings (steps, costs, worker assignments)"},
    {"production.routing_delete", "Delete routings"},
    {"production.mo_view", "View manufacturing orders"},
    {"production.mo_create", "Create new manufacturing orders"},
    {"production.mo_edit", "Edit draft / approved manufacturing orders"},
    {"production.mo_prepare",
     "Mark a manufacturing order tree as prepared (1st of 2 signatures)"},
    {"production.mo_approve",
     "Countersign / reject / amend a prepared MO tree (2nd of 2 signatures)"},
    {"production.mo_execute",
     "Start, complete, or cancel a manufacturing order (run on the floor)"},
    {"production.mo_release",
     "Release a scheduled MO to the warehouse for ingredient pickup"},
    {"production.preflight",
     "Confirm receipt of picked materials at the production line (qty + quality sign-off)"},
    {"production.qc_output",
     "Sign off the quality of a manufactured output lot (pass / fail) before it transfers to the warehouse"},
    {"production.closeout",
     "Close out a completed MO from the production line — scan + record how much of each booked material was consumed, hand the leftovers + produced output to the production-side dispatch cell"},
    {"production.final_release",
     "Final Product Release — sign off a finished output lot for dispatch (BRCGS Issue 9 § 5.6 Positive Release). Dual sign-off: two different holders of this permission must both sign before the lot flips from awaiting_release to available."},
    {"production.mo_delete", "Delete manufacturing orders"}
  ]

  # Warehouse operator actions — distinct from `stock.move` because
  # picking is a workflow gated by the MO lifecycle (head-of-picker
  # lock, mandatory scan flow, final transfer + photo) rather than
  # the freeform between-cell move stock.move covers.
  @warehouse [
    {"warehouse.pick",
     "Start, scan, abort, and confirm-transfer warehouse pickup for a released MO"},
    {"warehouse.return_pickup",
     "Pick up closed-out MO materials + produced output from the production-side dispatch cell and place them back into warehouse storage"}
  ]

  # 3PL — customer-owned finished goods held under bailee custody
  # after a released lot is routed to `three_pl_storage` (BRCGS Issue
  # 9 § 4.4 segregation + § 5.6 handoff). Split into three because the
  # personas are genuinely different: read-only visibility (sales /
  # finance / customer service), request a dispatch from the desk
  # (shipping coordinator), and physically execute the pick on the
  # warehouse floor (mobile-only operator).
  @three_pl [
    {"three_pl.view",
     "View bailee-custody inventory (customer-owned finished goods) — the /three-pl tab, per-item pages, and paperwork trails. Read-only."},
    {"three_pl.dispatch_request",
     "Queue a partial-lot dispatch from bailee custody: qty + optional reference / notes. Creates a pending pick task for the warehouse floor. Also allows cancelling a pending request."},
    {"three_pl.dispatch_execute",
     "Execute a queued 3PL dispatch on mobile — scan the source three_pl_storage cell + lot, walk the qty to a dispatch cell, take a photo, confirm. Flips the dispatch row to completed atomically with the physical move."}
  ]

  # Shipments — customer-facing outbound record (BRCGS Issue 9 §
  # 5.4.6 receipt trail). One row per truck / lot. Draft → ready →
  # picked_up lifecycle. Split into three: broad-audience read,
  # paperwork edit (recipient / carrier / waybill / mark-ready /
  # cancel), and the physical truck-arrival confirmation.
  @shipments [
    {"shipments.view",
     "View the /shipments list + detail pages. Broad audience — sales, finance, customer service, warehouse. Read-only."},
    {"shipments.edit",
     "Create + edit shipment paperwork (recipient, delivery address, country, carrier, notes, etc.), mark ready for pickup, reopen for edits, cancel with a reason."},
    {"shipments.pickup",
     "Confirm truck arrived and picked up the shipment. Fills the mobile dispatch checklist + photos and flips status to picked_up (immutable)."},
    {"shipments.confirm_delivery",
     "Confirm the consignment was received at destination. Records recipient signatory + optional notes / photos and flips status to delivered (terminal). Separate from pickup because the actor persona differs — customer service / warehouse admin logs the POD, not the loader who stamped pickup."}
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
        @integrations ++
        @stock ++
        @equipment ++
        @vendors ++
        @customers ++
        @pricelists ++
        @customer_orders ++
        @customer_invoices ++
        @customer_returns ++
        @cash_flow ++
        @statistics ++
        @sales_management ++
        @loyalty ++
        @procurement ++
        @goods_in ++
        @production ++
        @warehouse ++
        @three_pl ++
        @shipments,
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
      integrations: @integrations,
      stock: @stock,
      equipment: @equipment,
      vendors: @vendors,
      customers: @customers,
      pricelists: @pricelists,
      customer_orders: @customer_orders,
      customer_invoices: @customer_invoices,
      customer_returns: @customer_returns,
      cash_flow: @cash_flow,
      statistics: @statistics,
      sales_management: @sales_management,
      loyalty: @loyalty,
      procurement: @procurement,
      goods_in: @goods_in,
      production: @production,
      warehouse: @warehouse,
      three_pl: @three_pl,
      shipments: @shipments
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
          },
          %{
            key: "stock_lifecycle",
            label: "Stock lot lifecycle",
            description:
              "QC verdicts, hold / release, and disposal events on a stock lot. Each action writes an immutable event row; the lot's status is the projection.",
            read: "stock.view",
            create: "stock.qc",
            update: "stock.hold",
            delete: "stock.dispose"
          }
        ]
      },
      %{
        section: "Sales",
        resources: [
          %{
            key: "customers",
            label: "Customers",
            description:
              "Sell-side counterparty registry. Identity, commercial terms, account-manager assignment, contact log. Unlocks Customer Orders downstream.",
            read: "customers.view",
            create: "customers.create",
            update: "customers.edit",
            delete: "customers.delete"
          },
          %{
            key: "customer_approval",
            label: "Customer approval",
            description:
              "Move a customer through draft → approved → rejected. 4-eyes — the approver must differ from the creator.",
            read: "customers.view",
            create: nil,
            update: "customers.approve",
            delete: nil
          },
          %{
            key: "pricelists",
            label: "Pricelists",
            description:
              "Sell-side selling-price quotes. Tiered pricing per (pricelist × item × min-qty). Customers point at one pricelist; a company default catches everything else. Save = live, no approval gate.",
            read: "pricelists.view",
            create: "pricelists.create",
            update: "pricelists.edit",
            delete: "pricelists.delete"
          },
          %{
            key: "customer_orders",
            label: "Customer orders",
            description:
              "Sell-side mirror of POs. Two-tier ESIGN approval. Gates at submit: customer is approved, items sellable to that customer, trade-credit-limit not breached.",
            read: "customer_orders.view",
            create: "customer_orders.create",
            update: "customer_orders.create",
            delete: "customer_orders.delete"
          },
          %{
            key: "customer_order_approval",
            label: "CO approval",
            description:
              "Approver-tier signature, director-tier signature, and mark-confirmed action. Director must differ from approver (segregation of duties).",
            read: "customer_orders.view",
            create: "customer_orders.approve",
            update: "customer_orders.director_approve",
            delete: nil
          },
          %{
            key: "customer_invoices",
            label: "Customer invoices",
            description:
              "Sell-side invoicing — generated from confirmed COs or one-off. Send gate validates customer approved + lines present + positive total. Multiple partial payments per invoice; status auto-flips to paid when outstanding hits zero.",
            read: "customer_invoices.view",
            create: "customer_invoices.create",
            update: "customer_invoices.create",
            delete: "customer_invoices.delete"
          },
          %{
            key: "customer_invoice_send",
            label: "Invoice send + payments",
            description:
              "Send-to-customer action + recording payments / refunds. These are distinct gates from generic edit access so finance can be delegated separately from sales.",
            read: "customer_invoices.view",
            create: "customer_invoices.send",
            update: "customer_invoices.record_payment",
            delete: nil
          },
          %{
            key: "customer_returns",
            label: "Customer returns (RMAs)",
            description:
              "Post-shipment workflow: customer reports issue → mark received → accept/reject. Accept auto-generates a credit-note invoice linked back to the RMA + source invoice.",
            read: "customer_returns.view",
            create: "customer_returns.create",
            update: "customer_returns.create",
            delete: "customer_returns.delete"
          },
          %{
            key: "customer_return_workflow",
            label: "RMA receive + resolve",
            description:
              "Receive returned goods + accept/reject. Separated from create so warehouse and finance roles can be delegated independently.",
            read: "customer_returns.view",
            create: "customer_returns.receive",
            update: "customer_returns.resolve",
            delete: nil
          },
          %{
            key: "cash_flow",
            label: "Cash-flow forecast",
            description:
              "12-week receivables + payables dashboard. Read-only — finance reads the projection over invoices + POs, no writes here.",
            read: "cash_flow.view",
            create: nil,
            update: nil,
            delete: nil
          },
          %{
            key: "statistics",
            label: "Sales statistics",
            description:
              "Look-back analytics — revenue KPIs, monthly trend, top customers, top items, lifecycle funnel. Read-only.",
            read: "statistics.view",
            create: nil,
            update: nil,
            delete: nil
          },
          %{
            key: "sales_management",
            label: "Sales management",
            description:
              "Book-of-business view per account manager — revenue YTD, outstanding A/R, pipeline value, plus the CO funnel and unassigned-customer list. Read-only.",
            read: "sales_management.view",
            create: nil,
            update: nil,
            delete: nil
          },
          %{
            key: "loyalty_programs",
            label: "Loyalty programs",
            description:
              "Tiered-rebate scheme editor. Programs are assigned to customers; tier crossings trigger auto-accrued credits when invoices flip to paid. Existing credits stay if a program is deactivated.",
            read: "loyalty.view",
            create: "loyalty.programs_manage",
            update: "loyalty.programs_manage",
            delete: "loyalty.programs_manage"
          },
          %{
            key: "loyalty_credits",
            label: "Customer credits",
            description:
              "Per-customer credit ledger + balance. Grants are append-only with reason. Redemptions issue a credit-note invoice so A/R stays consistent. Separated from program management so finance can grant credits without touching scheme rules.",
            read: "loyalty.view",
            create: "loyalty.credits_grant",
            update: nil,
            delete: nil
          }
        ]
      },
      %{
        section: "Procurement",
        resources: [
          %{
            key: "vendors",
            label: "Vendors",
            description:
              "Approved-supplier registry. Carries supplier-qualification metadata (risk, SAQ, review cadence) + per-item approval list that PO line validation reads.",
            read: "vendors.view",
            create: "vendors.create",
            update: "vendors.edit",
            delete: "vendors.delete"
          },
          %{
            key: "vendor_approval",
            label: "Vendor approval",
            description:
              "Move a vendor through pending → approved → suspended / rejected. The qualification gate that unblocks PO creation.",
            read: "vendors.view",
            create: nil,
            update: "vendors.approve",
            delete: nil
          },
          %{
            key: "purchase_orders",
            label: "Purchase orders",
            description:
              "Draft + submit POs against approved vendors. Two-tier ESIGN sign-off is the regulatory baseline.",
            read: "procurement.po_view",
            create: "procurement.po_create",
            update: "procurement.po_create",
            delete: "procurement.po_create"
          },
          %{
            key: "po_approval",
            label: "PO approval",
            description:
              "First-tier (approver) and second-tier (director) signatures. Director also marks approved POs as sent to vendor.",
            read: "procurement.po_view",
            create: "procurement.po_approve",
            update: "procurement.po_director_approve",
            delete: nil
          },
          %{
            key: "po_receive",
            label: "PO receive",
            description:
              "Record stock receipts against an open PO. Pre-fills lot from the line item.",
            read: "procurement.po_view",
            create: "procurement.po_receive",
            update: nil,
            delete: nil
          },
          %{
            key: "invoices",
            label: "Invoices",
            description:
              "Vendor invoices, linked to POs for the three-way match.",
            read: "procurement.invoice_view",
            create: "procurement.invoice_manage",
            update: "procurement.invoice_manage",
            delete: "procurement.invoice_manage"
          }
        ]
      },
      %{
        section: "Goods-In",
        resources: [
          %{
            key: "goods_in_inspections",
            label: "Goods-In Inspections",
            description:
              "BRCGS / FSSC 22000 receiving inspections. `inspect` signs as goods-in operator, `approve` signs as quality approver.",
            read: "goods_in.view",
            create: "goods_in.inspect",
            update: "goods_in.inspect",
            delete: nil
          },
          %{
            key: "goods_in_quality_signoff",
            label: "Quality sign-off",
            description:
              "Approver tier — records the QC verdict and fans out lifecycle events on every linked stock lot.",
            read: "goods_in.view",
            create: nil,
            update: "goods_in.approve",
            delete: nil
          }
        ]
      },
      %{
        section: "Production",
        resources: [
          %{
            key: "boms",
            label: "Bills of Materials",
            description:
              "Recipes for manufactured items — parts + quantities. Restricted to finished_product / semi_finished item types.",
            read: "production.bom_view",
            create: "production.bom_create",
            update: "production.bom_edit",
            delete: "production.bom_delete"
          },
          %{
            key: "workstation_groups",
            label: "Workstation groups",
            description:
              "Clusters of identical workstations — ovens, capsulators, packaging lines. Future workstations and routings hang off these.",
            read: "production.workstation_group_view",
            create: "production.workstation_group_create",
            update: "production.workstation_group_edit",
            delete: "production.workstation_group_delete"
          },
          %{
            key: "production_facilities",
            label: "Production sites",
            description:
              "Physical manufacturing sites with their own floor plan. Holds WIP stock and (in a follow-up) the workstations that run on the floor.",
            read: "production.facility_view",
            create: "production.facility_create",
            update: "production.facility_edit",
            delete: "production.facility_delete"
          },
          %{
            key: "workstations",
            label: "Workstations",
            description:
              "Individual machines / line slots inside a workstation group on a production site. Schedule, MOs, and vita-performance scoring key on these rows.",
            read: "production.workstation_view",
            create: "production.workstation_create",
            update: "production.workstation_edit",
            delete: "production.workstation_delete"
          },
          %{
            key: "routings",
            label: "Routings",
            description:
              "Ordered list of operations against workstation groups that turns a BOM into a finished item. Drives schedule, MO costing, and per-step worker assignments.",
            read: "production.routing_view",
            create: "production.routing_create",
            update: "production.routing_edit",
            delete: "production.routing_delete"
          },
          %{
            key: "manufacturing_orders",
            label: "Manufacturing orders",
            description:
              "Planned production runs. Update covers the header form; the workflow rows below gate the lifecycle transitions.",
            read: "production.mo_view",
            create: "production.mo_create",
            update: "production.mo_edit",
            delete: "production.mo_delete"
          },
          # ---- MO lifecycle (workflow) ----
          # One single-checkbox row per workflow capability. The matrix
          # grid still renders the four canonical columns; rows that
          # only fill one column show "—" for the rest. Keeping these
          # in the same section makes the role-editor self-documenting.
          %{
            key: "mo_prepare",
            label: "Prepare MO",
            description:
              "Sign off as the preparer — first of the two-eyes approval before formal approval.",
            read: nil,
            create: nil,
            update: "production.mo_prepare",
            delete: nil
          },
          %{
            key: "mo_approve",
            label: "Approve MO",
            description:
              "Approve a prepared MO. Approver must differ from the preparer (4-eyes rule).",
            read: nil,
            create: nil,
            update: "production.mo_approve",
            delete: nil
          },
          %{
            key: "mo_release",
            label: "Release MO to warehouse",
            description:
              "Send a scheduled MO into the warehouse picker queue (sets the visibility window + flips status to `scheduled`).",
            read: nil,
            create: nil,
            update: "production.mo_release",
            delete: nil
          },
          %{
            key: "warehouse_pick",
            label: "Pick MO from warehouse (mobile)",
            description:
              "Start, scan, abort, and confirm-transfer warehouse pickup. Head-of-picker lock applies.",
            read: nil,
            create: nil,
            update: "warehouse.pick",
            delete: nil
          },
          %{
            key: "production_preflight",
            label: "Confirm receipt at production line",
            description:
              "Sign off each booked lot (received qty + quality notes) once it lands at the production-feed cell. Hard gate before in_progress.",
            read: nil,
            create: nil,
            update: "production.preflight",
            delete: nil
          },
          %{
            key: "mo_execute",
            label: "Run production (Start / Finish)",
            description:
              "Start + Finish a preflight-cleared MO. Finish stamps actual times, captures produced qty, and creates the output stock lot.",
            read: nil,
            create: nil,
            update: "production.mo_execute",
            delete: nil
          },
          %{
            key: "qc_output",
            label: "Quality-check finished output",
            description:
              "Sign off a manufactured output lot as pass / fail. Until this clears, the output stays in `received` status and can't be transferred to the warehouse.",
            read: nil,
            create: nil,
            update: "production.qc_output",
            delete: nil
          },
          %{
            key: "closeout",
            label: "Close out production run (mobile)",
            description:
              "Mobile-only — scan each booked material at the production-feed cell, record how much was consumed (0 = fully used), photo any leftovers + the produced output, and hand them off to a production-side dispatch cell for warehouse pickup.",
            read: nil,
            create: nil,
            update: "production.closeout",
            delete: nil
          },
          %{
            key: "warehouse_return_pickup",
            label: "Pick up from production (mobile)",
            description:
              "Mobile-only — walk the production-side dispatch cells after closeout, scan each lot onto the trolley, then place every lot into the warehouse on a scanned target rack + photo. Re-makes lots available in storage.",
            read: nil,
            create: nil,
            update: "warehouse.return_pickup",
            delete: nil
          }
        ]
      },
      %{
        section: "Outbound",
        resources: [
          %{
            key: "three_pl",
            label: "3PL bailee custody",
            description:
              "Customer-owned finished goods held on our floor after Positive Release routes a lot to 3PL storage. View covers the /three-pl inventory + per-lot pages; dispatch_request queues a partial-lot pick from the desktop; dispatch_execute is the mobile scan flow that walks it to the shipping bay with photo evidence.",
            read: "three_pl.view",
            create: "three_pl.dispatch_request",
            update: "three_pl.dispatch_execute",
            delete: nil
          },
          %{
            key: "shipments",
            label: "Shipments (BRCGS § 5.4.6)",
            description:
              "Customer-facing outbound record — one row per truck. Edit covers the paperwork side (recipient, delivery address, notes, mark ready, cancel); pickup is the physical truck-arrival confirmation (placeholder button today; full mobile arrival form with signature + BOL photo lands here later).",
            read: "shipments.view",
            create: "shipments.edit",
            update: "shipments.pickup",
            delete: nil
          }
        ]
      }
    ]
  end
end
