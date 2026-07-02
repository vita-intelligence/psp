/** Permission template — what `/api/roles` returns. A saved bundle
 *  of permission codes admins can apply to a user's matrix with one
 *  click. DB table is still `roles`; the user-facing term is
 *  "template". No persistent link to any user. */
export interface PermissionTemplate {
  /** Internal DB id. Kept for React keys + analytics; never appears
   *  in URLs / API paths / channel topics — those use `uuid`. */
  id: number;
  /** Public identifier — what URLs, API paths and channel topics use. */
  uuid: string;
  /** Short auto-generated identifier (PT00001, …). nil for legacy
   *  rows that landed before the migration. */
  code: string | null;
  slug: string;
  name: string;
  description: string | null;
  is_system: boolean;
  permissions: string[];
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

/** Per-user permission matrix shape. One row = one resource; the four
 *  CRUD columns map to permission codes (or `null` when an action
 *  doesn't apply to a resource). Renders as the MRPeasy-style grid. */
export interface PermissionMatrixResource {
  key: string;
  label: string;
  description?: string | null;
  read: string | null;
  create: string | null;
  update: string | null;
  delete: string | null;
}

export interface PermissionMatrixSection {
  section: string;
  resources: PermissionMatrixResource[];
}

export type PermissionMatrix = PermissionMatrixSection[];

export interface User {
  /** Internal DB id. Kept for React keys + token decoding; never
   *  appears in URLs / API paths / channel topics — those use `uuid`. */
  id: number;
  /** Public identifier — what URLs, API paths and channel topics use. */
  uuid: string;
  /** Short auto-generated identifier (U00001, …). nil for legacy
   *  rows that landed before the migration. */
  code: string | null;
  email: string;
  name: string;
  /** Base64 data URL or null. Returned by every user-facing endpoint
   *  (/me, /users, profile-update) since the compressed payload is
   *  small enough that a flat list of ~hundreds of users is fine. */
  avatar?: string | null;
  is_active: boolean;
  /** True ⇒ every `hasPermission` check short-circuits to true. The
   *  bypass flag — now the source of Owner-level access. */
  is_admin?: boolean;
  /** Admin-set hourly wage. Stringified Decimal from the backend
   *  (e.g. `"12.50"`); null until populated. */
  hourly_wage?: string | null;
  confirmed_at?: string | null;
  company_id?: number | null;
  /** Deduped permission codes the user holds. `is_admin` bypasses
   *  these on the server but still receives the full list here so
   *  the UI can render the same way regardless. */
  permissions?: string[];
  inserted_at: string;
  updated_at?: string | null;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

export interface Company {
  id: number;
  name: string;
  legal_address: string | null;
  email: string | null;
  website: string | null;
  phone: string | null;
  registration_number: string | null;
  tax_number: string | null;
  tax_rate: string | null;
  payment_details: string | null;
  timezone: string;
  date_format: string;
  first_day_of_week: number;
  decimal_separator: string;
  thousands_separator: string;
  csv_separator: string;
  currency_code: string;
  currency_format: string;
  generic_place_name: string;
  working_hours: Record<string, unknown>;
  holidays: Record<string, unknown>;
  currency_rates: Record<string, unknown>;
  /** ECB auto-pull controls. When `auto_pull = true`, the backend
   *  cron overwrites `currency_rates` daily at 08:00 UTC from the
   *  European Central Bank reference feed. Set false to manage
   *  manually. `pulled_at` is `null` until the first successful pull
   *  for this company. `source` is `"manual"` when admins last saved
   *  via the form, `"ecb_auto"` when the cron last wrote. */
  currency_rates_auto_pull: boolean;
  currency_rates_pulled_at: string | null;
  currency_rates_source: "manual" | "ecb_auto";
  allowed_ips: Record<string, unknown>;
  numbering_formats: Record<string, unknown>;
  /** Default warehouse-pickup visibility window (hours). Per-MO
   *  override on `ManufacturingOrder.pickup_window_hours`. Once a
   *  scheduled MO is released to the warehouse, it appears in the
   *  picker queue once `planned_start - window` has passed. */
  default_pickup_window_hours: number;
  /** 3PL storage rate in the company's base currency (currency_code)
   *  applied per m³ per day against every bailee lot from
   *  `bailee_routed_at` until dispatch. Nullable — empty means no rate
   *  is configured yet + the 3PL tab shows "no rate set" instead of
   *  £0.00 lines. String because the backend sends decimals as
   *  strings to avoid JS float rounding. */
  three_pl_rate_per_m3_per_day: string | null;
}

export interface UserListEntry extends User {
  is_online: boolean;
}

/** Slim user shape embedded inside audit meta + history events.
 *  Snapshotted at event time on the backend so a later rename /
 *  deactivation can't rewrite history. `null` when the actor was
 *  deleted before the snapshot column shipped (older rows). */
export interface AuditActor {
  id: number;
  /** Present on `created_by` / `updated_by` (live preloaded actor)
   *  but omitted from history snapshots since those embed the
   *  name/email at event time. */
  uuid?: string;
  name: string;
  email: string;
  avatar: string | null;
}

/** One row from `GET /api/audit?entity_type=&entity_id=`. */
export interface AuditEvent {
  id: number;
  entity_type:
    | "warehouse"
    | "user"
    | "template"
    | "floor"
    | "storage_location"
    | "storage_cell"
    | "storage_tag"
    | "unit_of_measurement"
    | "item"
    | "product_family"
    | "attribute_definition"
    | "raw_material_compliance"
    | "raw_material_risk_assessment"
    | "finished_product_spec"
    | "packaging_compliance"
    | "certificate"
    | "item_certificate"
    | "item_image"
    | "stock_lot"
    | "stock_lot_placement"
    | "stock_movement"
    | "vendor"
    | "vendor_approved_item"
    | "vendor_certificate"
    | "customer"
    | "customer_contact"
    | "customer_file"
    | "customer_contact_event"
    | "pricelist"
    | "pricelist_item"
    | "customer_order"
    | "customer_order_line"
    | "customer_order_approval"
    | "customer_order_file"
    | "customer_approved_item"
    | "customer_invoice"
    | "customer_invoice_line"
    | "customer_invoice_payment"
    | "customer_return"
    | "customer_return_line"
    | "customer_return_file"
    | "loyalty_program"
    | "loyalty_program_tier"
    | "customer_credit"
    | "purchase_order"
    | "purchase_order_line"
    | "purchase_order_approval"
    | "bom"
    | "workstation_group"
    | "workstation"
    | "routing"
    | "manufacturing_order"
    | "manufacturing_order_step"
    | "manufacturing_order_booking";
  entity_id: number;
  entity_uuid: string | null;
  event: "created" | "updated" | "deleted";
  /** `{"field": {"old": ..., "new": ...}, ...}` — unchanged fields
   *  are excluded. */
  changes: Record<string, { old: unknown; new: unknown }>;
  /** Full audit-field snapshot at the moment after this event. The
   *  "Restore version" button uses this to repopulate the form with
   *  the values from that point in time. Empty on `deleted` events
   *  (no after-state to restore). */
  state_after: Record<string, unknown>;
  at: string;
  actor: AuditActor | null;
}

/** Slim org-roster row from `GET /api/team`. Powers the home-page
 *  "who's here" widget. Distinct from `UserListEntry` (admin list,
 *  gated on `users.view`) — `TeamMember` is what any authed user can
 *  see about their colleagues: name + email + avatar + online dot. */
export interface TeamMember {
  id: number;
  name: string;
  email: string;
  avatar: string | null;
  is_online: boolean;
}

/** Slim org-wide context payload from `GET /api/company/defaults`.
 *  Available to every authed user (no `company.view` required) since
 *  it's the baseline timezone / locale / working-hours that warehouses
 *  and other entities inherit — context, not configuration access. */
export interface CompanyDefaults {
  id: number;
  name: string;
  timezone: string;
  working_hours: Record<string, unknown>;
  holidays: Record<string, unknown>;
  date_format: string;
  first_day_of_week: number;
  decimal_separator: string;
  thousands_separator: string;
  currency_code: string;
  currency_format: string;
  generic_place_name: string;
  default_pickup_window_hours: number;
  /** 3PL rate (base-currency decimal, as string). Null when unset. */
  three_pl_rate_per_m3_per_day: string | null;
}

export interface Contact {
  type: "phone" | "email" | "url" | "other";
  label?: string;
  value: string;
}

/** Discriminator on the warehouses table — same plumbing, two
 *  visibly-distinct surfaces (warehouses + production sites). */
export type WarehouseKind = "warehouse" | "production_facility";

export interface Warehouse {
  /** Internal DB id. Never in URLs — those use `uuid`. */
  id: number;
  /** Public identifier — what URLs, API paths and channel topics use. */
  uuid: string;
  /** Short auto-generated identifier (WH00001, …). nil for legacy
   *  rows that landed before the migration. */
  code: string | null;
  /** Which surface this row belongs to. Immutable post-create. */
  kind: WarehouseKind;
  company_id: number;
  name: string;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  /** `null` ⇒ inherit from company. */
  timezone: string | null;
  /** `null` ⇒ inherit from company. */
  working_hours: Record<string, unknown> | null;
  /** `null` ⇒ inherit from company. */
  holidays: Record<string, unknown> | null;
  contacts: { items: Contact[] };
  plan: Record<string, unknown> | null;
  /** Goods-in readiness check. `ready: false` ⇒ the receive endpoint
   *  will refuse this warehouse until every `missing_purposes` blocker
   *  is closed by adding cells with the named purpose. */
  readiness: WarehouseReadiness;
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

export interface WarehouseReadiness {
  ready: boolean;
  cell_counts_by_purpose: Record<StorageCellPurpose, number>;
  missing_purposes: WarehouseReadinessBlocker[];
}

export interface WarehouseReadinessBlocker {
  purpose: StorageCellPurpose;
  label: string;
  reason: string;
}

/** Storage location kinds — the picker on the location properties
 *  panel restricts to this list. Adding a value here AND in
 *  `Backend.Warehouses.StorageLocation.@valid_kinds` ships a new
 *  category. */
/** Kept for backwards-compat shims only — the `kind` column was
 *  dropped from the backend (cosmetic-only, classification moved to
 *  `tags[]`). Don't reach for this in new code. */
export type StorageLocationKind = "other";

/** One row from the company-scoped storage tag vocabulary. The
 *  picker on the warehouse plan editor only allows tags from this
 *  list — operators stop spelling `cold-zone` three different ways.
 *  Allocation joins on `key` (lowercased, hyphen-separated). */
export interface StorageTag {
  id: number;
  uuid: string;
  /** Auto-generated admin-facing identifier (`TA00001`). Stays in
   *  sync with `companies.numbering_formats.storage_tag`. */
  code: string | null;
  /** Lowercase slug allocation joins on (`cold-zone`). Immutable
   *  once set so callers don't have to chase rename cascades. */
  key: string;
  label: string;
  description: string | null;
  /** Where the tag is applicable. `both` = either context. */
  kind: "location" | "cell" | "both";
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

/** Discriminator on the items table. Drives which compliance subtable
 *  is loaded and which AttributeDefinitions render in the form. */
export type ItemType =
  | "raw_material"
  | "semi_finished"
  | "finished_product"
  | "packaging";

export type VendorApprovalStatus =
  | "pending"
  | "approved"
  | "suspended"
  | "rejected";

export type VendorSupplyChainType =
  | "manufacturer"
  | "co_manufacturer"
  | "distributor"
  | "broker"
  | "agent"
  | "grower";

export type VendorRisk = "low" | "medium" | "high";

export type VendorQuestionnaireStatus =
  | "not_sent"
  | "sent"
  | "received"
  | "approved"
  | "overdue"
  | "na";

export type VendorTraceabilityStatus =
  | "not_done"
  | "in_progress"
  | "verified"
  | "failed"
  | "na";

export type VendorPaymentBasis = "invoice_date" | "month_end" | "delivery_date";

export interface VendorApprovedItemRow {
  uuid: string;
  vendor_id: number;
  item_id: number;
  item: {
    id: number;
    uuid: string;
    code: string | null;
    name: string;
    item_type: ItemType;
    external_sku: string | null;
  } | null;
  approved_at: string | null;
  approved_by: AuditActor | null;
  notes: string | null;
}

export interface VendorFile {
  /** DB id — used by the qualification + cert PUT as `*_file_id`. */
  id: number;
  uuid: string;
  kind: "saq" | "audit" | "coa" | "certificate" | "other";
  filename: string;
  mime: string;
  byte_size: number;
  /** Serve URL relative to the Phoenix API (or Next proxy). */
  url: string;
  uploaded_at: string;
  uploaded_by: AuditActor | null;
}

export interface VendorCertificateAttachment {
  uuid: string;
  vendor_id: number;
  certificate_id: number;
  certificate: {
    id: number;
    uuid: string;
    name: string;
    certificate_type: string;
    issuing_body: string | null;
  } | null;
  certificate_number: string | null;
  valid_from: string | null;
  valid_until: string | null;
  document_file: VendorFile | null;
  notes: string | null;
  uploaded_at: string | null;
  uploaded_by: AuditActor | null;
}

export interface Vendor {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  contact_name: string | null;
  legal_address: string | null;
  registration_number: string | null;
  tax_number: string | null;
  tax_rate: string | null;
  currency_code: string;
  default_lead_time_days: number;
  payment_terms_days: number;
  payment_basis: VendorPaymentBasis;
  supply_chain_type: VendorSupplyChainType | null;
  vendor_risk: VendorRisk | null;
  product_types: string[];
  questionnaire_status: VendorQuestionnaireStatus;
  traceability_verification_status: VendorTraceabilityStatus;
  review_frequency_months: number | null;
  last_review_at: string | null;
  next_review_at: string | null;
  approval_status: VendorApprovalStatus;
  approval_notes: string | null;
  approved_at: string | null;
  approved_by: AuditActor | null;
  approval_evidence_snapshot: VendorApprovalSnapshot | null;
  // Qualification artifacts — BRCGS / FSSC 22000 / GFSI / 21 CFR 111
  // audit checklist. `qualification` is server-computed.
  saq_received_at: string | null;
  saq_file: VendorFile | null;
  risk_assessment_completed_at: string | null;
  risk_assessment_notes: string | null;
  audit_required: boolean;
  audit_completed_at: string | null;
  audit_kind: VendorAuditKind | null;
  audit_outcome: VendorAuditOutcome | null;
  audit_file: VendorFile | null;
  audit_notes: string | null;
  coa_received_at: string | null;
  coa_file: VendorFile | null;
  qualified_at: string | null;
  qualified_by: AuditActor | null;
  qualification: VendorQualificationStatus;
  review_overdue: boolean;
  notes: string | null;
  is_active: boolean;
  approved_items: VendorApprovedItemRow[];
  certificates: VendorCertificateAttachment[];
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

export type VendorAuditKind = "desk" | "onsite" | "virtual";
export type VendorAuditOutcome = "pass" | "pass_with_findings" | "fail";

export interface VendorQualificationMissingItem {
  key: string;
  label: string;
  reason: string;
}

export interface VendorQualificationStatus {
  "complete?": boolean;
  missing: VendorQualificationMissingItem[];
}

export interface VendorApprovalSnapshot {
  approved_at: string;
  saq_received_at: string | null;
  audit_completed_at: string | null;
  audit_outcome: string | null;
  vendor_risk: string | null;
  approved_items_count: number;
  certificates: Array<{
    certificate_id: number | null;
    certificate_number: string | null;
    valid_until: string | null;
    document_url: string | null;
  }>;
}

/** Picker-shaped vendor for PO forms etc. */
export interface VendorSummary {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  email: string | null;
  currency_code: string;
  default_lead_time_days: number;
  payment_terms_days: number;
  approval_status: VendorApprovalStatus;
  is_active: boolean;
}

// ---------------------------------------------------------------
// Customers (sell-side mirror of Vendors).
// ---------------------------------------------------------------

export type CustomerApprovalStatus =
  | "draft"
  | "approved"
  | "suspended"
  | "rejected";
export type CustomerCreditCheckOutcome = "pass" | "fail" | "conditional";
export type CustomerAmlOutcome = "clean" | "flagged";

export interface CustomerQualificationMissingItem {
  key: string;
  label: string;
  reason: string;
}

export interface CustomerQualificationStatus {
  "complete?": boolean;
  missing: CustomerQualificationMissingItem[];
}

export interface CustomerApprovalSnapshot {
  snapshot_at: string;
  kyc: {
    verified_at: string | null;
    verified_by_id: number | null;
    file_id: number | null;
    notes: string | null;
  };
  credit_check: {
    at: string | null;
    by_id: number | null;
    outcome: CustomerCreditCheckOutcome | null;
    score: string | null;
    file_id: number | null;
    notes: string | null;
  };
  aml: {
    screened_at: string | null;
    screened_by_id: number | null;
    outcome: CustomerAmlOutcome | null;
    notes: string | null;
  };
  contract: {
    signed_at: string | null;
    signed_by_id: number | null;
    file_id: number | null;
    notes: string | null;
  };
  trade_credit_limit: string | null;
  currency_code: string;
}
export type CustomerPaymentBasis =
  | "invoice_date"
  | "dispatch_date"
  | "month_end";
/** Read-time projection of the customer's lifecycle. Computed server
 *  side from contact events + order rollups + `is_active`. Never a
 *  worker-editable column. */
export type CustomerStatus =
  | "lead"
  | "prospect"
  | "active"
  | "dormant"
  | "inactive";
export type CustomerContactKind =
  | "phone"
  | "mobile"
  | "email"
  | "fax"
  | "other";
export type CustomerContactEventKind =
  | "call"
  | "email"
  | "meeting"
  | "message"
  | "note"
  | "other";

export interface CustomerContact {
  uuid: string;
  customer_id: number;
  kind: CustomerContactKind;
  value: string;
  label: string | null;
  is_primary: boolean;
  inserted_at: string;
  updated_at: string;
}

export interface CustomerContactEvent {
  uuid: string;
  customer_id: number;
  kind: CustomerContactEventKind;
  occurred_at: string;
  summary: string | null;
  logged_by: AuditActor | null;
  inserted_at: string;
}

export interface CustomerFile {
  id: number;
  uuid: string;
  kind: "contract" | "nda" | "credit_check" | "photo" | "logo" | "other";
  filename: string;
  mime: string;
  byte_size: number;
  url: string;
  uploaded_at: string;
  uploaded_by: AuditActor | null;
}

export interface Customer {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  legal_name: string | null;
  contact_name: string | null;
  website: string | null;
  legal_address: string | null;
  country_code: string | null;
  registration_number: string | null;
  tax_number: string | null;
  currency_code: string;
  tax_rate: string | null;
  default_discount_percent: string | null;
  language_code: string | null;
  payment_terms_days: number;
  payment_terms_basis: CustomerPaymentBasis;
  trade_credit_limit: string | null;
  pricelist_id: number | null;
  /** Loyalty program the customer is individually enrolled in. `null`
   *  means "use the default program", which is whichever active
   *  program has `is_default = true`. */
  loyalty_program_id: number | null;
  contact_frequency_months: number | null;
  contact_started_at: string | null;
  last_contact_at: string | null;
  next_contact_at: string | null;
  first_order_at: string | null;
  last_order_at: string | null;
  total_orders_count: number;
  approval_status: CustomerApprovalStatus;
  approval_notes: string | null;
  approved_at: string | null;
  approved_by: AuditActor | null;
  approval_evidence_snapshot: CustomerApprovalSnapshot | null;
  /** Stored approval folded with re-qualification cadence + is_active.
   *  Always read this for badges + gates; the stored `approval_status`
   *  is just the last human decision and can drift from reality when
   *  the customer is overdue for re-qualification. */
  effective_approval_status: CustomerApprovalStatus;
  /** Why effective differs from stored. `"none"` when they match. */
  effective_approval_reason:
    | "none"
    | "re_qualification_overdue"
    | "inactive";
  is_active: boolean;
  account_manager: AuditActor | null;
  status: CustomerStatus;
  // Onboarding qualification (KYC / Credit / AML / Contract)
  kyc_verified_at: string | null;
  kyc_verified_by: AuditActor | null;
  kyc_file: CustomerFile | null;
  kyc_notes: string | null;
  credit_check_at: string | null;
  credit_check_by: AuditActor | null;
  credit_check_outcome: CustomerCreditCheckOutcome | null;
  credit_check_score: string | null;
  credit_check_file: CustomerFile | null;
  credit_check_notes: string | null;
  aml_screened_at: string | null;
  aml_screened_by: AuditActor | null;
  aml_outcome: CustomerAmlOutcome | null;
  aml_notes: string | null;
  contract_signed_at: string | null;
  contract_signed_by: AuditActor | null;
  contract_file: CustomerFile | null;
  contract_notes: string | null;
  qualified_at: string | null;
  qualified_by: AuditActor | null;
  qualification: CustomerQualificationStatus;
  review_frequency_months: number | null;
  last_review_at: string | null;
  next_review_at: string | null;
  review_overdue: boolean;
  contacts: CustomerContact[];
  files: CustomerFile[];
  contact_events: CustomerContactEvent[];
  approved_items: CustomerApprovedItemRow[];
  inserted_at: string;
  updated_at: string;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
}

// ---------------------------------------------------------------
// Pricelists (sell-side selling-price quotes).
// ---------------------------------------------------------------

interface ItemSummaryRef {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  item_type: string;
  external_sku: string | null;
  stock_uom: {
    id: number;
    uuid: string;
    code: string | null;
    name: string;
    symbol: string;
  } | null;
}

export interface PricelistItemRow {
  uuid: string;
  pricelist_id: number;
  item_id: number;
  item: ItemSummaryRef | null;
  selling_price: string;
  min_quantity: string;
  notes: string | null;
  inserted_at: string;
  updated_at: string;
}

export interface Pricelist {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  currency_code: string;
  is_default: boolean;
  is_active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  notes: string | null;
  items: PricelistItemRow[];
  inserted_at: string;
  updated_at: string;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
}

export interface PricelistSummary {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  currency_code: string;
  is_default: boolean;
  is_active: boolean;
}

/** Picker-shaped customer for CO / invoice forms etc. */
export interface CustomerSummary {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  currency_code: string;
  payment_terms_days: number;
  payment_terms_basis: CustomerPaymentBasis;
  approval_status: CustomerApprovalStatus;
  effective_approval_status: CustomerApprovalStatus;
  is_active: boolean;
  status: CustomerStatus;
}

export type PurchaseOrderStatus =
  | "draft"
  | "pending_approver"
  | "pending_director"
  | "approved"
  | "ordered"
  | "partially_received"
  | "received"
  | "cancelled";

export type PurchaseOrderApprovalKind = "approver" | "director";

export interface PurchaseOrderLineItemSummary {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  item_type: ItemType;
  external_sku: string | null;
  /** Two-state regulatory gate — surfaced on the mobile pre-receive
   *  checklist so the operator can flag items that aren't finalised. */
  compliance_status: ItemComplianceStatus;
  /** Storage requirement tags (e.g. `requires_coa`, `allergen_milk`) —
   *  the mobile pre-receive checklist renders compliance chips off
   *  this list. */
  storage_tags: string[];
  /** Custom attribute bag from the item record. Defensive lookups for
   *  flags like `requires_cold_chain` happen on the FE. */
  attributes: Record<string, unknown>;
  /** Default stock unit of measurement. Pre-receive checklist renders
   *  the symbol next to the expected qty. */
  stock_uom: {
    id: number;
    uuid: string;
    code: string | null;
    symbol: string;
    name: string;
  } | null;
}

export interface PurchaseOrderLine {
  uuid: string;
  purchase_order_id: number;
  item_id: number;
  item: PurchaseOrderLineItemSummary | null;
  qty_ordered: string;
  qty_received: string;
  unit_price: string;
  line_subtotal: string;
  expected_delivery_date: string | null;
  notes: string | null;
  /** Per-line warehouse override of the PO's `default_warehouse_id`.
   *  Null means "use the PO default". */
  warehouse_id: number | null;
  warehouse: {
    id: number;
    uuid: string;
    name: string;
  } | null;
  /** Supplier's part code for this item — auto-filled from
   *  `vendor_approved_items.vendor_part_no` when that registry has an
   *  entry, otherwise free text. */
  vendor_part_no: string | null;
  inserted_at: string;
  updated_at: string;
}

/** Files attached to a PO — supplier quote, spec sheet, etc. Mirrors
 *  the `vendor_files` / `lot_files` shape so QA + procurement can
 *  produce the originating paperwork during an audit. */
export interface PurchaseOrderFile {
  id: number;
  uuid: string;
  kind: "quote" | "spec" | "other";
  filename: string;
  mime: string;
  byte_size: number;
  url: string;
  uploaded_at: string;
  uploaded_by: AuditActor | null;
}

export interface PurchaseOrderApproval {
  uuid: string;
  purchase_order_id: number;
  kind: PurchaseOrderApprovalKind;
  signed_at: string;
  signed_by: AuditActor | null;
  notes: string | null;
  has_signature_image: boolean;
}

export interface PurchaseOrder {
  id: number;
  uuid: string;
  code: string | null;
  status: PurchaseOrderStatus;
  vendor_id: number;
  vendor: VendorSummary | null;
  currency_code: string;
  subtotal: string;
  /** Whole-PO discount as a percentage (0–100). User-editable. */
  discount_pct: string;
  /** Server-computed: `subtotal * discount_pct / 100`. Read-only. */
  discount_amount: string;
  /** Tax percentage applied to (subtotal − discount). Defaults to
   *  `vendor.tax_rate` on create; user can override. */
  tax_rate: string;
  /** Server-computed: `(subtotal − discount_amount) * tax_rate / 100`. */
  tax_amount: string;
  /** Flat shipping / freight charge (optional). */
  shipping_fees: string;
  /** Other flat fees (handling, customs broker, etc.). */
  additional_fees: string;
  /** Server-computed: `subtotal − discount_amount + tax_amount +
   *  shipping_fees + additional_fees`. The PO's bottom line. */
  grand_total: string;
  /** Legacy field — duplicates `grand_total`. Kept for backward compat
   *  with existing payload consumers until they migrate. */
  total_amount: string;
  /** Header-level default delivery warehouse — lines without their own
   *  `warehouse_id` inherit this site on receive. */
  default_warehouse_id: number | null;
  default_warehouse: {
    id: number;
    uuid: string;
    name: string;
  } | null;
  expected_delivery_date: string | null;
  delivery_address: string | null;
  notes: string | null;
  /** Supplier paperwork (quote PDF, spec sheet, etc.). Uploaded to
   *  Backend.Storage; URL streams through the BE so we keep ACL. */
  files: PurchaseOrderFile[];
  submitted_at: string | null;
  submitted_by: AuditActor | null;
  ordered_at: string | null;
  ordered_by: AuditActor | null;
  received_at: string | null;
  /** Stamped on the FIRST receive event (PO transitions to
   *  `received` / `partially_received`). With the inspection-driven
   *  auto-receive, this is the goods-in operator who signed off the
   *  checklist on the phone. */
  received_by: AuditActor | null;
  cancelled_at: string | null;
  cancelled_by: AuditActor | null;
  cancellation_reason: string | null;
  lines: PurchaseOrderLine[];
  approvals: PurchaseOrderApproval[];
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

/** Response from
 *  `GET /api/purchase-orders/:po_uuid/lines/suggest-price?item_id=N`.
 *  Pre-fills `unit_price` in the add-line dialog from the cached last
 *  paid price for this (vendor, item, currency). `last_paid` is null
 *  when there's no history — the FE shows the input unprefilled. */
export interface PurchaseOrderSuggestPrice {
  last_paid: {
    unit_price: string;
    currency_code: string;
    last_paid_at: string;
    last_po_line_id: number | null;
    qty_purchased: string;
  } | null;
}

/** One row of a vendor's cached price history — surfaced on the
 *  vendor detail page so reviewers can see what we've been paying
 *  and trace each price point back to the PO that set it. */
export interface VendorItemPrice {
  uuid: string;
  item_id: number;
  item: {
    id: number;
    uuid: string;
    code: string | null;
    name: string;
    item_type: ItemType;
    external_sku: string | null;
  } | null;
  currency_code: string;
  unit_price: string;
  qty_purchased: string;
  last_paid_at: string;
  last_po_line_id: number | null;
  last_po_uuid: string | null;
  updated_at: string;
}

/** Row from `GET /api/stock/inventory` — one entry per item with
 *  on-hand qty and cost value summed across all non-zero placements
 *  of all lots. Drives the /stock/inventory list page. */
export interface InventoryRow {
  item_id: number;
  item_uuid: string;
  item_name: string;
  item_code: string | null;
  item_external_sku: string | null;
  item_type: ItemType;
  stock_uom_id: number | null;
  /** Decimal string — sum of placement.qty across non-zero placements. */
  qty_on_hand: string;
  /** Decimal string — sum of placement.qty × lot.unit_cost in the
   *  company's default currency. Mixed-currency mix is summed naively. */
  total_cost: string;
  lots_count: number;
  /** ISO date — null when no lot has an expiry set. */
  earliest_expiry: string | null;
  /** ISO datetime — null when nothing has been received yet. */
  latest_received_at: string | null;
}

export interface ItemUnitCompact {
  id: number;
  uuid: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
}

export interface ProductFamilyCompact {
  id: number;
  uuid: string;
  name: string;
}

/** Raw material `use_as` — functional classification within a
 *  formulation. Drives BOM line role + how the item shows in the
 *  picker. */
export type RawMaterialUseAs =
  | "active"
  | "sweetener"
  | "bulking_agent"
  | "flavouring"
  | "colour"
  | "acidity_regulator"
  | "glazing_agent"
  | "gelling_agent"
  | "emulsifier"
  | "disintegrant"
  | "stabiliser"
  | "anti_caking"
  | "coating"
  | "preservative"
  | "carrier"
  | "excipient"
  | "other";

export type AllergenStatus = "free" | "contains_traces" | "contains";
export type VeganStatus =
  | "vegan"
  | "vegetarian"
  | "non_vegetarian"
  | "unknown";
export type HalalStatus = "certified" | "not_certified" | "not_applicable";
export type KosherStatus = "certified" | "not_certified" | "not_applicable";
export type OrganicStatus =
  | "certified"
  | "in_conversion"
  | "non_organic"
  | "not_applicable";
export type NovelFoodStatus =
  | "not_novel"
  | "authorised"
  | "pending"
  | "not_authorised";
export type GmoStatus = "gmo_free" | "contains_gmo" | "unknown";
export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Per-item raw-material compliance row. Only meaningfully populated
 *  when `item_type = "raw_material"`. */
export interface RawMaterialCompliance {
  use_as: RawMaterialUseAs | null;
  allergen_status: AllergenStatus | null;
  vegan_status: VeganStatus | null;
  halal_status: HalalStatus | null;
  kosher_status: KosherStatus | null;
  organic_status: OrganicStatus | null;
  novel_food_status: NovelFoodStatus | null;
  gmo_status: GmoStatus | null;
  country_of_origin: string | null;
  purity_pct: string | null;
  extract_ratio: string | null;
  overage_pct: string | null;
  powder_water_dose_mg_per_ml: string | null;
  shelf_life_months: number | null;
  storage_conditions: string | null;
  spec_document_file_id: number | null;
  spec_document_file: ItemFile | null;
  last_reviewed_at: string | null;
  last_reviewed_by: AuditActor | null;
  review_frequency_months: number | null;
  review_due_at: string | null;
  inserted_at: string;
  updated_at: string;
}

export type RegulatoryCategory =
  | "food_supplement"
  | "functional_food"
  | "cosmetic"
  | "medical_device";

export type DosageForm =
  | "capsule"
  | "tablet"
  | "softgel"
  | "powder"
  | "liquid"
  | "gummy";

export type CapsuleSize = "000" | "00" | "0" | "1" | "2" | "3" | "4";
export type PowderType = "standard" | "protein";

/** One per-active claim — refers to a `claim_register` row + carries
 *  the per-product mg amount + NRV%. */
export interface ActiveClaim {
  claim_register_uuid?: string;
  active_substance?: string;
  mg_per_serving?: string;
  nrv_pct?: string;
}

/** Structured nutrition table — per-100g + per-serving + NRV%.
 *  Shape is regulator-driven; the FE form follows the EU 1169/2011
 *  declaration order. */
export interface NutritionTable {
  energy_kj?: string;
  energy_kcal?: string;
  fat?: string;
  saturates?: string;
  carbohydrate?: string;
  sugars?: string;
  fibre?: string;
  protein?: string;
  salt?: string;
  /** Per-vitamin / per-mineral / per-active rows beyond the standard
   *  declaration. Each row carries amount + NRV%. */
  custom?: Array<{
    nutrient: string;
    amount_per_serving?: string;
    amount_per_100g?: string;
    nrv_pct?: string;
  }>;
}

/** Shape of the contaminant-limit overrides JSONB. Matches the
 *  org-default shape so reads can merge with `companies.default_spec_limits`. */
export interface ContaminantLimits {
  total_aerobic?: string;
  total_yeast?: string;
  e_coli?: string;
  salmonella?: string;
  pah?: string;
  heavy_metal?: string;
  pesticides?: string;
  others?: Record<string, string>;
}

/** Per-item finished-product specification. Only meaningfully populated
 *  when `item_type = "finished_product"`. */
export interface FinishedProductSpec {
  regulatory_category: RegulatoryCategory | null;
  dosage_form: DosageForm | null;
  capsule_size: CapsuleSize | null;
  tablet_size_mm: string | null;
  powder_type: PowderType | null;
  serving_size: string | null;
  serving_size_uom: ItemUnitCompact | null;
  serving_size_uom_id: number | null;
  servings_per_pack: number | null;
  net_quantity: string | null;
  net_quantity_uom: ItemUnitCompact | null;
  net_quantity_uom_id: number | null;
  directions_of_use: string | null;
  suggested_dosage: string | null;
  warnings_text: string | null;
  appearance: string | null;
  disintegration_spec: string | null;
  weight_uniformity_pct: string | null;
  shelf_life_months: number | null;
  storage_conditions: string | null;
  food_contact_status: string | null;
  active_claims: ActiveClaim[];
  /** Array of claim_register UUIDs. */
  general_claims: string[];
  nutrition_table: NutritionTable;
  target_markets: string[];
  spec_document_file_id: number | null;
  spec_document_file: ItemFile | null;
  /** Array of allergen UUIDs flagged for "may contain" warning. */
  may_contain_allergens: string[];
  may_contain_justification: string | null;
  may_contain_assessed_at: string | null;
  may_contain_assessed_by: AuditActor | null;
  contaminant_limits_overrides: ContaminantLimits;
  inserted_at: string;
  updated_at: string;
}

/** One image attached to an item. `url` is rendered server-side by the
 *  storage adapter — for the local adapter it's an authed Phoenix
 *  route; in production it'll be a short-lived signed URL. */
export interface ItemImage {
  uuid: string;
  item_id: number;
  url: string | null;
  caption: string | null;
  is_primary: boolean;
  sort_order: number;
  original_filename: string | null;
  content_type: string | null;
  byte_size: number | null;
  uploaded_at: string;
  uploaded_by: AuditActor | null;
}

export type CertificateType =
  | "organic"
  | "halal"
  | "kosher"
  | "iso_22000"
  | "brc"
  | "fssc_22000"
  | "gmp"
  | "ifs"
  | "haccp"
  | "usda_organic"
  | "non_gmo_project"
  | "other";

/** Company-scoped certificate definition. */
export interface Certificate {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  certificate_type: CertificateType;
  issuing_body: string | null;
  default_validity_months: number | null;
  description: string | null;
  is_active: boolean;
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

export interface CertificateCompact {
  id: number;
  uuid: string;
  name: string;
  certificate_type: CertificateType;
  issuing_body: string | null;
}

/** Per-item certificate attachment. */
export interface ItemCertificate {
  uuid: string;
  item_id: number;
  certificate_id: number;
  certificate: CertificateCompact | null;
  certificate_number: string | null;
  valid_from: string | null;
  valid_until: string | null;
  document_url: string | null;
  notes: string | null;
  uploaded_at: string;
  uploaded_by: AuditActor | null;
}

/** "Reviews due" queue row — raw-material compliance reviews coming up
 *  in the next N days (or already overdue). */
export interface ReviewDueQueueRow {
  item: {
    id: number;
    uuid: string;
    name: string;
    item_type: ItemType;
    external_sku: string | null;
  };
  review_due_at: string;
  last_reviewed_at: string | null;
  days_until_due: number;
  is_overdue: boolean;
}

/** "Certificates expiring" queue row — item certificate attachments
 *  with valid_until within the next N days. */
export interface CertExpiringQueueRow {
  item: {
    id: number;
    uuid: string;
    name: string;
    item_type: ItemType;
  };
  certificate: {
    uuid: string | null;
    name: string | null;
    certificate_type: CertificateType | null;
  };
  certificate_number: string | null;
  valid_until: string;
  days_until_expiry: number;
  is_expired: boolean;
  document_url: string | null;
}

export type PackagingMaterial =
  | "glass"
  | "hdpe"
  | "pet"
  | "pp"
  | "cardboard"
  | "aluminum"
  | "multi_layer"
  | "other";

/** Per-item packaging compliance. Populated when `item_type = "packaging"`. */
export interface PackagingCompliance {
  material: PackagingMaterial | null;
  food_contact_compliant: boolean | null;
  food_contact_declaration_file_id: number | null;
  food_contact_declaration_file: ItemFile | null;
  recyclability_code: string | null;
  migration_test_file_id: number | null;
  migration_test_file: ItemFile | null;
  migration_test_expires_at: string | null;
  inserted_at: string;
  updated_at: string;
}

/** Per-item evidence file (spec sheet, food-contact DoC, …). Same
 *  shape as `VendorFile`. */
export interface ItemFile {
  id: number;
  uuid: string;
  kind: ItemFileKind;
  filename: string;
  mime: string;
  byte_size: number;
  url: string;
  uploaded_at: string;
  uploaded_by: AuditActor | null;
}

export type ItemFileKind =
  | "spec_sheet"
  | "food_contact_declaration"
  | "migration_test"
  | "safety_data_sheet"
  | "allergen_declaration"
  | "nutritional_analysis"
  | "other";

/** Per-item raw-material risk scorecard. Computed level comes from
 *  the 7 scores; override is opt-in and requires justification. */
export interface RawMaterialRisk {
  physical_risk_score: number | null;
  chemical_risk_score: number | null;
  biological_risk_score: number | null;
  allergen_risk_score: number | null;
  radiological_risk_score: number | null;
  fraud_vulnerability_score: number | null;
  malicious_risk_score: number | null;
  computed_overall_level: RiskLevel | null;
  overridden_overall_level: RiskLevel | null;
  override_justification: string | null;
  justification: string | null;
  required_controls: string | null;
  assessed_at: string | null;
  assessed_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

/** Core item row. Per-type compliance data (raw material, finished
 *  product, packaging) lives in 1:1 subtables and arrives on this
 *  payload as separate keys when preloaded by the show endpoint. */
export interface Item {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  description: string | null;
  item_type: ItemType;
  external_sku: string | null;
  barcode: string | null;
  stock_uom: ItemUnitCompact | null;
  stock_uom_id: number | null;
  product_family: ProductFamilyCompact | null;
  product_family_id: number | null;
  attributes: Record<string, unknown>;
  /** Storage requirement tags — the receive form filters destination
   *  cells to ones whose effective tags (location ∪ cell) are a
   *  superset of this list. */
  storage_tags: string[];
  is_active: boolean;
  /** Two-state regulatory gate. PO lines + BOMs refuse `draft` items.
   *  Promote via `markItemReadyAction`; revert needs a justification. */
  compliance_status: ItemComplianceStatus;
  compliance_readied_at: string | null;
  compliance_readied_by: AuditActor | null;
  compliance_revert_reason: string | null;
  /** Live blocker list. Present only on show endpoints (where the
   *  subtables are preloaded). `[]` ⇒ ready, list ⇒ field-keyed
   *  reasons the FE can route to specific form fields. `null` ⇒ list
   *  endpoint, blockers not computed. */
  compliance_blockers: ItemComplianceBlocker[] | null;
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
  /** Present only on show endpoints (list endpoints skip the join). */
  raw_material_compliance?: RawMaterialCompliance | null;
  raw_material_risk?: RawMaterialRisk | null;
  finished_product_spec?: FinishedProductSpec | null;
  packaging_compliance?: PackagingCompliance | null;
  certificate_attachments?: ItemCertificate[];
  images?: ItemImage[];
  allergens?: Allergen[];
}

export type ItemComplianceStatus = "draft" | "ready_for_use";

/** One blocker the regulatory validator emitted. `field` is the dotted
 *  path matching the FE form's field-error map keys so we can scroll
 *  to the field; `reason` is the auditor-facing explanation we show. */
export interface ItemComplianceBlocker {
  field: string;
  reason: string;
}

export interface ProductFamily {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

export type AttributeScope =
  | "raw_material"
  | "semi_finished"
  | "finished_product"
  | "packaging"
  | "item_any";

export type AttributeType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "enum"
  | "url";

export interface AttributeEnumChoice {
  value: string;
  label: string;
}

/** Admin-defined custom attribute. Values live in `items.attributes`,
 *  validated server-side against the definition's `attribute_type`
 *  and `enum_choices`. */
export interface AttributeDefinition {
  id: number;
  uuid: string;
  code: string | null;
  scope: AttributeScope;
  key: string;
  label: string;
  attribute_type: AttributeType;
  enum_choices: AttributeEnumChoice[];
  required: boolean;
  default_value: unknown;
  unit_symbol: string | null;
  help_text: string | null;
  sort_order: number;
  is_active: boolean;
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

/** Global EU 1169/2011 Annex II declared allergens. Read-only. */
export interface Allergen {
  uuid: string;
  key: string;
  label: string;
  source: string;
  sort_order: number;
}

export type ClaimStatus = "authorised" | "rejected" | "pending" | "withdrawn";

/** One row from the regulator claim register (EU 1924/2006 etc.).
 *  Read-only — seeded by data migration. */
export interface RegisteredClaim {
  uuid: string;
  claim_code: string;
  claim_text: string;
  category: string;
  nutrient_substance: string | null;
  conditions_of_use: string | null;
  jurisdictions: string[];
  source: string;
  status: ClaimStatus;
}

/** One row of the company-scoped unit-of-measurement registry. Within
 *  a dimension exactly one unit is `is_base=true` (factor 1); every
 *  other unit converts to it via a single multiply by `factor_to_base`.
 *  Serialised as a string by the backend so JS doesn't lose precision
 *  on tiny ratios (e.g. mg → kg = 0.000001). */
export type UnitDimension =
  | "mass"
  | "volume"
  | "count"
  | "length"
  | "area"
  | "time";

export interface UnitOfMeasurement {
  id: number;
  uuid: string;
  /** Auto-generated display code (`UM00001`). Derived from id +
   *  numbering format, like every other entity. */
  code: string | null;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  /** Decimal string. One unit = factor × base_unit_of_dimension. */
  factor_to_base: string;
  is_base: boolean;
  is_active: boolean;
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

/** Decision-driven cell intent. The auto-router moves stock between
 *  cells whose purpose matches the lot's new status — a quarantine
 *  lot ends up in a `quarantine` cell, a rejected lot in a `rejected`
 *  cell, etc. Default `regular` = normal pick face. */
export type StorageCellPurpose =
  | "regular"
  | "quarantine"
  | "hold"
  | "rejected"
  | "dispatch"
  | "finished_quarantine"
  | "three_pl_storage";

/** One physical level / subdivision of a storage location. A shelf
 *  with five usable levels has five cells, ordered bottom-to-top
 *  via `ordinal`. Tags are freeform classification labels for the
 *  segregation rules engine to consume later (cold, hazmat-3,
 *  allergen-nuts, …). */
export interface StorageCell {
  id: number;
  uuid: string;
  storage_location_id: number;
  ordinal: number;
  name: string | null;
  /** Physical dimensions in metres. May differ from the parent
   *  location's overall footprint (e.g. a half-depth top shelf). */
  width_m: string | null;
  depth_m: string | null;
  height_m: string | null;
  /** Optional weight cap — null = "no enforced limit". */
  max_weight_kg: string | null;
  tags: string[];
  /** Drives auto-routing on lifecycle events (status → purpose match). */
  purpose: StorageCellPurpose;
  notes: string | null;
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

/** One storage location inside a warehouse. First-class entity
 *  (matches the `storage_locations` table) — has its own audit trail
 *  and will be referenced by stock + transfer records once the
 *  inventory module ships. */
export interface StorageLocation {
  id: number;
  uuid: string;
  warehouse_id: number;
  floor_id: number;
  name: string;
  code: string | null;
  /** Canvas position (units). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Physical dimensions in metres (decoupled from canvas units). */
  width_m: string | null;
  height_m: string | null;
  depth_m: string | null;
  notes: string | null;
  /** Optional `#RRGGBB` fill colour override. nil = neutral default. */
  color: string | null;
  /** Free-form classification labels (`pallet`, `cold-zone`, etc.).
   *  Allocation reads the union of `location.tags` and each cell's
   *  own tags, so marking the whole zone once is enough. */
  tags: string[];
  /** Cells of this location, bottom-to-top. Empty list when the
   *  operator hasn't subdivided yet — treat as a single bulk
   *  storage zone. */
  cells: StorageCell[];
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

/** One floor of a warehouse. Walls + rooms live in canvas_json;
 *  storage locations are their own entities and come preloaded on
 *  the list endpoint. */
export interface Floor {
  id: number;
  uuid: string;
  warehouse_id: number;
  name: string;
  ordinal: number;
  /** Architectural shapes (walls, rooms) + viewport state. Schema is
   *  intentionally open so we can evolve the editor without
   *  migrations. */
  canvas_json: Record<string, unknown>;
  storage_locations?: StorageLocation[];
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

// ---------- Stock ---------------------------------------------------

export type StockLotStatus =
  | "requested"
  | "received"
  | "quarantine"
  | "depleted"
  | "disposed"
  | "rejected";

export type StockSourceKind =
  | "purchase_order"
  | "manufacturing_order"
  | "opening_balance"
  | "return"
  | "adjustment";

export type StockMovementKind =
  | "receive"
  | "move"
  | "consume"
  | "adjust_up"
  | "adjust_down"
  | "dispose"
  | "return";

export type ComplianceState =
  | "pending"
  | "requested"
  | "received"
  | "accepted"
  | "rejected"
  | "na";

export interface StockLotItemSummary {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  item_type: string;
  external_sku: string | null;
  /** Item-level regulatory gate. The lot detail page surfaces this so
   *  the operator sees the spec is finalised before they consume
   *  against the lot. */
  compliance_status?: ItemComplianceStatus;
  /** Storage / handling tags (`requires_coa`, `allergen_milk`,
   *  `requires_cold_chain`, etc.). Mirrors `Item.storage_tags`. */
  storage_tags?: string[];
}

export interface StockLotUomSummary {
  id: number;
  uuid: string;
  code: string | null;
  symbol: string;
  name: string;
}

export interface StockLotCellSummary {
  id: number;
  uuid: string;
  ordinal: number;
  name: string | null;
  /** Cell intent — drives auto-routing. Surfaces as a chip next to
   *  the placement so QC can spot a quarantine lot in a regular
   *  cell at a glance. */
  purpose: StorageCellPurpose;
  /** Display code rendered from the company numbering format
   *  (e.g. `CELL00011`). `null` for system-managed cells where the
   *  FE renders the operator-facing `generic_place_name` instead. */
  code: string | null;
  system_kind: string | null;
  storage_location_id: number;
  storage_location: {
    id: number;
    uuid: string;
    name: string;
    code: string | null;
    system_kind: string | null;
  } | null;
  floor: {
    id: number;
    uuid: string;
    name: string;
    system_kind: string | null;
  } | null;
  warehouse: { id: number; uuid: string; name: string } | null;
}

/** Tag-aware cell picker row — extends the basic cell with location
 *  and effective tag sets so the receive form can do client-side
 *  filtering against item.storage_tags. */

export interface StockLotPlacement {
  id: number;
  uuid: string;
  stock_lot_id: number;
  storage_cell_id: number;
  qty: string;
  storage_cell?: StockLotCellSummary | null;
  inserted_at: string;
  updated_at: string;
}

export interface StockMovement {
  id: number;
  uuid: string;
  stock_lot_id: number;
  from_cell_id: number | null;
  to_cell_id: number | null;
  from_cell: StockLotCellSummary | null;
  to_cell: StockLotCellSummary | null;
  delta_qty: string;
  kind: StockMovementKind;
  reason: string | null;
  reference_kind: string | null;
  reference_ref: string | null;
  occurred_at: string;
  actor: AuditActor | null;
  photo_url: string | null;
  skip_photo_reason: string | null;
  inserted_at: string;
}

/** Cell scan response shape — the move flow's destination breadcrumb. */
export interface ScannedCell {
  id: number;
  uuid: string;
  name: string;
  /** Auto-numbered identifier (e.g. `CELL00040`). Same string the
   *  printed QR label carries, so the operator can match the on-
   *  screen breadcrumb against the physical tag. `null` for system
   *  cells. */
  code?: string | null;
  ordinal: number;
  tags: string[];
  system_kind?: string | null;
  storage_location: {
    id: number;
    uuid: string;
    name: string;
    code: string | null;
    system_kind?: string | null;
  } | null;
  floor: {
    id: number;
    uuid: string;
    name: string;
    system_kind?: string | null;
  } | null;
  warehouse: { id: number; uuid: string; name: string } | null;
}

/** A stock lot — one received (or produced) batch. `qty_received` is
 *  immutable; `qty_on_hand` is summed from placements at payload
 *  time, and `qty_available` will subtract reservations once those
 *  ship. */
export interface StockLot {
  id: number;
  uuid: string;
  code: string | null;
  status: StockLotStatus;
  qty_received: string;
  qty_on_hand: string;
  qty_available: string;
  unit_cost: string | null;
  currency: string | null;
  source_kind: StockSourceKind | null;
  source_ref: string | null;
  supplier_batch_no: string | null;
  country_of_origin: string | null;
  revision: string | null;
  overall_risk: "low" | "medium" | "high" | null;
  allergen_status: ComplianceState | null;
  coa_status: ComplianceState | null;
  quality_status: ComplianceState | null;
  manufactured_at: string | null;
  expiry_at: string | null;
  available_from: string | null;
  received_at: string | null;
  notes: string | null;
  item_id: number;
  item: StockLotItemSummary | null;
  unit_of_measurement_id: number;
  unit_of_measurement: StockLotUomSummary | null;
  placements: StockLotPlacement[];
  package_length_mm: number | null;
  package_width_mm: number | null;
  package_height_mm: number | null;
  package_weight_kg: string | null;
  units_per_package: number | null;
  stack_factor: number | null;
  /** Goods-In Inspection that produced this lot (PO receives only).
   *  Null for manual lots, opening balance, and MO output. */
  goods_in_inspection?: GoodsInInspectionFull | null;
  /** Direct lot attachments — CoA, QC reports, photos uploaded any
   *  time during the lot's life. Separate from inspection files. */
  files?: StockLotFile[];
  /** Every MO that's booked this lot, with picker → confirm →
   *  consume sign-off chain. */
  mo_bookings?: StockLotMoBooking[];
  /** Return picks (production_feed → warehouse) for output lots. */
  return_picks?: StockLotReturnPick[];
  /** Decorated by the pending-putaway endpoint. True when this
   *  finished-goods lot owes a Final Product Release ceremony and
   *  isn't yet in a `finished_quarantine` cell. Drives the "→
   *  Finished quarantine" hint chip on the mobile queue. */
  needs_release_quarantine_move?: boolean;
  /** 3PL / bailee custody snapshot. Set by the customer-order wizard's
   *  routing step after Positive Release. `own` = default; `bailee` =
   *  customer-owned, held by us, billed per m³ per day. */
  ownership_kind: "own" | "bailee";
  bailee_routed_at: string | null;
  bailee_customer: { id: number; uuid: string; name: string } | null;
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

export interface StockLotFile {
  id: number;
  uuid: string;
  kind: "qc_report" | "disposal_certificate" | "hold_notice" | "photo" | "other";
  filename: string;
  mime: string;
  byte_size: number;
  url: string | null;
  uploaded_by: AuditActor | null;
  inserted_at: string;
}

export interface StockLotMoBooking {
  id: number;
  uuid: string;
  quantity: string;
  consumed_quantity: string;
  status: string;
  mo: {
    id: number;
    uuid: string;
    code: string | null;
    status: string;
  } | null;
  picked_at: string | null;
  picked_by: AuditActor | null;
  received_at: string | null;
  received_by: AuditActor | null;
  received_qty: string | null;
  received_notes: string | null;
  consumed_at: string | null;
  consumed_by: AuditActor | null;
}

export interface StockLotReturnPick {
  id: number;
  uuid: string;
  qty: string;
  picked_at: string | null;
  picked_by: AuditActor | null;
  picked_photo_url: string | null;
  placed_at: string | null;
  placed_by: AuditActor | null;
  placed_photo_url: string | null;
  picked_from_cell: StockLotCellSummary | null;
  placed_to_cell: StockLotCellSummary | null;
}

/** Slim GoodsIn inspection shape rendered on the lot detail page —
 *  matches `Payloads.goods_in_inspection/1`. Section bags are kept as
 *  loose maps (the FE just shows the boolean check pattern). */
export interface GoodsInInspectionFull {
  id: number;
  uuid: string;
  code: string | null;
  status: string;
  delivery_date: string | null;
  delivery_time: string | null;
  transport_company: string | null;
  vehicle_registration: string | null;
  seal_number: string | null;
  vehicle_inspection: Record<string, unknown>;
  documentation_verification: Record<string, unknown>;
  physical_inspection: Record<string, unknown>;
  food_safety_checks: Record<string, unknown>;
  storage_verification: Record<string, unknown>;
  quality_decision: string | null;
  quality_decision_reason: string | null;
  goods_in_operator: AuditActor | null;
  goods_in_operator_signed_at: string | null;
  goods_in_operator_signature_image: string | null;
  quality_approver: AuditActor | null;
  quality_approver_signed_at: string | null;
  quality_approver_signature_image: string | null;
  purchase_order_id: number | null;
  purchase_order_uuid: string | null;
  items?: Array<Record<string, unknown>>;
  files?: Array<{
    id: number;
    uuid: string;
    kind: string;
    filename: string;
    mime: string;
    byte_size: number;
    url: string | null;
    uploaded_at: string;
    uploaded_by: AuditActor | null;
  }>;
  inserted_at: string;
  updated_at: string;
}

/** Picker row from /api/stock/cells — flat cell with warehouse +
 *  location breadcrumbs so the receive form can render one
 *  searchable dropdown. */
export interface StockCellPickerRow {
  id: number;
  uuid: string;
  ordinal: number;
  name: string | null;
  /** Tags assigned directly to the cell. */
  tags: string[];
  /** Union of cell.tags + location.tags. The receive form tests
   *  `item.storage_tags ⊆ effective_tags` to decide if the cell
   *  qualifies. */
  effective_tags: string[];
  storage_location: {
    id: number;
    uuid: string;
    name: string;
    code: string | null;
    tags: string[];
  };
  floor: { id: number; uuid: string; name: string };
  warehouse: { id: number; uuid: string; name: string };
}

export interface AuthResponse {
  token: string;
  user: User;
}

// ---------- Linked devices -----------------------------------------

export type DevicePlatform = "ios" | "android" | "web" | "other";

export interface LinkedDevice {
  id: number;
  uuid: string;
  code: string | null;
  label: string;
  platform: DevicePlatform | null;
  user_agent: string | null;
  paired_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  inserted_at: string;
  updated_at: string;
}

export interface DevicePairingCode {
  uuid: string;
  code: string;
  expires_at: string;
  used_at: string | null;
  inserted_at: string;
}

export interface DeviceClaimResponse {
  device: LinkedDevice;
  token: string;
}

// ---------------------------------------------------------------
// Customer orders (sell-side mirror of POs).
// ---------------------------------------------------------------

export type CustomerOrderStatus =
  | "draft"
  | "pending_approver"
  | "pending_director"
  | "approved"
  | "confirmed"
  | "cancelled";

export type CustomerOrderApprovalKind = "approver" | "director";

export interface CustomerOrderLine {
  uuid: string;
  customer_order_id: number;
  item_id: number;
  item: {
    id: number;
    uuid: string;
    code: string | null;
    name: string;
    stock_uom: { id: number; symbol: string; name: string } | null;
  } | null;
  qty_ordered: string;
  unit_price: string;
  discount_pct: string;
  line_subtotal: string;
  expected_ship_date: string | null;
  customer_part_no: string | null;
  notes: string | null;
  warehouse_id: number | null;
  warehouse: { id: number; uuid: string; name: string } | null;
  pricelist_id: number | null;
  pricelist: {
    id: number;
    uuid: string;
    name: string;
    currency_code: string;
  } | null;
  inserted_at: string;
  updated_at: string;
}

export interface CustomerOrderApprovalRow {
  uuid: string;
  customer_order_id: number;
  kind: CustomerOrderApprovalKind;
  signed_at: string;
  notes: string | null;
  signed_by: AuditActor | null;
  inserted_at: string;
}

export interface CustomerOrderFile {
  id: number;
  uuid: string;
  kind: "quote" | "proforma" | "shipping_doc" | "acknowledgement" | "other";
  filename: string;
  mime: string;
  byte_size: number;
  url: string;
  uploaded_at: string;
  uploaded_by: AuditActor | null;
}

export interface CustomerOrder {
  id: number;
  uuid: string;
  code: string | null;
  status: CustomerOrderStatus;
  customer: {
    id: number;
    uuid: string;
    code: string | null;
    name: string;
    currency_code: string;
    payment_terms_days: number;
    payment_terms_basis: CustomerPaymentBasis;
    trade_credit_limit: string | null;
    approval_status: CustomerApprovalStatus;
    effective_approval_status: CustomerApprovalStatus;
  } | null;
  customer_id: number;
  currency_code: string;
  subtotal: string;
  discount_pct: string;
  discount_amount: string;
  tax_rate: string;
  tax_amount: string;
  shipping_fees: string;
  additional_fees: string;
  grand_total: string;
  expected_ship_date: string | null;
  delivery_address: string | null;
  customer_reference: string | null;
  notes: string | null;
  default_warehouse_id: number | null;
  default_warehouse: { id: number; uuid: string; name: string } | null;
  submitted_at: string | null;
  submitted_by: AuditActor | null;
  confirmed_at: string | null;
  confirmed_by: AuditActor | null;
  cancelled_at: string | null;
  cancelled_by: AuditActor | null;
  cancellation_reason: string | null;
  lines: CustomerOrderLine[];
  approvals: CustomerOrderApprovalRow[];
  files: CustomerOrderFile[];
  inserted_at: string;
  updated_at: string;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
}

export interface PriceSuggestion {
  unit_price: string;
  currency_code: string;
  min_quantity: string;
  pricelist_id: number;
  pricelist_uuid: string;
  pricelist_name: string;
  source: "customer" | "company_default";
}

export interface CustomerApprovedItemRow {
  uuid: string;
  customer_id: number;
  item_id: number;
  item: {
    id: number;
    uuid: string;
    code: string | null;
    name: string;
    stock_uom: { id: number; symbol: string; name: string } | null;
  } | null;
  approved_at: string | null;
  approved_by: AuditActor | null;
  notes: string | null;
}

// ---------------------------------------------------------------
// Customer invoices.
// ---------------------------------------------------------------

export type CustomerInvoiceKind =
  | "invoice"
  | "proforma"
  | "credit_note"
  | "quotation";

export type CustomerInvoiceStatus =
  | "draft"
  | "sent"
  | "partially_paid"
  | "paid"
  | "cancelled";

export type CustomerInvoicePaymentMethod =
  | "bank_transfer"
  | "card"
  | "cash"
  | "cheque"
  | "other";

export interface CustomerInvoiceLineRow {
  uuid: string;
  customer_invoice_id: number;
  item_id: number | null;
  item: {
    id: number;
    uuid: string;
    code: string | null;
    name: string;
    stock_uom: { id: number; symbol: string; name: string } | null;
  } | null;
  customer_order_line_id: number | null;
  description: string | null;
  qty: string;
  unit_price: string;
  discount_pct: string;
  line_subtotal: string;
  delivery_date: string | null;
  notes: string | null;
  inserted_at: string;
  updated_at: string;
}

export interface CustomerInvoicePaymentRow {
  uuid: string;
  customer_invoice_id: number;
  paid_at: string;
  amount: string;
  method: CustomerInvoicePaymentMethod;
  reference: string | null;
  notes: string | null;
  recorded_by: AuditActor | null;
  inserted_at: string;
}

export interface CustomerInvoice {
  id: number;
  uuid: string;
  code: string | null;
  kind: CustomerInvoiceKind;
  status: CustomerInvoiceStatus;
  customer: {
    id: number;
    uuid: string;
    code: string | null;
    name: string;
    currency_code: string;
    payment_terms_days: number;
    payment_terms_basis: CustomerPaymentBasis;
    trade_credit_limit: string | null;
    approval_status: CustomerApprovalStatus;
    effective_approval_status: CustomerApprovalStatus;
  } | null;
  customer_id: number;
  customer_order: {
    id: number;
    uuid: string;
    code: string | null;
    status: string;
    grand_total: string;
  } | null;
  customer_order_id: number | null;
  currency_code: string;
  subtotal: string;
  discount_pct: string;
  discount_amount: string;
  tax_rate: string;
  tax_amount: string;
  grand_total: string;
  paid_amount: string;
  outstanding: string;
  invoice_date: string;
  due_date: string | null;
  billing_address: string | null;
  customer_reference: string | null;
  free_text: string | null;
  sent_at: string | null;
  sent_by: AuditActor | null;
  cancelled_at: string | null;
  cancelled_by: AuditActor | null;
  cancellation_reason: string | null;
  lines: CustomerInvoiceLineRow[];
  payments: CustomerInvoicePaymentRow[];
  inserted_at: string;
  updated_at: string;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
}

// ---------------------------------------------------------------
// Customer returns (RMAs).
// ---------------------------------------------------------------

export type CustomerReturnStatus =
  | "draft"
  | "received"
  | "accepted"
  | "rejected"
  | "cancelled";

export type CustomerReturnReasonCode =
  | "damaged"
  | "wrong_item"
  | "quality_fail"
  | "customer_changed_mind"
  | "short_shipment"
  | "overshipment"
  | "other";

export type CustomerReturnFileKind = "photo" | "doc";

export interface CustomerReturnLineRow {
  uuid: string;
  customer_return_id: number;
  item_id: number | null;
  item: {
    id: number;
    uuid: string;
    code: string | null;
    name: string;
    stock_uom: { id: number; symbol: string; name: string } | null;
  } | null;
  customer_invoice_line_id: number | null;
  qty_returned: string;
  qty_accepted: string | null;
  reason_code: CustomerReturnReasonCode;
  reason_notes: string | null;
  unit_price: string;
  line_credit_amount: string;
  inspection_notes: string | null;
  inserted_at: string;
  updated_at: string;
}

export interface CustomerReturnFileRow {
  id: number;
  uuid: string;
  kind: CustomerReturnFileKind;
  filename: string;
  mime: string;
  byte_size: number;
  url: string | null;
  uploaded_at: string;
  uploaded_by: AuditActor | null;
}

export interface CustomerReturn {
  id: number;
  uuid: string;
  code: string | null;
  status: CustomerReturnStatus;
  customer: {
    id: number;
    uuid: string;
    code: string | null;
    name: string;
    currency_code: string;
    payment_terms_days: number;
    payment_terms_basis: CustomerPaymentBasis;
    trade_credit_limit: string | null;
    approval_status: CustomerApprovalStatus;
    effective_approval_status: CustomerApprovalStatus;
  } | null;
  customer_id: number;
  customer_invoice: {
    id: number;
    uuid: string;
    code: string | null;
    status: CustomerInvoiceStatus;
    grand_total: string;
    currency_code: string;
  } | null;
  customer_invoice_id: number | null;
  return_date: string;
  reason_summary: string | null;
  notes: string | null;
  received_at: string | null;
  received_by: AuditActor | null;
  resolved_at: string | null;
  resolved_by: AuditActor | null;
  cancelled_at: string | null;
  cancelled_by: AuditActor | null;
  cancellation_reason: string | null;
  rejection_reason: string | null;
  lines: CustomerReturnLineRow[];
  files: CustomerReturnFileRow[];
  inserted_at: string;
  updated_at: string;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
}

// ---------------------------------------------------------------
// Today's contacts — daily CRM follow-up surface.
// ---------------------------------------------------------------

export interface TodayCustomer {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  currency_code: string;
  approval_status: CustomerApprovalStatus;
  effective_approval_status: CustomerApprovalStatus;
  status: string;
  last_contact_at: string | null;
  next_contact_at: string | null;
  contact_frequency_months: number;
  total_orders_count: number;
  days_overdue: number | null;
  days_since_contact: number | null;
}

export interface TodayBuckets {
  due_today: TodayCustomer[];
  overdue: TodayCustomer[];
  going_quiet: TodayCustomer[];
}

// ---------------------------------------------------------------
// Cash flow — 12-week receivables + payables forecast.
// ---------------------------------------------------------------

export interface CashFlowBucket {
  week_index: number;
  /** ISO date — Monday of the bucket's week */
  week_start: string;
  ar_due: string;
  ar_projected: string;
  ap_due: string;
  ap_planned: string;
  net: string;
  cumulative: string;
}

export interface CashFlowOverdue {
  ar_due: string;
  ar_projected: string;
  ap_due: string;
  ap_planned: string;
  net: string;
}

export interface CashFlowTotals {
  outstanding_ar: string;
  projected_ar: string;
  outstanding_ap: string;
  planned_ap: string;
  net_position: string;
}

export interface CashFlowForecast {
  weeks_ahead: number;
  base_currency: string;
  excluded_currencies: string[];
  buckets: CashFlowBucket[];
  overdue: CashFlowOverdue;
  totals: CashFlowTotals;
}

// ---------------------------------------------------------------
// Sales statistics — look-back analytics snapshot.
// ---------------------------------------------------------------

export interface StatisticsKpis {
  revenue_this_month: string;
  revenue_ytd: string;
  revenue_prior_ytd: string;
  revenue_prior_year_full: string;
  avg_invoice_value: string;
  invoices_sent_count: number;
  active_customers: number;
}

export interface StatisticsMonthRow {
  /** ISO date — first of the month */
  month_start: string;
  invoice_revenue: string;
  credit_notes: string;
  net: string;
}

export interface StatisticsTopCustomer {
  customer_id: number;
  customer_name: string;
  revenue: string;
  /** Aligned with revenue_by_month length (12 entries) */
  monthly_series: string[];
}

export interface StatisticsTopItem {
  item_id: number;
  item_uuid: string | null;
  item_name: string;
  revenue: string;
  qty: string;
}

export interface StatisticsFunnel {
  lead: number;
  prospect: number;
  active: number;
  dormant: number;
  inactive: number;
}

export interface StatisticsSnapshot {
  months: number;
  base_currency: string;
  excluded_currencies: string[];
  kpis: StatisticsKpis;
  revenue_by_month: StatisticsMonthRow[];
  top_customers: StatisticsTopCustomer[];
  top_items: StatisticsTopItem[];
  funnel: StatisticsFunnel;
}

// ---------------------------------------------------------------
// Sales management — book of business per account manager.
// ---------------------------------------------------------------

export interface SalesManagementLeaderRow {
  manager_id: number;
  manager_name: string;
  customers_count: number;
  active_customers_count: number;
  approved_customers_count: number;
  revenue_ytd: string;
  outstanding_ar: string;
  pipeline_value: string;
}

export interface SalesManagementFunnelStage {
  stage: string;
  count: number;
  total_value: string;
}

export interface SalesManagementUnassignedRow {
  id: number;
  uuid: string;
  name: string;
  approval_status: CustomerApprovalStatus;
  last_contact_at: string | null;
  total_orders_count: number;
}

export interface SalesManagementSnapshot {
  base_currency: string;
  excluded_currencies: string[];
  leaderboard: SalesManagementLeaderRow[];
  funnel: SalesManagementFunnelStage[];
  unassigned: SalesManagementUnassignedRow[];
}

// ---------------------------------------------------------------
// Loyalty — programs, tiers, customer credits, dashboard.
// ---------------------------------------------------------------

/** V1 only ships `tiered_rebate`; enum has room for future modes
 *  (`flat_rebate`, `points`, etc.). Locked in the UI as a single
 *  option per CLAUDE.md "if it can be computed, don't ask" — the
 *  workflow narrows down to one for now. */
export type LoyaltyScheme = "tiered_rebate";

/** YTD revenue is the only basis in V1. Future: rolling 12m. */
export type LoyaltyBasis = "ytd_revenue";

/** What earns when a customer crosses a tier. V1 = credit balance
 *  applied against future invoices. Future: discount %, points. */
export type LoyaltyPayoutKind = "credit";

export interface LoyaltyTier {
  id: number;
  uuid: string;
  loyalty_program_id: number;
  rank: number;
  /** Threshold in the program's basis units (string-Decimal so we
   *  don't lose precision in the browser). */
  min_threshold: string;
  /** Accrual rate as a percent (`"2.50"` ⇒ 2.5 %). */
  rate_pct: string;
  label: string | null;
  inserted_at: string;
  updated_at: string;
}

export interface LoyaltyProgram {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  description: string | null;
  scheme: LoyaltyScheme;
  basis: LoyaltyBasis;
  payout_kind: LoyaltyPayoutKind;
  is_active: boolean;
  is_default: boolean;
  activated_at: string | null;
  deactivated_at: string | null;
  deactivation_reason: string | null;
  tiers: LoyaltyTier[];
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

/** Discriminator for one ledger row. `rebate_accrual` posts when an
 *  invoice payment crosses a tier threshold; `manual_grant` is a
 *  goodwill credit; `applied_to_invoice` is the redemption side that
 *  reduces the balance + sometimes spawns a paired credit note. */
export type CustomerCreditKind =
  | "rebate_accrual"
  | "manual_grant"
  | "applied_to_invoice";

export interface CustomerCredit {
  id: number;
  uuid: string;
  code: string | null;
  customer: {
    id: number;
    uuid: string;
    name: string;
    code: string | null;
  } | null;
  customer_id: number;
  kind: CustomerCreditKind;
  /** Signed Decimal as string. Accruals + grants are positive; an
   *  apply is negative — the ledger sums to the current balance. */
  amount: string;
  currency_code: string;
  reason: string | null;
  loyalty_program: { id: number; uuid: string; name: string } | null;
  loyalty_program_id: number | null;
  loyalty_program_tier_id: number | null;
  source_invoice: {
    id: number;
    uuid: string;
    code: string | null;
    kind: CustomerInvoiceKind;
    status: CustomerInvoiceStatus;
    grand_total: string;
  } | null;
  source_invoice_id: number | null;
  credit_note_invoice: {
    id: number;
    uuid: string;
    code: string | null;
    status: CustomerInvoiceStatus;
    grand_total: string;
  } | null;
  credit_note_invoice_id: number | null;
  granted_by: AuditActor | null;
  granted_by_id: number | null;
  inserted_at: string;
  updated_at: string;
}

export interface LoyaltyPerCustomerRow {
  customer: { id: number; uuid: string; name: string } | null;
  currency_code: string;
  balance: string;
  total_earned: string;
  total_applied: string;
}

export interface LoyaltyDashboard {
  base_currency: string;
  programs: LoyaltyProgram[];
  per_customer: LoyaltyPerCustomerRow[];
  recent_ledger: CustomerCredit[];
  /** Optional — BE may not return this if all FX rates are present. */
  excluded_currencies?: string[];
}

// ---------------------------------------------------------------
// Order wizard — single-page projection of a CO's full lifecycle.
// One snapshot returned by GET /api/customer-orders/:uuid/wizard
// that aggregates the CO, derived phase, the next compliance-driven
// action, blockers, per-line MO state, open POs covering placeholder
// bookings, and a chronological timeline.
// ---------------------------------------------------------------

export type OrderWizardPhaseKey =
  | "setup"
  | "approval"
  | "production_planning"
  | "awaiting_ingredients"
  | "in_production"
  | "closeout"
  | "final_release"
  | "awaiting_routing"
  | "ready_to_dispatch"
  | "cancelled";

export interface OrderWizardPhase {
  key: OrderWizardPhaseKey;
  label: string;
  /** 0..6 for forward phases; -1 for cancelled. */
  index: number;
  /** Total number of forward phases (typically 7). */
  total: number;
  is_terminal: boolean;
}

export type OrderWizardCtaKind =
  | "action"
  | "link"
  | "scroll_to"
  | "send_to_device";

export interface OrderWizardCta {
  label: string;
  kind: OrderWizardCtaKind;
  /** kind=action: "submit" | "sign_approver" | "sign_director"
   *   | "confirm" | "create_mo_for_line" | "request_purchases"
   *   | "prepare_mo" | "approve_mo" */
  action?: string;
  /** kind=action + action="create_mo_for_line" — which line to spawn. */
  line_uuid?: string;
  /** kind=action + action="create_mo_for_line" — optional BOM id when the
   *  line has more than one BOM available (BE auto-picks if omitted). */
  bom_id?: number;
  /** kind=action with an MO-scoped action (request_purchases / prepare_mo
   *  / approve_mo) — the MO this CTA targets. Also surfaced on
   *  send_to_device CTAs so the QR modal can attribute the deep-link. */
  mo_uuid?: string;
  /** kind=link / send_to_device — destination href. */
  href?: string;
  /** kind=scroll_to — CSS selector to scroll into view. */
  target?: string;
  /** Optional row description shown next to the button when this CTA
   *  is rendered in the "Do this next" list. Lets the BE attach the
   *  full sentence ("Pick up MO MO00026 from warehouse.") next to a
   *  short button label ("Send pickup to device"). */
  description?: string | null;
}

export interface OrderWizardNextAction {
  code: string;
  title: string;
  detail: string | null;
  primary_cta: OrderWizardCta | null;
  secondary_ctas: OrderWizardCta[];
  shortages_link?: { label: string; href: string };
  scheduler_link?: { label: string; href: string };
}

export type OrderWizardBlockerSeverity = "error" | "warning";

export interface OrderWizardBlocker {
  code: string;
  severity: OrderWizardBlockerSeverity;
  message: string;
  link: { label: string; href: string } | null;
}

export type OrderWizardMoStatus =
  | "draft"
  | "prepared"
  | "approved"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface OrderWizardMoOutputLot {
  uuid: string;
  /** Company-configured stock-lot code (e.g. `L00173`) — the same
   *  identifier the operator sees on the lot page + labels. Nil when
   *  the numbering format for `stock_lot` isn't configured. */
  code: string | null;
  /** Human-readable batch number. For manufactured lots produced by
   *  an MO closeout this can be null (no batch stamped) — the
   *  wizard then falls back to `code` and finally a positional stub. */
  supplier_batch_no: string | null;
  status: string;
  qty: string;
  at_production_feed: boolean;
  /** Positively-released lot that still owes a 3PL vs shipment
   *  routing answer. When true, the wizard renders the routing chip
   *  and the release detail page shows the routing form. */
  needs_routing: boolean;
  /** Bailee custody flag. `own` = we own; `bailee` = customer-owned,
   *  we hold post routing_to_3pl decision. Drives the "held for
   *  {customer}" chip on 3PL views. */
  ownership_kind: "own" | "bailee";
}

export interface OrderWizardMo {
  id: number;
  uuid: string;
  code: string | null;
  status: OrderWizardMoStatus;
  quantity: string;
  item_name: string | null;
  bookings_total: number;
  placeholder_count: number;
  /** Subset of `placeholder_count`: placeholders whose covering PO is
   *  fully received but the lots are still in quarantine awaiting QC.
   *  Drives the "awaiting QC" chip on the project board. */
  placeholder_awaiting_qc_count: number;
  /** Subset of `placeholder_count`: placeholders whose PO is ordered
   *  or partially received — goods in transit from the vendor. */
  placeholder_in_transit_count: number;
  /** Subset of `placeholder_count`: placeholders whose PO hasn't been
   *  sent to the vendor yet (draft / pending_* / approved). */
  placeholder_not_sent_count: number;
  has_placeholder_bookings: boolean;
  broken_booking_count: number;
  output_lot_count: number;
  output_at_feed_count: number;
  output_in_warehouse_count: number;
  /** Output lots from this MO still in `received` status — they
   *  need an output-QC verdict before closeout can advance. Counted
   *  so the wizard can render an "awaiting output QC" sub-stage on
   *  completed MOs instead of jumping straight to "Closeout". */
  output_qc_pending_count: number;
  /** Booking rows on this MO that still need the per-booking
   *  closeout (record consumed_quantity + route leftover ingredient
   *  material to dispatch). Must hit zero BEFORE the warehouse
   *  return-pickup can fetch outputs + leftovers back — otherwise
   *  the dispatch pile gets orphaned on the production side. */
  bookings_closeout_pending_count: number;
  /** Output lots that passed output-QC but haven't cleared Final
   *  Product Release (BRCGS 5.6). Drives the release CTA + keeps the
   *  MO card on the `wrap` phase until QA signs off. */
  output_awaiting_release_count: number;
  /** Uuids of the awaiting-release lots — used by the "Open Final
   *  Product Release" CTA to link straight to the dialog. */
  output_awaiting_release_lot_uuids: string[];
  /** Subset of `output_awaiting_release_*` — lots that still need to
   *  be physically moved to a finished_quarantine cell before the
   *  release form will unblock (BRCGS § 5.6 + § 4.4 segregation). */
  output_release_move_needed_count: number;
  output_release_move_needed_lot_uuids: string[];
  /** Subset of `output_awaiting_release_*` — lots already parked in a
   *  finished_quarantine cell, ready for the QA sign-off ceremony. */
  output_release_ready_count: number;
  output_release_ready_lot_uuids: string[];
  /** Positively-released lots still owing a 3PL vs shipment routing
   *  decision. Drives the `awaiting_routing` phase + the wizard CTA
   *  linking to the routing form. */
  output_needs_routing_count: number;
  output_needs_routing_lot_uuids: string[];
  has_output_at_production_feed: boolean;
  /** Cancelled MO whose picked bookings still hold physical stock at
   *  the production-side cell. Warehouse picker owes a return-pickup
   *  to walk them back — count drives the "N lots awaiting return"
   *  chip on the wizard's MO card. */
  cancelled_orphan_booking_count: number;
  purchasing_requested_at: string | null;
  /** Set the moment a picker claims the MO (head-of-picker lock).
   *  Used to render the "picking in progress" sub-stage on the
   *  wizard so the room knows who's on the floor with the trolley. */
  pickup_started_at: string | null;
  pickup_started_by_name: string | null;
  /** Set when the warehouse picker has dropped this MO's bookings at
   *  the production-feed cell. Until then, the production operator
   *  has nothing to preflight — the wizard's "Send preflight" CTA is
   *  gated on this field so the link target matches the menu list. */
  pickup_completed_at: string | null;
  /** True when every raw/packaging/semi booking on this MO has its
   *  `received_at` stamped (i.e. the preflight operator has signed
   *  every booking off). The BE's `start_mo_production` requires
   *  this — the wizard splits "scheduled + pickup done" into
   *  "awaiting preflight" vs "ready to start" based on this flag. */
  preflight_complete: boolean;
  /** True when this MO is past approval AND has no unresolved
   *  shortages (every booking is real, or procurement is engaged
   *  for the placeholders). Drives the per-MO "needs attention"
   *  hint on the project board. */
  is_fully_sorted: boolean;
  due_date: string | null;
  output_lots: OrderWizardMoOutputLot[];
  /** Sub-MOs auto-spawned when this MO's BOM needed a semi-finished
   *  the stock couldn't cover. Recursive — children may have their
   *  own children. The wizard treats them like any other MO when
   *  deciding whether the order can leave production_planning. */
  children: OrderWizardMo[];
}

export interface OrderWizardAvailableBom {
  id: number;
  uuid: string;
  name: string;
  code: string | null;
  is_primary: boolean;
}

export interface OrderWizardLine {
  uuid: string;
  id: number;
  item_id: number | null;
  item_name: string | null;
  qty_ordered: string;
  needs_mo: boolean;
  primary_mo: OrderWizardMo | null;
  mos: OrderWizardMo[];
  /** BOMs the operator can choose from when spawning an MO for this
   *  line. Empty when the item has no published BOM (the row surfaces
   *  a blocker instead of a picker). */
  available_boms: OrderWizardAvailableBom[];
}

export interface OrderWizardOpenPo {
  id: number;
  uuid: string;
  code?: string | null;
  status: string;
  expected_delivery_date: string | null;
  grand_total: string;
  currency_code: string;
  vendor_name?: string | null;
}

export interface OrderWizardSigner {
  /** "approver" | "director" */
  kind: string;
  signed_at: string | null;
  signed_by: { name: string } | null;
  notes: string | null;
}

export interface OrderWizardSigners {
  approver: OrderWizardSigner | null;
  director: OrderWizardSigner | null;
}

export interface OrderWizardTimelineEntry {
  at: string;
  label: string;
  scope: "co" | "mo";
  mo_uuid?: string;
  actor?: string | null;
}

export interface OrderWizardInvoice {
  id: number;
  uuid: string;
  code: string | null;
  /** "invoice" | "proforma" | "credit_note" | "quotation" */
  kind: string;
  /** "draft" | "sent" | "partially_paid" | "paid" | "cancelled" */
  status: string;
  grand_total: string;
  currency_code: string;
  invoice_date: string | null;
  due_date: string | null;
}

export interface OrderWizardSnapshot {
  customer_order: CustomerOrder;
  phase: OrderWizardPhase;
  next_action: OrderWizardNextAction | null;
  blockers: OrderWizardBlocker[];
  lines: OrderWizardLine[];
  /** Flattened MOs across every line — useful for cross-line summary
   *  counters and the MO modal lookups (uuid → MO). */
  mos?: OrderWizardMo[];
  open_pos: OrderWizardOpenPo[];
  /** Invoices already raised against this CO (cancelled excluded).
   *  Invoicing is decoupled from production: some orders ship without
   *  an invoice, some are pro-forma'd up front. The PCB uses this to
   *  show an advisory "no invoice attached" reminder once confirmed. */
  invoices?: OrderWizardInvoice[];
  timeline: OrderWizardTimelineEntry[];
  /** Approval signer rollup — fills as the CO walks through the
   *  two-tier approval gate. */
  signers?: OrderWizardSigners;
}

// ---------------------------------------------------------------
// Projects landing — one row per active CO.
// ---------------------------------------------------------------

export interface ProjectSummary {
  customer_order: CustomerOrder;
  phase: OrderWizardPhase;
  next_action_title: string | null;
  next_action_detail: string | null;
  next_action_cta:
    | OrderWizardNextAction["primary_cta"]
    | null;
  blocker_count: number;
  line_count: number;
  mo_count: number;
  lines_awaiting_mo: number;
  /** MOs whose placeholder-bookings include at least one PO still
   *  in draft / pending-approval / approved-but-not-ordered. The
   *  next action is "push the PO out the door." */
  mos_awaiting_po_send: number;
  /** MOs whose placeholder-bookings are all on ordered or
   *  partially-received POs — the planner has nothing to do, just
   *  wait on the vendor. */
  mos_awaiting_delivery: number;
  /** Total MOs with any placeholder bookings. Kept for backwards
   *  compatibility; new UI should branch on the two fields above. */
  mos_with_placeholders: number;
  mos_in_production: number;
  mos_awaiting_closeout: number;
}
