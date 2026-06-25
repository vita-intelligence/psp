defmodule BackendWeb.Router do
  use BackendWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :api_authed do
    plug :accepts, ["json"]
    plug BackendWeb.Plugs.RequireAuth
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

  pipeline :comments_routing do
    plug :put_entity_type, "routing"
  end

  pipeline :comments_manufacturing_order do
    plug :put_entity_type, "manufacturing_order"
  end

  pipeline :comments_manufacturing_order_step do
    plug :put_entity_type, "manufacturing_order_step"
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

    # Phone → laptop print bridge. Lands a `print_label` push on the
    # actor's `user:<uuid>` channel.
    post "/realtime/print-label", PrintBridgeController, :print_label
    get "/team", UserController, :team
    get "/users", UserController, :index
    get "/users/:id", UserController, :show
    put "/users/:id/access", UserController, :update_access

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
    put "/company/warehouse-pickup", CompanyController, :update_warehouse_pickup
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

      # Wizard CTA: create an MO pre-linked to the chosen CO line.
      post "/lines/:line_uuid/create-mo",
           CustomerOrderController,
           :create_mo_for_line
    end

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

      get "/routings", RoutingController, :index
      get "/routings/:id", RoutingController, :show
      post "/routings", RoutingController, :create
      patch "/routings/:id", RoutingController, :update
      delete "/routings/:id", RoutingController, :delete

      get "/manufacturing-orders", ManufacturingOrderController, :index
      get "/manufacturing-orders/:id", ManufacturingOrderController, :show
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
    delete "/devices/:uuid", LinkedDeviceController, :revoke
    post "/devices/:uuid/ping", LinkedDeviceController, :ping

    # Stock — lots, placements, movements. Read-only in Slice 1;
    # receive/move/consume/dispose endpoints land in subsequent
    # slices through dedicated POST routes (no generic CRUD because
    # qty changes are always recorded movements).
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
  end

  scope "/api/customers/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_customer]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete
  end

  scope "/api/pricelists/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_pricelist]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete
  end

  scope "/api/customer-orders/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_customer_order]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete
  end

  scope "/api/customer-invoices/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_customer_invoice]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete
  end

  scope "/api/customer-returns/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_customer_return]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete
  end

  scope "/api/loyalty/programs/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_loyalty_program]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete
  end

  scope "/api/purchase-orders/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_purchase_order]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete
  end

  scope "/api/stock/lots/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_stock_lot]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete
  end

  scope "/api/production/boms/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_bom]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete
  end

  scope "/api/production/workstation-groups/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_workstation_group]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete
  end

  scope "/api/production/workstations/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_workstation]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete
  end

  scope "/api/production/routings/:entity_uuid/comments", BackendWeb do
    pipe_through [:api_authed, :comments_routing]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete
  end

  scope "/api/production/manufacturing-orders/:entity_uuid/comments",
        BackendWeb do
    pipe_through [:api_authed, :comments_manufacturing_order]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete
  end

  scope "/api/production/manufacturing-order-steps/:entity_uuid/comments",
        BackendWeb do
    pipe_through [:api_authed, :comments_manufacturing_order_step]

    get "/", CommentsController, :index
    post "/", CommentsController, :create
    patch "/:comment_uuid", CommentsController, :update
    delete "/:comment_uuid", CommentsController, :delete
  end

  # Enable LiveDashboard and Swoosh mailbox preview in development
  if Application.compile_env(:backend, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through [:fetch_session, :protect_from_forgery]

      live_dashboard "/dashboard", metrics: BackendWeb.Telemetry
      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end
end
