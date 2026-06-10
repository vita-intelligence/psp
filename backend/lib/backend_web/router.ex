defmodule BackendWeb.Router do
  use BackendWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :api_authed do
    plug :accepts, ["json"]
    plug BackendWeb.Plugs.RequireAuth
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
      resources "/lots", StockLotController, only: [:index, :show]

      # Flat cell picker for the create-manual-lot form — returns
      # every company cell with warehouse + location breadcrumbs.
      get "/cells", StockLotController, :cells
    end
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
