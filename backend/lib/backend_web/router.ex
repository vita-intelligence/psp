defmodule BackendWeb.Router do
  use BackendWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
    plug BackendWeb.Plugs.SecureHeaders
  end

  pipeline :api_authed do
    plug :accepts, ["json"]
    plug BackendWeb.Plugs.SecureHeaders
    plug BackendWeb.Plugs.RequireAuth
  end

  # Machine-to-machine integrations (vita-performance today, more
  # later) authenticate via an opaque bearer token in
  # `X-Integration-Token` rather than a user session. The pipeline
  # verifies token validity + activity; individual routes layer their
  # own scope check via a per-route plug.
  pipeline :api_integration do
    plug :accepts, ["json"]
    plug BackendWeb.Plugs.SecureHeaders
    plug BackendWeb.Plugs.RequireIntegrationAuth, scope: :any
  end

  # One pipeline per polymorphic-comments mount. Stamps
  # `conn.assigns.entity_type` so `CommentsController` knows which
  # kind of row the URL uuid refers to without inventing a new path
  # segment. Keeps `/api/vendors/:uuid/comments` URLs intuitive.
  pipeline :comments_vendor do
    plug :put_entity_type, "vendor"
  end

  pipeline :comments_customer do
    plug :put_entity_type, "customer"
  end

  pipeline :comments_pricelist do
    plug :put_entity_type, "pricelist"
  end

  pipeline :comments_customer_order do
    plug :put_entity_type, "customer_order"
  end

  pipeline :comments_customer_invoice do
    plug :put_entity_type, "customer_invoice"
  end

  pipeline :comments_customer_return do
    plug :put_entity_type, "customer_return"
  end

  pipeline :comments_loyalty_program do
    plug :put_entity_type, "loyalty_program"
  end

  pipeline :comments_purchase_order do
    plug :put_entity_type, "purchase_order"
  end

  pipeline :comments_stock_lot do
    plug :put_entity_type, "stock_lot"
  end

  pipeline :comments_bom do
    plug :put_entity_type, "bom"
  end

  pipeline :comments_workstation_group do
    plug :put_entity_type, "workstation_group"
  end

  pipeline :comments_workstation do
    plug :put_entity_type, "workstation"
  end

  pipeline :comments_machine do
    plug :put_entity_type, "machine"
  end

  pipeline :comments_routing do
    plug :put_entity_type, "routing"
  end

  pipeline :comments_manufacturing_order do
    plug :put_entity_type, "manufacturing_order"
  end

  pipeline :comments_manufacturing_order_step do
    plug :put_entity_type, "manufacturing_order_step"
  end

  pipeline :comments_shipment do
    plug :put_entity_type, "shipment"
  end

  pipeline :comments_purchase_order_line do
    plug :put_entity_type, "purchase_order_line"
  end

  pipeline :comments_equipment do
    plug :put_entity_type, "equipment"
  end

  pipeline :comments_hr_employee do
    plug :put_entity_type, "hr_employee"
  end

  defp put_entity_type(conn, type) do
    Plug.Conn.assign(conn, :entity_type, type)
  end

  scope "/api", BackendWeb do
    pipe_through :api

    post "/auth/register", AuthController, :register
    post "/auth/login", AuthController, :login
    post "/auth/confirm", AuthController, :confirm
    post "/auth/forgot-password", PasswordResetController, :request
    post "/auth/reset-password", PasswordResetController, :confirm

    # Login-time MFA verify: exchanges a short-lived mfa_token +
    # TOTP/recovery code for a full session token. Anonymous — the
    # mfa_token IS the auth for this step.
    post "/auth/mfa/verify", MfaController, :verify

    # Device pairing — public endpoints. `/devices/pairing-codes/:code`
    # is read-only "is this code still valid" the /pair page hits before
    # showing the claim form. `/devices/claim` swaps a one-time code for
    # a long-lived bearer token.
    get "/devices/pairing-codes/:code", LinkedDeviceController, :lookup_pairing_code
    post "/devices/claim", LinkedDeviceController, :claim
  end

  scope "/api", BackendWeb do
    pipe_through :api_authed

    get "/auth/me", AuthController, :me
    put "/auth/me", ProfileController, :update
    put "/auth/password", ProfileController, :change_password

    # Self-service "log out other devices". Bumps the caller's
    # `token_version` (killing every other outstanding token) and
    # returns a fresh token so the current session stays alive.
    post "/auth/sessions/revoke-others", ProfileController, :revoke_other_sessions

    # MFA enrollment + management (all require an active session).
    get  "/auth/mfa/status", MfaController, :status
    post "/auth/mfa/enroll", MfaController, :enroll
    post "/auth/mfa/confirm", MfaController, :confirm
    post "/auth/mfa/disable", MfaController, :disable

    # Integration tokens — human-user CRUD for the
    # `/settings/integrations` page. Distinct from `/api/integration`
    # (machine-facing, X-Integration-Token) — this is the workbench
    # where the operator mints/revokes tokens the machine callers use.
    get "/integration-tokens", IntegrationTokenController, :index
    post "/integration-tokens", IntegrationTokenController, :create
    post "/integration-tokens/:id/revoke", IntegrationTokenController, :revoke

    # Phone → laptop print bridge. Lands a `print_label` push on the
    # actor's `user:<uuid>` channel.
    post "/realtime/print-label", PrintBridgeController, :print_label
    # Entity-agnostic comment-file streamer. Public URLs stamped into
    # CommentFile payloads point here; the controller re-derives the
    # RBAC gate from the parent comment's entity_type at fetch time.
    get "/comment-files/:file_uuid/serve", CommentsController, :serve_file_bare

    get "/team", UserController, :team
    get "/users", UserController, :index
    get "/users/:id", UserController, :show
    put "/users/:id/access", UserController, :update_access

    # Admin-only incident-response panic buttons. Both bump
    # `users.token_version`, killing existing session tokens on the
    # next request. See `BackendWeb.AdminSecurityController`.
    post "/admin/users/:uuid/revoke-sessions",
         AdminSecurityController,
         :revoke_user_sessions

    post "/admin/security/revoke-all-sessions",
         AdminSecurityController,
         :revoke_all_sessions

    get "/roles", RoleController, :index
    get "/roles/:id", RoleController, :show
    post "/roles", RoleController, :create
    put "/roles/:id", RoleController, :update
    delete "/roles/:id", RoleController, :delete
    get "/permissions/matrix", UserController, :matrix
    get "/audit", AuditController, :index

    get "/company/defaults", CompanyController, :defaults
    get "/company", CompanyController, :show
    put "/company", CompanyController, :update
    put "/company/locale", CompanyController, :update_locale
    put "/company/security", CompanyController, :update_security
    put "/company/warehouse-pickup", CompanyController, :update_warehouse_pickup
    put "/company/three-pl-rate", CompanyController, :update_three_pl_rate
    put "/company/bag", CompanyController, :update_bag

    put "/company/currency-rates/auto-pull",
        CompanyController,
        :update_currency_rates_auto_pull

    post "/company/currency-rates/refresh-now",
         CompanyController,
         :refresh_currency_rates_now

    resources "/warehouses", WarehouseController,
      only: [:index, :show, :create, :update, :delete] do
      # Floors are nested — /warehouses/:warehouse_id/floors. Phoenix
      # passes the parent uuid as `warehouse_id` (URL param naming is
      # by resource, not by column name).
      resources "/floors", FloorController, except: [:new, :edit]

      # Locations are nested under the warehouse rather than the
      # floor because the body may carry a new `floor_uuid` to move
      # them between floors on update. Lookup is by warehouse +
      # location uuid.
      resources "/storage-locations", StorageLocationController,
        except: [:new, :edit, :index] do
        # One-shot helper: split a rack into N levels with the
        # supplied heights, in one transaction. Lives above the
        # `resources` so it doesn't clash with `cells/:id`.
        post "/cells/split", StorageCellController, :split

        # Push the rack's current tags down to every existing
        # level. Used by the FE confirm prompt that fires after the
        # operator edits rack tags — inheritance is otherwise
        # creation-time only.
        post "/cells/sync-tags", StorageCellController, :sync_tags

        # Cells nest directly under their location — they have no
        # meaning otherwise so :index is omitted (cells come along
        # on the location payload).
        resources "/cells", StorageCellController,
          except: [:new, :edit, :index]
      end
    end

    # Production facilities — same plumbing as warehouses on the
    # nested children, gated through the kind-aware perm plug so
    # the `production.facility_*` permission family controls access.
    #
    # The nested children explicitly use `:warehouse_id` in the path
    # (instead of Phoenix's auto-named `:production_facility_id`)
    # so the shared FloorController / StorageLocationController /
    # StorageCellController don't need duplicated param-key
    # handling — they read `conn.params["warehouse_id"]` for both
    # warehouses and production facilities.
    resources "/production-facilities", ProductionFacilityController,
      only: [:index, :show, :create, :update, :delete]

    scope "/production-facilities/:warehouse_id" do
      get "/floors", FloorController, :index, as: :production_facility_floor
      post "/floors", FloorController, :create
      get "/floors/:id", FloorController, :show
      patch "/floors/:id", FloorController, :update
      put "/floors/:id", FloorController, :update
      delete "/floors/:id", FloorController, :delete

      post "/storage-locations", StorageLocationController, :create,
        as: :production_facility_storage_location

      get "/storage-locations/:id", StorageLocationController, :show
      patch "/storage-locations/:id", StorageLocationController, :update
      put "/storage-locations/:id", StorageLocationController, :update
      delete "/storage-locations/:id", StorageLocationController, :delete

      scope "/storage-locations/:storage_location_id" do
        post "/cells/split", StorageCellController, :split,
          as: :production_facility_cell_split

        post "/cells/sync-tags", StorageCellController, :sync_tags,
          as: :production_facility_cell_sync_tags

        post "/cells", StorageCellController, :create,
          as: :production_facility_cell

        get "/cells/:id", StorageCellController, :show
        patch "/cells/:id", StorageCellController, :update
        put "/cells/:id", StorageCellController, :update
        delete "/cells/:id", StorageCellController, :delete
      end
    end

    # Company-scoped tag vocabulary used by the warehouse plan editor
    # picker. Top-level (not nested under warehouses) because the
    # registry is shared across every warehouse.
    resources "/storage-tags", StorageTagController, except: [:new, :edit]

    # Company-scoped units-of-measurement registry. Used by the items
    # and recipe forms (once they land) for stock + conversion math;
    # admins manage at /settings/units-of-measurement.
    resources "/units-of-measurement", UnitOfMeasurementController,
      except: [:new, :edit]

    # Core stock items. Per-type compliance subtables (raw_material /
    # finished_product / packaging) are managed by sibling controllers
    # and stitched in by the item payload shaper.
    resources "/items", ItemController, except: [:new, :edit] do
      # Atomic mega-save: identity + per-type compliance subtable in
      # one transaction. Used by the unified item-edit form.
      put "/full", ItemController, :update_full

      # Two-state compliance gate: `draft` → `ready_for_use` (runs
      # the per-type required-fields validator) and back to `draft`
      # with a mandatory justification. Items in `draft` are refused
      # by PO lines + BOMs so non-compliant items can't reach prod.
      post "/mark-ready", ItemController, :mark_ready
      post "/revert-to-draft", ItemController, :revert_to_draft

      # Per-item image gallery. Bytes are stored via the configured
      # `Backend.Storage` adapter (filesystem in dev, swap to Azure /
      # S3 in prod). The serving route is RBAC-gated so reads still
      # honour items.view.
      get "/images", ItemImageController, :index
      post "/images", ItemImageController, :create
      get "/images/:id/file", ItemImageController, :serve_file
      put "/images/:id", ItemImageController, :update
      put "/images/:id/primary", ItemImageController, :set_primary
      delete "/images/:id", ItemImageController, :delete

      # Raw-material sub-data. Each route validates the parent is in
      # fact a raw material before writing.
      put "/raw-material-compliance", RawMaterialController, :upsert_compliance
      put "/raw-material-risk", RawMaterialController, :upsert_risk
      put "/allergens", RawMaterialController, :set_allergens

      # Finished-product spec — only writes for items of type
      # `finished_product`.
      put "/finished-product-spec", FinishedProductController, :upsert

      # Packaging compliance — only writes for items of type
      # `packaging`.
      put "/packaging-compliance", PackagingController, :upsert

      # Per-item certificate attachments. Cert registry itself is
      # a sibling resource below.
      resources "/certificates", ItemCertificateController,
        only: [:create, :update, :delete]

      # Compliance evidence files (spec sheet, food-contact DoC,
      # migration test report, …). Same shape as the vendor / lot /
      # PO / goods-in attachments — bytes live in Backend.Storage,
      # the per-type subtable carries an FK to the metadata row.
      post "/files", ItemFileController, :upload_file
      get "/files/:id/serve", ItemFileController, :serve_file
    end

    # Company-scoped certificate registry (definitions). Per-item
    # attachments are nested under items above.
    resources "/certificates", CertificateController, except: [:new, :edit]

    # HR — employees master data + wage history + reputation event
    # stream. Sessions FK the row so `:delete` is disabled in favour
    # of `:archive` (soft delete). Wages + reputation events land
    # under the employee resource so the RBAC gate + tenant scope
    # ride along the parent lookup.
    resources "/hr/employees", HREmployeeController,
      except: [:new, :edit, :delete] do
      post "/archive", HREmployeeController, :archive
      get "/wages", HREmployeeController, :list_wages
      post "/wages", HREmployeeController, :create_wage
      get "/reputation-events", HREmployeeController, :list_reputation_events

      post "/reputation-events",
           HREmployeeController,
           :create_reputation_event

      # Every WorkstationSession this employee has run — feeds the
      # profile page's timeline + active-run card.
      get "/sessions", HREmployeeController, :list_sessions
    end

    # Vendor registry. Holds the approved-supplier list + per-vendor
    # certificate evidence the PO line validator + GFSI audits read.
    resources "/vendors", VendorController, except: [:new, :edit] do
      # Approval transition is its own action so admins can delegate
      # the qualification gate separately from edit. Qualification
      # write is also its own action so segregation-of-duties (the
      # approver must differ from whoever last touched the
      # qualification record) is enforceable.
      put "/approval", VendorController, :update_approval
      put "/qualification", VendorController, :update_qualification

      # Evidence file upload + serve. Files live independently in
      # `Backend.Storage`; the qualification + cert writes carry an
      # FK to the metadata row this returns. RBAC is the same as the
      # parent vendor — if you can see the vendor you can fetch its
      # evidence; only `vendors.edit` can upload.
      post "/files", VendorController, :upload_file
      get "/files/:id/serve", VendorController, :serve_file

      # Per-item approved-supplier edges. Adding a row is the gate
      # that lets a vendor appear on PO lines for the given item.
      post "/approved-items", VendorController, :add_approved_item
      delete "/approved-items/:id", VendorController, :remove_approved_item

      # Cached last-paid prices per (item, currency). Read-only —
      # the rows are maintained by the PO receive flow, not by the
      # vendor edit form.
      get "/price-history", VendorController, :price_history

      # Per-vendor certificate attachments. Same shape as
      # /api/items/:id/certificates — reuses the cert registry +
      # the certificate-expiring queue downstream.
      post "/certificates", VendorController, :add_certificate
      put "/certificates/:id", VendorController, :update_certificate
      delete "/certificates/:id", VendorController, :remove_certificate
    end

    # Customer (sell-side) registry. Mirror of /api/vendors; carries
    # identity + commercial terms + the 4-eyes approval gate that
    # unblocks Customer Order creation downstream.
    resources "/customers", CustomerController, except: [:new, :edit] do
      # Approval transition gated by `customers.approve` so admins
      # can delegate the gate separately from generic edit access.
      put "/approval", CustomerController, :update_approval

      # Onboarding-evidence writes (KYC / Credit / AML / Contract +
      # review cadence). Stamps qualified_by / qualified_at so the
      # approval gate can enforce segregation of duties.
      put "/qualification", CustomerController, :update_qualification

      # Contact rows — phones / mobiles / emails. Multiple per
      # customer; one can be is_primary at a time (enforced
      # server-side).
      post "/contacts", CustomerController, :add_contact
      put "/contacts/:id", CustomerController, :update_contact
      delete "/contacts/:id", CustomerController, :remove_contact

      # Contact-event log — calls / emails / meetings. Append-only
      # by intent (no update/delete here); a wrong entry is corrected
      # with a follow-up. Drives last_contact_at + the derived
      # status projection.
      post "/contact-events", CustomerController, :log_contact_event

      # Bump next_contact_at without recording an event — used by the
      # "Today's contacts" page's Snooze action. RBAC = customers.edit.
      post "/snooze-next-contact", CustomerController, :snooze_next_contact

      # File uploads — contracts, NDAs, credit checks, logos.
      # Bytes live in `Backend.Storage`. Mirror of vendor file
      # uploads. RBAC: `customers.view` to fetch, `customers.edit`
      # to upload, `customers.delete` to remove.
      post "/files", CustomerController, :upload_file
      get "/files/:id/serve", CustomerController, :serve_file
      delete "/files/:id", CustomerController, :remove_file

      # Per-customer approved-items list (sell-side restriction).
      # Empty list = customer can buy anything; non-empty = the gate
      # at CO submit only lets through listed items.
      post "/approved-items", CustomerController, :add_approved_item
      delete "/approved-items/:id", CustomerController, :remove_approved_item
    end

    # Customer returns (RMAs) — sell-side post-shipment flow. Accept
    # auto-issues a credit-note invoice linked back to the RMA + the
    # source invoice. Photo evidence travels as file uploads.
    resources "/customer-returns", CustomerReturnController,
      except: [:new, :edit] do
      post "/lines", CustomerReturnController, :add_line
      put "/lines/:id", CustomerReturnController, :update_line
      delete "/lines/:id", CustomerReturnController, :delete_line

      post "/mark-received", CustomerReturnController, :mark_received
      post "/accept", CustomerReturnController, :accept
      post "/reject", CustomerReturnController, :reject
      post "/cancel", CustomerReturnController, :cancel

      post "/files", CustomerReturnController, :upload_file
      get "/files/:id/serve", CustomerReturnController, :serve_file
      delete "/files/:id", CustomerReturnController, :remove_file
    end

    # "Today's contacts" — daily CRM follow-up surface. Projection
    # over customer cadence columns; no writes here, snooze + log
    # live on the customer endpoints.
    get "/today", TodayController, :index

    # Cash-flow forecast — 12-week receivables + payables dashboard.
    # Read-only projection over customer_invoices + customer_orders
    # + procurement_invoices + purchase_orders, aggregated weekly in
    # the company base currency.
    get "/cash-flow", CashFlowController, :index

    # Projects landing — every active (non-draft, non-cancelled)
    # CO with its wizard phase + next action. The operator's first
    # stop when they log in.
    get "/projects", ProjectsController, :index

    # Sales statistics — look-back analytics. Revenue KPIs, monthly
    # series, top customers + items, lifecycle funnel. Read-only.
    get "/statistics", StatisticsController, :index

    # Sales management — book-of-business by account manager. Read-only.
    get "/sales-management", SalesManagementController, :index

    # Loyalty surface — programs CRUD + customer credits ledger. All
    # routes here go through Backend.Loyalty; the dashboard endpoint
    # bundles the three pieces (programs, per-customer balances,
    # recent ledger feed) the /sales/loyalty page renders.
    get "/loyalty/dashboard", LoyaltyController, :dashboard

    get "/loyalty/programs", LoyaltyController, :list_programs
    get "/loyalty/programs/:id", LoyaltyController, :show_program
    post "/loyalty/programs", LoyaltyController, :create_program
    put "/loyalty/programs/:id", LoyaltyController, :update_program
    delete "/loyalty/programs/:id", LoyaltyController, :delete_program

    post "/loyalty/programs/:id/set-active", LoyaltyController, :set_active
    post "/loyalty/programs/:id/set-default", LoyaltyController, :set_default

    post "/loyalty/programs/:loyalty_program_id/tiers",
         LoyaltyController,
         :add_tier

    put "/loyalty/programs/:loyalty_program_id/tiers/:id",
        LoyaltyController,
        :update_tier

    delete "/loyalty/programs/:loyalty_program_id/tiers/:id",
           LoyaltyController,
           :delete_tier

    get "/loyalty/credits", LoyaltyController, :list_credits

    get "/customers/:customer_id/credits",
        LoyaltyController,
        :customer_credits

    get "/customers/:customer_id/credits/balance",
        LoyaltyController,
        :customer_balance

    post "/customers/:customer_id/credits/grant",
         LoyaltyController,
         :grant_credit

    post "/customers/:customer_id/credits/apply",
         LoyaltyController,
         :apply_credit

    # Customer invoices — sell-side back-half of order-to-cash. Lines
    # auto-pull unbilled qty from a CO on create_from_co; multiple
    # partial payments per invoice; status auto-flips on payment
    # threshold crossings.
    resources "/customer-invoices", CustomerInvoiceController,
      except: [:new, :edit] do
      post "/lines", CustomerInvoiceController, :add_line
      put "/lines/:id", CustomerInvoiceController, :update_line
      delete "/lines/:id", CustomerInvoiceController, :delete_line

      post "/send", CustomerInvoiceController, :send
      post "/cancel", CustomerInvoiceController, :cancel
      post "/payments", CustomerInvoiceController, :record_payment

      # ChromicPDF-rendered invoice document. Opens inline in the
      # browser's PDF viewer — same pattern as the PO toolbar.
      get "/documents/pdf", CustomerInvoiceController, :document_pdf
    end

    # Generate-from-CO is mounted under the CO's UUID so a wrong
    # invoice can't be tied to a wrong CO via a misrouted body.
    post "/customer-orders/:customer_order_id/generate-invoice",
         CustomerInvoiceController,
         :create_from_co

    # Customer orders — sell-side mirror of POs. Two-tier ESIGN
    # approval. Lines auto-priced from pricelists at line create
    # time (price is snapshot on the line so later pricelist edits
    # don't retroactively re-quote).
    resources "/customer-orders", CustomerOrderController,
      except: [:new, :edit] do
      post "/lines", CustomerOrderController, :add_line
      put "/lines/:id", CustomerOrderController, :update_line
      delete "/lines/:id", CustomerOrderController, :delete_line

      # Pricelist lookup for the line-form auto-price.
      get "/lines/suggest-price", CustomerOrderController, :suggest_price

      # State transitions.
      post "/submit", CustomerOrderController, :submit
      post "/approve", CustomerOrderController, :sign_approver
      post "/director-approve", CustomerOrderController, :sign_director
      post "/mark-confirmed", CustomerOrderController, :mark_confirmed
      post "/cancel", CustomerOrderController, :cancel

      # File attachments (quotes, proformas, shipping docs).
      post "/files", CustomerOrderController, :upload_file
      delete "/files/:id", CustomerOrderController, :remove_file
      get "/files/:id/serve", CustomerOrderController, :serve_file

      # Wizard projection — the FE renders this as a tab on the CO
      # detail page that tells operators exactly what to do next.
      get "/wizard", CustomerOrderController, :wizard

      # Chronological session timeline across every MO in the CO's
      # tree. Powers the "Production sessions" card on the wizard.
      get "/sessions", MOSessionsController, :for_customer_order

      # Project-wide cost roll-up (materials + labour + machine per MO,
      # totals + running-session tick). Powers the "Project cost so
      # far" card on the wizard.
      get "/cost-breakdown", COCostBreakdownController, :show

      # Project-wide wall-clock roll-up (phase durations from CO
      # created → delivered). Powers the "Project time so far" card
      # on the wizard.
      get "/time-breakdown", COTimeBreakdownController, :show

      # Wizard CTA: create an MO pre-linked to the chosen CO line.
      post "/lines/:line_uuid/create-mo",
           CustomerOrderController,
           :create_mo_for_line
    end

    # My tasks — per-user actionable CTA feed across every CO in the
    # pipeline. No path params; actor is the current session user.
    get "/my-tasks", MyTasksController, :index
    # Lean count summary — fires on every entity broadcast from the
    # top-bar badge; skips the full task shape to keep the pipe cool.
    get "/my-tasks/count", MyTasksController, :count

    # Pricelists — sell-side selling-price quotes. Header + tiered
    # line items (multiple rows per item × min-qty so 1-99 / 100-999
    # / 1000+ pricing falls out without extra schema). Read by the
    # future Customer Order line form via Pricelists.price_for/3.
    resources "/pricelists", PricelistController, except: [:new, :edit] do
      # Flip the company-wide default. Wrapped server-side in a tx
      # so the partial unique index never sees two defaults.
      post "/set-default", PricelistController, :set_default

      # Line-item writes. Nested so a UUID typo can't land on the
      # wrong pricelist.
      post "/lines", PricelistController, :add_line
      put "/lines/:id", PricelistController, :update_line
      delete "/lines/:id", PricelistController, :remove_line
    end

    # Purchase orders. Two-tier ESIGN approval + per-line state
    # tracking. Lines are nested so the buyer maintains them under
    # the parent PO's draft state.
    resources "/purchase-orders", PurchaseOrderController,
      except: [:new, :edit] do
      post "/lines", PurchaseOrderController, :add_line
      put "/lines/:id", PurchaseOrderController, :update_line
      delete "/lines/:id", PurchaseOrderController, :delete_line

      # Last-paid lookup for the add-line dialog. Sits above the
      # generic state-transition POSTs because it's a query, not a
      # transition.
      get "/lines/suggest-price", PurchaseOrderController, :suggest_price

      # State transitions live under their own paths so the audit
      # log and FE event-handling stay readable.
      post "/submit", PurchaseOrderController, :submit
      post "/approve", PurchaseOrderController, :sign_approver
      post "/director-approve", PurchaseOrderController, :sign_director
      post "/mark-ordered", PurchaseOrderController, :mark_ordered
      post "/cancel", PurchaseOrderController, :cancel

      # Receive stock against an open PO. Creates lots tied back via
      # source_kind=purchase_order + source_ref=PO code, bumps each
      # line's qty_received, and flips status to partially_received
      # or received accordingly.
      post "/receive", PurchaseOrderController, :receive

      # Quote / spec / other file attachments. Bytes live in
      # `Backend.Storage`; metadata rows scope by `purchase_order_id`
      # so files only resolve under their owning PO. Same RBAC as
      # the parent PO — `po_view` for read/serve, `po_create` for
      # write.
      post "/files", PurchaseOrderController, :upload_file
      delete "/files/:id", PurchaseOrderController, :delete_file
      get "/files/:id/serve", PurchaseOrderController, :serve_file

      # Goods-In Inspections — BRCGS / FSSC 22000 incoming-inspection
      # records against one delivery on this PO. Multi-delivery POs
      # have multiple inspections; each carries section checklists +
      # per-line decisions + dual ESIGN sign-off.
      post "/goods-in-inspections", GoodsInInspectionController, :create
      get "/goods-in-inspections", GoodsInInspectionController, :index

      # Document toolbar (MRPEasy-parity): four PDF renders + a CSV
      # export. Each lives under `/documents/<kind>` so route names
      # stay stable as we add formats. Gated by `procurement.po_view`
      # via the parent plug; status gate (must be director-signed)
      # is enforced in the controller action.
      get "/documents/internal-pdf", PurchaseOrderController, :document_internal_pdf
      get "/documents/vendor-pdf", PurchaseOrderController, :document_vendor_pdf
      get "/documents/delivery-note", PurchaseOrderController, :document_delivery_note
      get "/documents/rfq", PurchaseOrderController, :document_rfq
      get "/documents/csv", PurchaseOrderController, :document_csv

      # Pre-filled mail draft for the Send PO / Send RFQ / Send note
      # buttons. The FE GETs `{to, subject, body}` and constructs a
      # `mailto:` URL the user's mail client opens — same MRPEasy UX.
      # No server-side send; the user previews/edits/sends themselves.
      get "/documents/mailto/:kind", PurchaseOrderController, :document_mailto

      # Vendor invoices recorded against this PO. Per-PO scope is
      # `:index_for_po` + `:create`; the global ledger and per-row
      # actions live under `/api/procurement/invoices/...`.
      get "/invoices", ProcurementInvoiceController, :index_for_po
      post "/invoices", ProcurementInvoiceController, :create
    end

    # Production — BOM CRUD today, manufacturing orders / routings /
    # workstations land here in future passes. Permission gates live
    # on `BackendWeb.BOMController` itself (production.bom_*).
    scope "/production" do
      # Schedule — read-only feed for the calendar / drag-and-drop
      # planner. Drag mutations re-use the per-step PATCH endpoint
      # under manufacturing-orders.
      get "/schedule", ProductionScheduleController, :show

      get "/boms", BOMController, :index
      get "/boms/:id", BOMController, :show
      post "/boms", BOMController, :create
      patch "/boms/:id", BOMController, :update
      post "/boms/:id/set-primary", BOMController, :set_primary
      post "/boms/:id/revert", BOMController, :revert
      get "/boms/:bom_id/versions", BOMController, :versions
      delete "/boms/:id", BOMController, :delete

      get "/workstation-groups", WorkstationGroupController, :index
      get "/workstation-groups/:id", WorkstationGroupController, :show
      post "/workstation-groups", WorkstationGroupController, :create
      patch "/workstation-groups/:id", WorkstationGroupController, :update
      delete "/workstation-groups/:id", WorkstationGroupController, :delete

      get "/workstations", WorkstationController, :index
      get "/workstations/:id", WorkstationController, :show
      post "/workstations", WorkstationController, :create
      patch "/workstations/:id", WorkstationController, :update
      delete "/workstations/:id", WorkstationController, :delete

      get "/machines", MachineController, :index
      get "/machines/:id", MachineController, :show
      post "/machines", MachineController, :create
      patch "/machines/:id", MachineController, :update
      delete "/machines/:id", MachineController, :delete
      post "/machines/:id/recalibrate", MachineController, :recalibrate

      get "/routings", RoutingController, :index
      get "/routings/:id", RoutingController, :show
      post "/routings", RoutingController, :create
      patch "/routings/:id", RoutingController, :update
      delete "/routings/:id", RoutingController, :delete

      get "/manufacturing-orders", ManufacturingOrderController, :index
      get "/manufacturing-orders/:id", ManufacturingOrderController, :show
      # Phase 7 — actual labour + machine cost per step / per MO,
      # sourced from WorkstationSession + point-in-time EmployeeWage.
      get "/manufacturing-orders/:id/cost-breakdown",
          MOCostBreakdownController,
          :show
      # Chronological session timeline for the MO detail page —
      # every WorkstationSession attributed to any step of this MO.
      get "/manufacturing-orders/:id/sessions",
          MOSessionsController,
          :index
      post "/manufacturing-orders", ManufacturingOrderController, :create
      patch "/manufacturing-orders/:id", ManufacturingOrderController, :update
      post "/manufacturing-orders/:id/transition",
           ManufacturingOrderController,
           :transition

      post "/manufacturing-orders/:id/shift",
           ManufacturingOrderController,
           :shift

      post "/manufacturing-orders/:id/shift-chain",
           ManufacturingOrderController,
           :shift_chain

      post "/manufacturing-orders/:id/schedule",
           ManufacturingOrderController,
           :schedule

      post "/manufacturing-orders/:id/schedule-chain",
           ManufacturingOrderController,
           :schedule_chain

      post "/manufacturing-orders/:id/unschedule",
           ManufacturingOrderController,
           :unschedule

      post "/manufacturing-orders/:id/unschedule-chain",
           ManufacturingOrderController,
           :unschedule_chain

      get "/manufacturing-orders/:id/merge-candidates",
          ManufacturingOrderController,
          :merge_candidates

      post "/manufacturing-orders/:id/merge-into",
           ManufacturingOrderController,
           :merge_into

      delete "/manufacturing-orders/:id",
             ManufacturingOrderController,
             :delete

      # Warehouse-pickup release gate. Planner stamps the MO with a
      # released-at timestamp + optional per-MO window override; the
      # picker queue then surfaces it inside its visibility window.
      # Unrelease yanks it back as long as pickup hasn't started.
      post "/manufacturing-orders/:id/release-to-warehouse",
           ManufacturingOrderController,
           :release

      delete "/manufacturing-orders/:id/release-to-warehouse",
             ManufacturingOrderController,
             :unrelease

      # Replan housekeeping — planner clears the `needs_replan` flag
      # after fixing the bookings. Refuses if the MO is still under-
      # booked so the flag can't be cleared while the underlying
      # shortage exists.
      post "/manufacturing-orders/:id/clear-replan",
           ManufacturingOrderController,
           :clear_replan

      # Production-run sign-off (the desktop /production/runs tab). The
      # production operator hits Start when they begin work, then Finish
      # at the end (date/time + actual produced qty). Finish auto-
      # creates the output stock_lot at the production-feed cell.
      get "/runs", ManufacturingOrderController, :runs

      # Output QC — production-side quality sign-off on a manufactured
      # lot before it can transfer to the warehouse. Distinct from the
      # `stock.qc` flow that covers incoming PO receives.
      get "/output-qc", ManufacturingOrderController, :output_qc_queue

      post "/output-qc/:lot_uuid",
           ManufacturingOrderController,
           :output_qc_sign_off

      post "/manufacturing-orders/:id/start-production",
           ManufacturingOrderController,
           :start_production

      post "/manufacturing-orders/:id/finish-production",
           ManufacturingOrderController,
           :finish_production

      # Per-MO operation steps — snapshot of the routing template,
      # editable per-MO. Pencil-on-row → edit page.
      get "/manufacturing-orders/:mo_id/steps/:id",
          ManufacturingOrderStepController,
          :show

      patch "/manufacturing-orders/:mo_id/steps/:id",
            ManufacturingOrderStepController,
            :update

      post "/manufacturing-orders/:mo_id/steps/:id/move",
           ManufacturingOrderStepController,
           :move

      post "/manufacturing-orders/:mo_id/steps/:id/set-segments",
           ManufacturingOrderStepController,
           :set_segments

      # MO stock bookings — operator-driven reservations against
      # specific lots. `bookable-lots` returns the candidate list
      # for the "Add a booking" dialog with available-qty computed
      # live so two operators can't over-reserve.
      get "/manufacturing-orders/:mo_id/bookings",
          ManufacturingOrderBookingController,
          :index

      get "/manufacturing-orders/:mo_id/bookable-lots",
          ManufacturingOrderBookingController,
          :bookable_lots

      post "/manufacturing-orders/:mo_id/bookings",
           ManufacturingOrderBookingController,
           :create

      post "/manufacturing-orders/:mo_id/bookings/book-all",
           ManufacturingOrderBookingController,
           :book_all

      post "/manufacturing-orders/:mo_id/bookings/release-all",
           ManufacturingOrderBookingController,
           :release_all

      patch "/manufacturing-orders/:mo_id/bookings/:id",
            ManufacturingOrderBookingController,
            :update

      delete "/manufacturing-orders/:mo_id/bookings/:id",
             ManufacturingOrderBookingController,
             :delete

      # Final Product Release (BRCGS Issue 9 § 5.6 Positive Release).
      # Dual sign-off ceremony that flips an `awaiting_release`
      # finished-product lot to `available` (or Hold / Reject).
      # Every action gates on `production.final_release`; the context
      # module enforces releaser ≠ approver.
      get "/final-releases/queue",
          ProductionFinalReleaseController,
          :queue

      get "/final-releases/by-lot/:lot_uuid",
          ProductionFinalReleaseController,
          :by_lot

      patch "/final-releases/:uuid/notes",
            ProductionFinalReleaseController,
            :update_notes

      post "/final-releases/:uuid/files",
           ProductionFinalReleaseController,
           :upload_file

      # Auto-generate the BMR PDF from the MO's production data and
      # attach it as the required `bmr` evidence file. See
      # `Backend.Documents.production_bmr_pdf/1`.
      post "/final-releases/:uuid/generate/bmr",
           ProductionFinalReleaseController,
           :generate_bmr

      delete "/final-releases/:uuid/files/:file_uuid",
             ProductionFinalReleaseController,
             :delete_file

      get "/final-releases/:uuid/files/:file_uuid",
          ProductionFinalReleaseController,
          :serve_file

      post "/final-releases/:uuid/sign-releaser",
           ProductionFinalReleaseController,
           :sign_releaser

      post "/final-releases/:uuid/sign-approver",
           ProductionFinalReleaseController,
           :sign_approver

      post "/final-releases/:uuid/clear-signature",
           ProductionFinalReleaseController,
           :clear_signature

      post "/final-releases/:uuid/release",
           ProductionFinalReleaseController,
           :release

      post "/final-releases/:uuid/hold",
           ProductionFinalReleaseController,
           :hold

      post "/final-releases/:uuid/reject",
           ProductionFinalReleaseController,
           :reject
    end

    # 3PL — third-party logistics / bailee custody. Routing action
    # runs immediately after Positive Release (BRCGS Issue 9 § 5.6
    # follow-up + § 4.4 segregation). The routing decision is a
    # lifecycle event on the lot; capacity is pre-checked so the
    # operator sees "no 3PL space" before we accept the choice.
    # Outbound shipments — customer-facing dispatch record. Triggered
    # once a released lot is physically staged in a dispatch cell
    # (BRCGS Issue 9 § 5.4.6). Draft → ready → picked_up.
    scope "/shipments" do
      post "/", ShipmentController, :create
      get "/", ShipmentController, :index
      get "/:uuid", ShipmentController, :show
      patch "/:uuid", ShipmentController, :update
      post "/:uuid/mark-ready", ShipmentController, :mark_ready
      post "/:uuid/mark-draft", ShipmentController, :mark_draft
      post "/:uuid/pickup", ShipmentController, :pickup
      post "/:uuid/cancel", ShipmentController, :cancel

      # Desktop nudges the operator's paired phone to open the
      # dispatch form. Broadcast lands on user:<uuid>; mobile shell
      # listener shows a slide-up banner.
      post "/:uuid/dispatch-push", ShipmentController, :dispatch_push

      # Truck-arrival dispatch photos.
      get "/:uuid/pickup-files", ShipmentController, :list_pickup_files
      post "/:uuid/pickup-files", ShipmentController, :upload_pickup_file
      get "/:uuid/pickup-files/:file_uuid/blob", ShipmentController, :serve_pickup_file
      delete "/:uuid/pickup-files/:file_uuid", ShipmentController, :delete_pickup_file

      # Delivery confirmation + POD photos.
      post "/:uuid/confirm-delivery", ShipmentController, :confirm_delivery
      get "/:uuid/delivery-files", ShipmentController, :list_delivery_files
      post "/:uuid/delivery-files", ShipmentController, :upload_delivery_file
      get "/:uuid/delivery-files/:file_uuid/blob", ShipmentController, :serve_delivery_file
      delete "/:uuid/delivery-files/:file_uuid", ShipmentController, :delete_delivery_file
    end

    scope "/three-pl" do
      post "/route/:lot_uuid", ThreePLController, :route_lot
      # Dispatch is a two-step flow: desktop queues the request, mobile
      # picker executes the physical move + attaches the arrival photo.
      post "/dispatch-requests", ThreePLController, :request_dispatch
      get "/dispatch-requests", ThreePLController, :list_pending_dispatches
      get "/dispatch-requests/:uuid", ThreePLController, :get_dispatch
      post "/dispatch-requests/:uuid/complete", ThreePLController, :complete_dispatch
      post "/dispatch-requests/:uuid/cancel", ThreePLController, :cancel_dispatch
      get "/inventory", ThreePLController, :inventory
      get "/lots/:lot_uuid", ThreePLController, :lot_detail
      get "/capacity/:warehouse_uuid", ThreePLController, :capacity
    end

    # Goods-In Inspection — show / update / item / sign actions sit
    # outside the PO scope because the inspection has its own uuid
    # and the operator may move between inspections without first
    # opening the parent PO.
    scope "/goods-in-inspections" do
      get "/:id", GoodsInInspectionController, :show
      patch "/:id", GoodsInInspectionController, :update
    end

    # Inspections ledger — global "Goods-In Inspections" feed across
    # every PO for the company. Mirrors `/procurement/invoices` so the
    # desktop tables feel the same. Per-inspection show / update /
    # sign still live under `/goods-in-inspections/:id`.
    get "/procurement/inspections", GoodsInInspectionController, :index_global

    # Shortages table — every raw_material / packaging item still
    # short across open MOs after subtracting bookings + open-PO
    # qty. Drives the /procurement/shortages page so procurement
    # has a single list of "what to order next".
    get "/procurement/shortages", ProcurementShortagesController, :index

    # Reorder suggestions — items whose coverage (on-hand + in-flight
    # PO qty) has fallen below their configured min_stock_qty. Feeds
    # the my-tasks queue for users with procurement.po_create and the
    # /procurement overview banner.
    get "/procurement/reorder-suggestions",
        ReorderSuggestionsController,
        :index

    # AP ledger — vendor invoices. Index is the global "Incoming
    # invoices" feed (MRPEasy parity); :show / :update / :delete and
    # the lifecycle transitions sit under the same scope. File serve
    # is here too so a deep-link works without a parent PO context.
    scope "/procurement/invoices" do
      get "/", ProcurementInvoiceController, :index_global
      get "/:id", ProcurementInvoiceController, :show
      patch "/:id", ProcurementInvoiceController, :update
      delete "/:id", ProcurementInvoiceController, :delete

      post "/:id/mark-paid", ProcurementInvoiceController, :mark_paid
      post "/:id/dispute", ProcurementInvoiceController, :mark_disputed
      post "/:id/void", ProcurementInvoiceController, :mark_void

      post "/:id/file", ProcurementInvoiceController, :attach_file
      delete "/:id/file", ProcurementInvoiceController, :detach_file
      get "/:id/file/serve", ProcurementInvoiceController, :serve_file
    end

    scope "/goods-in-inspections/:goods_in_inspection_id" do
      post "/items/:line_uuid", GoodsInInspectionController, :upsert_item
      post "/sign-operator", GoodsInInspectionController, :sign_operator
      post "/sign-quality", GoodsInInspectionController, :sign_quality

      # Operator-captured photos + supporting paperwork. Bytes live in
      # `Backend.Storage`; metadata scopes by `goods_in_inspection_id`
      # so files only resolve under their owning inspection. Allowed
      # while the inspection is mutable (draft | submitted); locked
      # once the approver signs.
      post "/files", GoodsInInspectionController, :upload_file
      delete "/files/:id", GoodsInInspectionController, :delete_file
      get "/files/:id/serve", GoodsInInspectionController, :serve_file
    end

    # Catalogue shape — product families + admin-extensible attribute
    # definitions. Read paths borrow `items.view`; write paths gated
    # by their dedicated `.manage` permission codes.
    resources "/product-families", ProductFamilyController,
      except: [:new, :edit]

    resources "/attribute-definitions", AttributeDefinitionController,
      except: [:new, :edit]

    # Global lookups — EU 1169/2011 Annex II allergens + the regulator
    # claim register. Read-only; `items.view` for access.
    get "/allergens", AllergenController, :index
    get "/claim-register", ClaimRegisterController, :index

    # "Needs attention" queues. Surface raw-material reviews coming
    # due + certificate attachments expiring soon.
    scope "/queues" do
      get "/reviews-due", QueueController, :reviews_due
      get "/certificates-expiring", QueueController, :certificates_expiring
    end

    # Mobile shell endpoints — slim, denormalised projections the
    # tablet UI in /m/* consumes. Lives under /api/m so the wire path
    # mirrors the FE route. Same RequireAuth pipeline as the rest of
    # /api — device tokens fall through transparently.
    scope "/m" do
      get "/incoming", MobileIncomingController, :index

      # Warehouse pickup workflow. The picker queue surfaces released
      # MOs whose pickup window has opened; per-MO endpoints drive the
      # scan + transfer flow. Gated by `warehouse.pick` in the
      # controller.
      get "/pickup-queue", WarehousePickupController, :queue
      get "/pickup/production-feed-cells",
          WarehousePickupController,
          :production_feed_cells
      get "/pickup/:mo_uuid", WarehousePickupController, :show
      post "/pickup/:mo_uuid/start", WarehousePickupController, :start
      post "/pickup/:mo_uuid/abort", WarehousePickupController, :abort

      post "/pickup/:mo_uuid/bookings/:booking_uuid/mark-picked",
           WarehousePickupController,
           :mark_picked

      post "/pickup/:mo_uuid/confirm-transfer",
           WarehousePickupController,
           :confirm_transfer

      # Pre-production receipt check. After the picker confirms
      # transfer, the production operator signs off each booking
      # (received qty + quality notes). MO can't transition to
      # `in_progress` until every raw-material/packaging booking is
      # received. Gated by `production.preflight` in the controller.
      get "/preflight-queue", ProductionPreflightController, :queue
      get "/preflight/:mo_uuid", ProductionPreflightController, :show

      post "/preflight/:mo_uuid/bookings/:booking_uuid/receive",
           ProductionPreflightController,
           :receive_booking

      # Production closeout — post-Finish hand-off to the production-
      # side dispatch cell. Gated by `production.closeout`; warehouse
      # pickup-from-production is a separate slice owned by warehouse
      # operators.
      get "/closeout-queue", ProductionCloseoutController, :queue
      get "/closeout/:mo_uuid", ProductionCloseoutController, :show
      get "/closeout/:mo_uuid/dispatch-cells",
          ProductionCloseoutController,
          :dispatch_cells

      post "/closeout/:mo_uuid/bookings/:booking_uuid",
           ProductionCloseoutController,
           :close_booking

      post "/closeout/:mo_uuid/output-lots/:lot_uuid",
           ProductionCloseoutController,
           :close_output

      # Warehouse return pickup — Phase C. Warehouse worker walks
      # the production-side dispatch cells, scans lots onto the
      # trolley, then places every lot back into warehouse storage.
      # Gated by `warehouse.return_pickup`.
      get "/return-pickup-queue", WarehouseReturnPickupController, :queue
      get "/return-pickup/loose", WarehouseReturnPickupController, :loose
      get "/return-pickup/trolley", WarehouseReturnPickupController, :trolley
      get "/return-pickup/:mo_uuid", WarehouseReturnPickupController, :show

      post "/return-pickup/lots/:lot_uuid/pick",
           WarehouseReturnPickupController,
           :pick

      get "/return-pickup/picks/:pick_uuid/recommendations",
          WarehouseReturnPickupController,
          :recommendations

      post "/return-pickup/picks/:pick_uuid/place",
           WarehouseReturnPickupController,
           :place

      post "/return-pickup/picks/:pick_uuid/abort",
           WarehouseReturnPickupController,
           :abort

    end

    # Linked devices — phones/tablets/extra browsers a user has paired
    # to their account. The user always acts on their own row (scoped
    # in the context), so no separate RBAC perm is needed.
    get "/devices", LinkedDeviceController, :index
    post "/devices/pairing-codes", LinkedDeviceController, :create_pairing_code
    post "/devices/push-navigate", LinkedDeviceController, :push_navigate
    delete "/devices/:uuid", LinkedDeviceController, :revoke
    post "/devices/:uuid/ping", LinkedDeviceController, :ping
    post "/devices/:uuid/push-navigate", LinkedDeviceController, :push_navigate_one

    # Stock — lots, placements, movements. Read-only in Slice 1;
    # receive/move/consume/dispose endpoints land in subsequent
    # slices through dedicated POST routes (no generic CRUD because
    # qty changes are always recorded movements).
    # Equipment registry — serial-tracked units with cadence-driven
    # maintenance + calibration lifecycle. Companion to /stock but
    # distinct model (units, not lots). Sits at the api root so the
    # module can grow its own detail + events + files sub-routes.
    scope "/equipment" do
      get "/", EquipmentController, :index
      post "/", EquipmentController, :create
      # `due-soon` sits above `/:id` so it doesn't collide with a
      # UUID lookup. Query param `?horizon_days=N` narrows / widens
      # the window (default 14).
      get "/due-soon", EquipmentController, :due_soon
      get "/:id", EquipmentController, :show
      # Lifecycle event dispatch — kind in the body selects the
      # transition (in_service / moved / retired / disposed / …).
      # Per-kind permission gate lives inside the controller.
      post "/:id/events", EquipmentController, :events_create
      get "/:id/events", EquipmentController, :events_index
      # File attachments — cal certs, service reports, warranty PDFs,
      # nameplate photos. Same shape as /po/:id/files.
      get "/:id/files", EquipmentController, :files_index
      post "/:id/files", EquipmentController, :file_create
      delete "/:id/files/:file_id", EquipmentController, :file_delete
      get "/:id/files/:file_id/blob", EquipmentController, :file_blob
    end

    scope "/stock" do
      # Manual lot creation — operator-authored entries (opening
      # balances, ad-hoc adjustments). Sits above `resources` so the
      # `/manual` segment doesn't collide with `/:id`. Real receives
      # against a Purchase Order will land on a dedicated endpoint
      # in the procurement module.
      post "/lots/manual", StockLotController, :create_manual

      # Bulk manual receive — one delivery, mixed packaging (4 drums +
      # 1 sack). Each pack becomes its own stock_lot inside one
      # transaction so the operator gets all-or-nothing semantics.
      post "/lots/manual-bulk", StockLotController, :create_manual_bulk

      # Item-level inventory rollup — one row per item with on-hand
      # qty + cost value summed across all its non-zero placements.
      # Used by /stock/inventory.
      get "/inventory", StockLotController, :inventory

      # Put-away queue + scanner lookups (mobile /m flow).
      get "/lots/pending-putaway", StockLotController, :pending_putaway
      get "/lots/scan/:uuid", StockLotController, :scan_lot
      get "/cells/scan/:uuid", StockLotController, :scan_cell
      get "/floors/:uuid/plan", StockLotController, :floor_plan

      # Packaging dim suggestions for the receive form — item default
      # + last lot + 10-lot median. Backs the auto-fill pills.
      get "/items/:item_id/packaging-suggestions",
          StockLotController,
          :packaging_suggestions

      resources "/lots", StockLotController, only: [:index, :show, :update] do
        # Move qty between cells — atomic, records a `move` movement
        # carrying the photo URL or skip-reason. Source defaults to
        # the lot's only non-zero placement (put-away-from-Unregistered
        # case).
        post "/move", StockLotController, :move

        # Manual qty adjustment — stock-take corrections, damage,
        # shrinkage. Records an adjust_up / adjust_down movement so
        # the divergence shows up on the lot's history.
        post "/adjust", StockLotController, :adjust

        # Consumable draw-down — PPE handout, sanitiser pour, spare
        # parts issue. Records an `issue` movement carrying the
        # recipient + purpose + optional MO link.
        post "/issue", StockLotController, :issue

        # Ranked suggestions for the put-away destination: same-item
        # consolidation + matching storage tags. Mobile shows these as
        # one-tap cards so the camera viewfinder is the fallback,
        # not the default.
        get "/move-recommendations", StockLotController, :move_recommendations

        # Lifecycle event timeline + recording. Per-kind permission
        # dispatch lives inside the controller (qc_passed → stock.qc,
        # held → stock.hold, disposed → stock.dispose). System-only
        # kinds (received / expected) are rejected at the controller.
        get "/events", StockLotController, :events_index
        post "/events", StockLotController, :events_create
      end

      # Flat cell picker for the create-manual-lot form — returns
      # every company cell with warehouse + location breadcrumbs.
      get "/cells", StockLotController, :cells

      # Photo upload for the move flow. Two-step on purpose: photo
      # lands first, URL gets stamped on the movement on confirm.
      post "/movement-photos", MovementPhotoController, :create
      get "/movement-photos/:uuid/file", MovementPhotoController, :serve_file
    end
  end

  # Polymorphic comments mounted per-entity so the URLs stay
  # intuitive. Each scope stamps the entity_type via its pipeline so
  # the shared controller knows which kind of row the URL uuid is for.
  # Read perm = entity's view perm; write perm = entity's edit perm.

  scope "/api/vendors/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_vendor]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/customers/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_customer]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/pricelists/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_pricelist]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/customer-orders/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_customer_order]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/customer-invoices/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_customer_invoice]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/customer-returns/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_customer_return]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/loyalty/programs/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_loyalty_program]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/purchase-orders/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_purchase_order]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/stock/lots/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_stock_lot]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/production/boms/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_bom]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/production/workstation-groups/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_workstation_group]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/production/workstations/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_workstation]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/production/machines/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_machine]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/production/routings/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_routing]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/production/manufacturing-orders/:entity_uuid/comments",
        BackendWeb do
    pipe_through [:api_authed, :comments_manufacturing_order]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/production/manufacturing-order-steps/:entity_uuid/comments",
        BackendWeb do
    pipe_through [:api_authed, :comments_manufacturing_order_step]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/shipments/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_shipment]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/equipment/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_equipment]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  scope "/api/hr/employees/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_hr_employee]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  # PO-line comments — line uuid is globally unique. The controller
  # + channel resolve to the PurchaseOrderLine row and check the
  # parent PO belongs to the actor's company.
  scope "/api/purchase-order-lines/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_purchase_order_line]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete

    # Messenger-style extras — attachments + emoji reactions.
    post "/:comment_uuid/files", CommentsController, :upload_file
    get "/:comment_uuid/files/:file_uuid/serve", CommentsController, :serve_file
    delete "/:comment_uuid/files/:file_uuid", CommentsController, :delete_file
    post "/:comment_uuid/reactions", CommentsController, :add_reaction
    delete "/:comment_uuid/reactions/:emoji", CommentsController, :remove_reaction
    delete "/:comment_uuid/reactions", CommentsController, :remove_reaction
  end

  # -------------------------------------------------------------------
  # Integration API — machine-to-machine callers (vita-performance
  # today). The pipeline verifies the bearer token; each route layers
  # its own required scope via a per-route plug (see e.g. `mo:read`
  # on the manufacturing-orders index). `/health` is the smallest
  # possible surface — token identity + granted scopes echoed back.
  # -------------------------------------------------------------------
  scope "/api/integration", BackendWeb do
    pipe_through :api_integration

    get "/health", IntegrationHealthController, :show

    # Read-side (per-action scope check happens inside the controller).
    get "/manufacturing-orders", IntegrationReadController, :list_manufacturing_orders
    get "/manufacturing-orders/:uuid", IntegrationReadController, :get_manufacturing_order
    get "/workstations", IntegrationReadController, :list_workstations
    get "/items", IntegrationReadController, :list_items
    get "/items/:uuid", IntegrationReadController, :get_item
    get "/hr/employees", IntegrationReadController, :list_employees

    # Write-side
    # Push an R&D-side BOM snapshot onto the finished-product
    # item. Idempotent from a versioning POV — repeated calls
    # write a new ``bom_version`` row on the existing BOM so the
    # history captures every push. Requires ``bom:write``.
    put "/items/:uuid/bom", IntegrationBomController, :upsert

    post "/manufacturing-orders/:uuid/steps/:step_uuid/sessions",
         IntegrationSessionController,
         :create_mo_session

    post "/workstations/:uuid/sessions",
         IntegrationSessionController,
         :create_workstation_session

    # Seed an HR Employee from the vita-performance side. Idempotent
    # via external_id — repeated pushes for the same vp Worker
    # return the existing Employee. Requires `hr:write` scope.
    post "/hr/employees", IntegrationHRController, :create_employee

    # Push an initial (or historical) wage row for an Employee.
    # Idempotent via `external_id` — the vp seed uses this to carry
    # each Worker's current `hourly_rate` across without recreating
    # the row on re-seed. Requires `hr:write` scope.
    post "/hr/employees/:employee_uuid/wages",
         IntegrationHRController,
         :create_wage

    # Push a reputation event for an Employee, preserving the original
    # `occurred_at` timestamp so the decay projection matches vp's
    # cached score. Idempotent via `external_id` (stored in the schema
    # slot `session_external_id`). Requires `hr:write:reputation`.
    post "/hr/employees/:employee_uuid/reputation-events",
         IntegrationHRController,
         :create_reputation_event
  end

  # Enable LiveDashboard and Swoosh mailbox preview in development.
  # Runtime `BackendWeb.Plugs.DevDashboardAuth` adds BasicAuth (or
  # loopback-only in local dev) on top of the compile-time gate so
  # even a staging build that accidentally flagged `dev_routes: true`
  # can't expose the dashboard to the public internet.
  if Application.compile_env(:backend, :dev_routes) do
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through [
        :fetch_session,
        :protect_from_forgery,
        BackendWeb.Plugs.DevDashboardAuth
      ]

      live_dashboard "/dashboard", metrics: BackendWeb.Telemetry
      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end
end
