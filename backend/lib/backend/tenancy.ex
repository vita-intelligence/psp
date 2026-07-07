defmodule Backend.Tenancy do
  @moduledoc """
  Tenant-scope checks for realtime channel topics.

  `FormChannel` topics look like `form:<resource>:<id>`. Before this
  module existed, `FormChannel.can_edit_resource?/2` only asked "does
  this user hold the RBAC scope for editing THIS KIND of resource?"
  — never "does this specific ID live in the user's company?" That
  gap meant an editor in tenant A could subscribe to a peer's edit
  session in tenant B and watch keystrokes over the `field:change`
  broadcast.

  Every resource that reaches the form channel has a clause below.
  Resources without a clause deny by default — no silent
  allow-through.

  The special `"new"` id is always accepted: a draft form isn't yet
  attached to any row, and the eventual HTTP save is guarded by the
  usual controller layer.
  """

  alias Backend.{
    Accounts,
    Catalogs,
    Certificates,
    Comments,
    CustomerInvoices,
    CustomerOrders,
    CustomerReturns,
    Customers,
    GoodsIn,
    Items,
    Loyalty,
    Pricelists,
    Procurement,
    Production,
    Purchasing,
    RBAC,
    Shipments,
    Stock,
    Units,
    Vendors,
    Warehouses
  }

  alias Backend.Warehouses.StorageTags

  @doc """
  True when the topic's `resource:id` pair belongs in `user`'s tenant.

  Draft rooms (`"new"`) always pass. Otherwise the resource is
  resolved server-side and its `company_id` compared to the actor's.
  Unknown resources deny.
  """
  @spec resource_in_tenant?(map, String.t(), String.t()) :: boolean
  def resource_in_tenant?(_user, _resource, "new"), do: true

  # `invoice:<po_uuid>:new` — creating a vendor-invoice against a PO.
  # `parse_topic/1` uses `String.split(rest, ":", parts: 2)`, so this
  # arrives as id=`"<po_uuid>:new"`. Reduce it to the PO uuid, then
  # verify the PO belongs to the tenant.
  def resource_in_tenant?(user, "invoice", id) when is_binary(id) do
    case String.split(id, ":") do
      [po_uuid, "new"] -> exists?(Purchasing.get_for_company(user.company_id, po_uuid))
      [uuid] -> exists?(Procurement.get_for_company(user.company_id, uuid))
      _ -> false
    end
  end

  # --- Warehouses / production facilities -------------------------
  def resource_in_tenant?(user, "warehouse", uuid),
    do: exists?(Warehouses.get_for_company(user.company_id, uuid))

  def resource_in_tenant?(user, "production-facility", uuid),
    do: exists?(Warehouses.get_for_company(user.company_id, uuid))

  # The plan editor room is per-warehouse — the id IS a warehouse uuid.
  def resource_in_tenant?(user, "warehouse-cells", uuid),
    do: exists?(Warehouses.get_for_company(user.company_id, uuid))

  def resource_in_tenant?(user, "storage-tag", uuid),
    do: exists?(StorageTags.get_for_company(user.company_id, uuid))

  # --- Company singleton ------------------------------------------
  # Topic shapes we accept:
  #   * `form:company:<int_id>`                — legacy single-id form
  #   * `form:company:<int_id>:<sub_form>`     — every settings sub-form
  #     the frontend spawns (`identity`, `locale`, `holidays`,
  #     `working-hours`, `allowed-ips`, `warehouse-pickup`,
  #     `three-pl-rate`, `numbering`, `security`, …).
  #
  # `parse_topic/1` on the channel splits with `parts: 2`, so we get
  # `id = "<int_id>"` or `id = "<int_id>:<sub_form>"`. Only the leading
  # numeric segment is authoritative for tenant scoping — the
  # sub-form suffix is a client-side room-namespace and doesn't
  # change tenant membership.
  def resource_in_tenant?(user, "company", id) when is_binary(id) do
    case String.split(id, ":", parts: 2) do
      [prefix | _] -> to_string(user.company_id) == prefix
      _ -> false
    end
  end

  # --- Users / roles ----------------------------------------------
  def resource_in_tenant?(user, "user-access", target_uuid) when is_binary(target_uuid) do
    case Accounts.get_user_by_uuid(target_uuid) do
      %{company_id: cid} when cid == user.company_id -> true
      _ -> false
    end
  end

  # Role templates carry a company_id.
  def resource_in_tenant?(user, "role", uuid) when is_binary(uuid) do
    case RBAC.get_template(uuid) do
      %{company_id: cid} when cid == user.company_id -> true
      _ -> false
    end
  end

  # --- Catalog primitives -----------------------------------------
  def resource_in_tenant?(user, "item", uuid),
    do: exists?(Items.get_for_company(user.company_id, uuid))

  def resource_in_tenant?(user, "product-family", uuid),
    do: exists?(Catalogs.get_family_for_company(user.company_id, uuid))

  def resource_in_tenant?(user, "attribute-definition", uuid),
    do: exists?(Catalogs.get_attribute_definition_for_company(user.company_id, uuid))

  def resource_in_tenant?(user, "certificate", uuid),
    do: exists?(Certificates.get_for_company(user.company_id, uuid))

  def resource_in_tenant?(user, "unit-of-measurement", uuid),
    do: exists?(Units.get_for_company(user.company_id, uuid))

  # --- Vendor / customer / pricelist ------------------------------
  def resource_in_tenant?(user, "vendor", uuid),
    do: exists?(Vendors.get_for_company(user.company_id, uuid))

  def resource_in_tenant?(user, "customer", uuid),
    do: exists?(Customers.get_for_company(user.company_id, uuid))

  def resource_in_tenant?(user, "pricelist", uuid),
    do: exists?(Pricelists.get_for_company(user.company_id, uuid))

  # --- Sales orders / invoices / returns / loyalty ----------------
  def resource_in_tenant?(user, "customer-order", uuid),
    do: exists?(CustomerOrders.get_for_company(user.company_id, uuid))

  def resource_in_tenant?(user, "customer-invoice", uuid),
    do: exists?(CustomerInvoices.get_for_company(user.company_id, uuid))

  def resource_in_tenant?(user, "customer-return", uuid),
    do: exists?(CustomerReturns.get_for_company(user.company_id, uuid))

  def resource_in_tenant?(user, "loyalty-program", uuid),
    do: exists?(Loyalty.get_program(user.company_id, uuid))

  # --- Procurement ------------------------------------------------
  def resource_in_tenant?(user, "purchase-order", uuid),
    do: exists?(Purchasing.get_for_company(user.company_id, uuid))

  # PO receive dialog — id is the PO uuid.
  def resource_in_tenant?(user, "po-receive", uuid),
    do: exists?(Purchasing.get_for_company(user.company_id, uuid))

  # --- Stock ------------------------------------------------------
  def resource_in_tenant?(user, "stock-lot", uuid),
    do: exists?(Stock.get_for_company(user.company_id, uuid))

  # --- Equipment --------------------------------------------------
  def resource_in_tenant?(user, "equipment", uuid),
    do: exists?(Backend.Equipment.get_for_company(user.company_id, uuid))

  # --- Production -------------------------------------------------
  def resource_in_tenant?(user, "workstation-group", uuid),
    do: exists?(Production.get_workstation_group(user.company_id, uuid))

  def resource_in_tenant?(user, "workstation", uuid),
    do: exists?(Production.get_workstation(user.company_id, uuid))

  def resource_in_tenant?(user, "routing", uuid),
    do: exists?(Production.get_routing(user.company_id, uuid))

  def resource_in_tenant?(user, "manufacturing-order", uuid),
    do: exists?(Production.get_manufacturing_order(user.company_id, uuid))

  def resource_in_tenant?(user, "manufacturing-order-step", uuid),
    do: exists?(Production.get_mo_step(user.company_id, uuid))

  # `project` topic addresses an MO chain root — the id IS an MO uuid.
  def resource_in_tenant?(user, "project", uuid),
    do: exists?(Production.get_manufacturing_order(user.company_id, uuid))

  # Pickup room addresses a specific MO by uuid.
  def resource_in_tenant?(user, "mo-pickup", uuid),
    do: exists?(Production.get_manufacturing_order(user.company_id, uuid))

  # Final-release room addresses the lot awaiting sign-off.
  def resource_in_tenant?(user, "final-release", uuid),
    do: exists?(Stock.get_for_company(user.company_id, uuid))

  # --- Shipment ---------------------------------------------------
  def resource_in_tenant?(user, "shipment", uuid),
    do: exists?(Shipments.get_shipment(user.company_id, uuid))

  # Deny anything not listed above. Explicit registration only —
  # keeps the surface auditable.
  def resource_in_tenant?(_user, _resource, _id), do: false

  # Also useful outside the channel: shared helper for path-based
  # capability checks in `PageChannel`.
  @doc """
  Extract `{entity_type, uuid}` for known entity-detail paths, or
  `:global` for paths that don't address a single tenant-scoped
  record (list pages, settings, dashboards).

  Returns `:unknown` for paths this module doesn't recognise — the
  caller can then decide whether to allow or deny.
  """
  @spec classify_path(String.t()) :: {:entity, String.t(), String.t()} | :global | :unknown
  def classify_path(path) when is_binary(path) do
    segs = path |> String.split("/", trim: true)

    case segs do
      # Detail pages — verify the uuid belongs to the tenant
      ["procurement", "vendors", uuid | _] -> {:entity, "vendor", uuid}
      ["procurement", "purchase-orders", uuid | _] -> {:entity, "purchase-order", uuid}
      ["procurement", "invoices", uuid | _] -> {:entity, "invoice", uuid}
      ["procurement", "inspections", uuid | _] -> {:entity, "goods-in-inspection", uuid}
      ["sales", "customers", uuid | _] -> {:entity, "customer", uuid}
      ["sales", "customer-orders", uuid | _] -> {:entity, "customer-order", uuid}
      ["sales", "customer-invoices", uuid | _] -> {:entity, "customer-invoice", uuid}
      ["sales", "customer-returns", uuid | _] -> {:entity, "customer-return", uuid}
      ["sales", "pricelists", uuid | _] -> {:entity, "pricelist", uuid}
      ["sales", "loyalty", "programs", uuid | _] -> {:entity, "loyalty-program", uuid}
      ["projects", uuid | _] -> {:entity, "customer-order", uuid}
      ["production", "boms", uuid | _] -> {:entity, "bom", uuid}
      ["production", "workstations", uuid | _] -> {:entity, "workstation", uuid}
      ["production", "workstation-groups", uuid | _] -> {:entity, "workstation-group", uuid}
      ["production", "routings", uuid | _] -> {:entity, "routing", uuid}
      ["production", "manufacturing-orders", uuid | _] -> {:entity, "manufacturing-order", uuid}
      ["shipments", uuid | _] -> {:entity, "shipment", uuid}
      ["stock", "lots", uuid | _] -> {:entity, "stock-lot", uuid}
      ["settings", "items", uuid | _] -> {:entity, "item", uuid}
      ["settings", "warehouses", uuid | _] -> {:entity, "warehouse", uuid}
      ["settings", "production-sites", uuid | _] -> {:entity, "production-facility", uuid}
      ["settings", "roles", uuid | _] -> {:entity, "role", uuid}

      # Global surfaces without a tenant-specific record. Membership
      # in the company is enough — no per-record check.
      _ -> :global
    end
  end

  def classify_path(_), do: :unknown

  # BOM lookup — `Production.get/2` returns the BOM keyed by
  # (company_id, uuid). Overloaded so `resource_in_tenant?/3` can
  # drive the "bom" entity type from `classify_path/1`.
  def resource_in_tenant?(user, "bom", uuid),
    do: exists?(Production.get(user.company_id, uuid))

  # Goods-in inspection lookup for path-based checks.
  def resource_in_tenant?(user, "goods-in-inspection", uuid),
    do: exists?(GoodsIn.get(user.company_id, uuid))

  # Comment thread lookup — used by `CommentChannel`.
  def resource_in_tenant?(user, "comment", uuid),
    do: exists?(Comments.get_for_company(user.company_id, uuid))

  defp exists?(nil), do: false
  defp exists?(%{}), do: true
  defp exists?(_), do: false
end
