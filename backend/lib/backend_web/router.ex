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

  pipeline :comments_purchase_order do
    plug :put_entity_type, "purchase_order"
  end

  pipeline :comments_stock_lot do
    plug :put_entity_type, "stock_lot"
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
    put "/company/bag", CompanyController, :update_bag

    put "/company/currency-rates/auto-pull",
        CompanyController,
        :update_currency_rates_auto_pull

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
        # meaning outside the parent so :index is omitted (cells
        # come along on the location payload).
        resources "/cells", StorageCellController,
          except: [:new, :edit, :index]
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
    end

    # Goods-In Inspection — show / update / item / sign actions sit
    # outside the PO scope because the inspection has its own uuid
    # and the operator may move between inspections without first
    # opening the parent PO.
    scope "/goods-in-inspections" do
      get "/:id", GoodsInInspectionController, :show
      patch "/:id", GoodsInInspectionController, :update
    end

    scope "/goods-in-inspections/:goods_in_inspection_id" do
      post "/items/:line_uuid", GoodsInInspectionController, :upsert_item
      post "/sign-operator", GoodsInInspectionController, :sign_operator
      post "/sign-quality", GoodsInInspectionController, :sign_quality
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
