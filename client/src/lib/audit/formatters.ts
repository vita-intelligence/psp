// Per-entity field labels + value formatters for the Activity
// timeline. Maps the snake_case column names the backend writes into
// the audit log to friendly labels + readable values so non-engineers
// reading a history row don't have to translate.

import type { AuditEvent } from "../types";

type EntityType = AuditEvent["entity_type"];

/**
 * Friendly column names. Anything not in the map falls back to a
 * title-cased version of the raw key, which is still better than
 * showing `is_active` to a non-technical reader.
 */
const FIELD_LABELS: Record<EntityType, Record<string, string>> = {
  warehouse: {
    name: "Name",
    address: "Address",
    notes: "Notes",
    is_active: "Active",
    timezone: "Timezone",
    working_hours: "Working hours",
    holidays: "Holidays",
    contacts: "Contacts",
    plan: "Plan",
  },
  user: {
    is_admin: "Admin access",
    permissions: "Permissions",
    hourly_wage: "Hourly wage",
  },
  template: {
    name: "Name",
    description: "Description",
    permissions: "Permissions",
  },
  floor: {
    name: "Name",
    ordinal: "Floor order",
    canvas_json: "Drawing",
  },
  storage_location: {
    name: "Name",
    code: "Code",
    kind: "Kind",
    x: "X position",
    y: "Y position",
    width: "Width",
    height: "Depth",
    width_m: "Width (m)",
    height_m: "Depth (m)",
    depth_m: "Vertical depth (m)",
    capacity: "Capacity",
    notes: "Notes",
    color: "Colour",
    floor_id: "Floor",
  },
  storage_cell: {
    name: "Name",
    ordinal: "Level",
    width_m: "Width (m)",
    depth_m: "Depth (m)",
    height_m: "Height (m)",
    max_weight_kg: "Max weight (kg)",
    tags: "Tags",
    notes: "Notes",
    storage_location_id: "Parent location",
  },
  storage_tag: {
    key: "Key",
    label: "Label",
    description: "Description",
    kind: "Where it applies",
  },
  unit_of_measurement: {
    name: "Name",
    symbol: "Symbol",
    dimension: "Dimension",
    factor_to_base: "Factor to base unit",
    is_base: "Base unit",
    is_active: "Active",
  },
  item: {
    name: "Name",
    description: "Description",
    item_type: "Type",
    external_sku: "External SKU",
    barcode: "Barcode",
    stock_uom_id: "Stock unit",
    product_family_id: "Product family",
    attributes: "Custom attributes",
    is_active: "Active",
  },
  product_family: {
    name: "Name",
    description: "Description",
    is_active: "Active",
  },
  attribute_definition: {
    scope: "Scope",
    key: "Key",
    label: "Label",
    attribute_type: "Type",
    enum_choices: "Choices",
    required: "Required",
    default_value: "Default value",
    unit_symbol: "Unit symbol",
    help_text: "Help text",
    sort_order: "Order",
    is_active: "Active",
  },
  raw_material_compliance: {
    use_as: "Used as",
    allergen_status: "Allergen status",
    vegan_status: "Vegan status",
    halal_status: "Halal status",
    kosher_status: "Kosher status",
    organic_status: "Organic status",
    novel_food_status: "Novel food status",
    gmo_status: "GMO status",
    country_of_origin: "Country of origin",
    purity_pct: "Purity (%)",
    extract_ratio: "Extract ratio",
    overage_pct: "Overage (%)",
    powder_water_dose_mg_per_ml: "Powder water dose (mg/mL)",
    shelf_life_months: "Shelf life (months)",
    storage_conditions: "Storage conditions",
    spec_document_file_id: "Spec document",
    last_reviewed_at: "Last reviewed",
    review_frequency_months: "Review frequency (months)",
    review_due_at: "Review due",
  },
  finished_product_spec: {
    regulatory_category: "Regulatory category",
    dosage_form: "Dosage form",
    capsule_size: "Capsule size",
    tablet_size_mm: "Tablet size (mm)",
    powder_type: "Powder type",
    serving_size: "Serving size",
    servings_per_pack: "Servings per pack",
    net_quantity: "Net quantity",
    directions_of_use: "Directions of use",
    suggested_dosage: "Suggested dosage",
    warnings_text: "Warnings",
    appearance: "Appearance",
    disintegration_spec: "Disintegration spec",
    weight_uniformity_pct: "Weight uniformity (%)",
    shelf_life_months: "Shelf life (months)",
    storage_conditions: "Storage conditions",
    food_contact_status: "Food contact status",
    active_claims: "Active claims",
    general_claims: "General claims",
    nutrition_table: "Nutrition table",
    target_markets: "Target markets",
    spec_document_file_id: "Spec document",
    may_contain_allergens: "May contain allergens",
    may_contain_justification: "May contain justification",
    contaminant_limits_overrides: "Contaminant limit overrides",
  },
  packaging_compliance: {
    material: "Material",
    food_contact_compliant: "Food-contact compliant",
    food_contact_declaration_file_id: "Food contact declaration",
    recyclability_code: "Recyclability code",
    migration_test_file_id: "Migration test report",
    migration_test_expires_at: "Migration test expires",
  },
  certificate: {
    name: "Name",
    certificate_type: "Type",
    issuing_body: "Issuing body",
    default_validity_months: "Default validity (months)",
    description: "Description",
    is_active: "Active",
  },
  item_certificate: {
    certificate_id: "Certificate",
    certificate_number: "Certificate number",
    valid_from: "Valid from",
    valid_until: "Valid until",
    document_url: "Document URL",
    notes: "Notes",
    uploaded_at: "Uploaded at",
  },
  item_image: {
    blob_path: "Blob path",
    caption: "Caption",
    is_primary: "Primary",
    sort_order: "Order",
    original_filename: "Filename",
    content_type: "Content type",
    byte_size: "File size (bytes)",
  },
  raw_material_risk_assessment: {
    physical_risk_score: "Physical risk score",
    chemical_risk_score: "Chemical risk score",
    biological_risk_score: "Biological risk score",
    allergen_risk_score: "Allergen risk score",
    radiological_risk_score: "Radiological risk score",
    fraud_vulnerability_score: "Fraud vulnerability score",
    malicious_risk_score: "Malicious risk score",
    computed_overall_level: "Computed overall level",
    overridden_overall_level: "Overridden level",
    override_justification: "Override justification",
    justification: "Justification",
    required_controls: "Required controls",
    assessed_at: "Assessed at",
  },
  stock_lot: {
    status: "Status",
    qty_received: "Qty received",
    supplier_batch_no: "Supplier batch",
    country_of_origin: "Country of origin",
    revision: "Revision",
    manufactured_at: "Manufactured",
    expiry_at: "Expires",
    available_from: "Available from",
    received_at: "Received",
    notes: "Notes",
    source_kind: "Source",
    source_ref: "Source ref",
    unit_cost: "Unit cost",
    currency: "Currency",
    package_length_mm: "Package length (mm)",
    package_width_mm: "Package width (mm)",
    package_height_mm: "Package height (mm)",
    package_weight_kg: "Package weight (kg)",
    units_per_package: "Units / package",
    stack_factor: "Stack factor",
    overall_risk: "Overall risk",
    allergen_status: "Allergen status",
    coa_status: "CoA status",
    quality_status: "Quality status",
  },
  stock_lot_placement: {
    qty: "Quantity",
    storage_cell_id: "Storage cell",
  },
  stock_movement: {
    delta_qty: "Quantity delta",
    kind: "Kind",
    reason: "Reason",
    from_cell_id: "From cell",
    to_cell_id: "To cell",
    photo_url: "Photo",
    skip_photo_reason: "Skip-photo reason",
  },
  vendor: {
    name: "Name",
    legal_name: "Legal name",
    email: "Email",
    phone: "Phone",
    website: "Website",
    contact_name: "Contact name",
    legal_address: "Legal address",
    registration_number: "Registration number",
    tax_number: "Tax / VAT number",
    tax_rate: "Tax rate",
    currency_code: "Currency",
    default_lead_time_days: "Default lead time (days)",
    payment_terms_days: "Payment terms (days)",
    payment_basis: "Payment basis",
    supply_chain_type: "Supply chain type",
    vendor_risk: "Risk class",
    product_types: "Product types",
    questionnaire_status: "Questionnaire (SAQ)",
    traceability_verification_status: "Traceability verification",
    review_frequency_months: "Review cadence (months)",
    last_review_at: "Last review",
    next_review_at: "Next review",
    approval_status: "Approval status",
    approval_notes: "Approval notes",
    approved_at: "Approved at",
    notes: "Notes",
    is_active: "Active",
  },
  vendor_approved_item: {
    vendor_id: "Vendor",
    item_id: "Item",
  },
  vendor_certificate: {
    vendor_id: "Vendor",
    certificate_id: "Certificate",
    valid_until: "Valid until",
    certificate_number: "Certificate number",
  },
  purchase_order: {
    status: "Status",
    vendor_id: "Vendor",
    currency_code: "Currency",
    subtotal: "Subtotal",
    tax_amount: "Tax",
    total_amount: "Total",
    expected_delivery_date: "Expected delivery",
    delivery_address: "Delivery address",
    notes: "Notes",
    submitted_at: "Submitted at",
    ordered_at: "Ordered at",
    received_at: "Received at",
    cancelled_at: "Cancelled at",
    cancellation_reason: "Cancellation reason",
  },
  purchase_order_line: {
    item_id: "Item",
    qty_ordered: "Qty ordered",
    qty_received: "Qty received",
    unit_price: "Unit price",
    line_subtotal: "Line subtotal",
  },
  purchase_order_approval: {
    kind: "Tier",
    signed_by_id: "Signer",
    purchase_order_id: "Purchase order",
  },
  bom: {
    name: "Name",
    code: "Number",
    notes: "Notes",
    is_primary: "Primary recipe",
    is_active: "Active",
    item_id: "Output item",
    lines: "Parts",
  },
  workstation_group: {
    name: "Name",
    code: "Number",
    notes: "Notes",
    instances: "Number of instances",
    kind: "Type",
    hourly_rate_enabled: "Hourly rate set",
    hourly_rate: "Hourly rate",
    custom_working_hours: "Custom working hours",
    working_hours: "Working hours",
    custom_holidays: "Custom holidays",
    holidays: "Holidays",
    color: "Colour",
    is_active: "Active",
  },
  workstation: {
    name: "Name",
    code: "Number",
    notes: "Notes",
    workstation_group_id: "Workstation group",
    warehouse_id: "Production site",
    hourly_rate_enabled: "Hourly rate override",
    hourly_rate: "Hourly rate",
    productivity: "Productivity",
    idle_from: "Idle from",
    idle_to: "Idle to",
    is_active: "Active",
    external_id: "vita-performance ID",
  },
  machine: {
    name: "Name",
    notes: "Notes",
    workstation_id: "Workstation",
    hourly_rate_enabled: "Machine cost override",
    hourly_rate: "Machine cost / h",
    asset_tag: "Asset tag",
    serial_number: "Serial number",
    manufacturer: "Manufacturer",
    model: "Model",
    commissioned_at: "Commissioned",
    last_calibrated_at: "Last calibrated",
    next_calibration_due_at: "Next calibration due",
    calibration_frequency_months: "Calibration cadence (months)",
    is_active: "Active",
  },
  routing: {
    name: "Name",
    code: "Number",
    notes: "Notes",
    item_id: "Output item",
    bom_id: "Connected BOM",
    is_active: "Active",
    other_fixed_cost: "Other fixed cost",
    other_variable_cost: "Other variable cost",
    other_variable_cost_basis: "Other variable basis",
    steps: "Operations",
  },
  manufacturing_order: {
    warehouse_id: "Site",
    item_id: "Product",
    bom_id: "BOM",
    routing_id: "Routing",
    quantity: "Quantity",
    due_date: "Due date",
    start_at: "Start",
    finish_at: "Finish",
    expiry_date: "Expiry date",
    assigned_to_id: "Assigned to",
    revision: "Revision",
    status: "Status",
    approved_by_id: "Approved by",
    approved_at: "Approved at",
    notes: "Notes",
  },
  manufacturing_order_step: {
    operation_description: "Operation",
    workstation_group_id: "Workstation group",
    setup_time_min: "Setup (min)",
    cycle_time_min: "Cycle (min)",
    capacity: "Capacity",
    fixed_cost: "Fixed cost",
    variable_cost: "Variable cost",
    planned_start: "Planned start",
    planned_finish: "Planned finish",
    actual_start: "Actual start",
    actual_finish: "Actual finish",
    applied_overhead_cost: "Applied overhead",
    labor_cost: "Labor cost",
    quantity: "Quantity",
    notes: "Notes",
  },
  manufacturing_order_booking: {
    stock_lot_id: "Lot",
    storage_cell_id: "Storage",
    item_id: "Stock item",
    quantity: "Booked qty",
    consumed_quantity: "Consumed qty",
    status: "Status",
    note: "Note",
  },
  customer: {
    name: "Name",
    legal_name: "Legal name",
    contact_name: "Contact",
    website: "Website",
    legal_address: "Legal address",
    country_code: "Country",
    registration_number: "Registration #",
    tax_number: "Tax / VAT #",
    currency_code: "Currency",
    tax_rate: "Tax rate",
    payment_terms_days: "Payment terms",
    payment_terms_basis: "Payment basis",
    trade_credit_limit: "Trade credit limit",
    pricelist_id: "Pricelist",
    account_manager_id: "Account manager",
    approval_status: "Approval status",
    approval_notes: "Approval notes",
    is_active: "Active",
  },
  customer_contact: {
    kind: "Kind",
    value: "Value",
    label: "Label",
    is_primary: "Primary",
  },
  customer_file: {
    kind: "Kind",
    filename: "Filename",
  },
  customer_contact_event: {
    kind: "Kind",
    occurred_at: "Occurred at",
    summary: "Summary",
  },
  pricelist: {
    name: "Name",
    currency_code: "Currency",
    is_default: "Default",
    is_active: "Active",
    valid_from: "Valid from",
    valid_until: "Valid until",
    notes: "Notes",
  },
  pricelist_item: {
    item_id: "Item",
    min_quantity: "Min qty",
    selling_price: "Selling price",
    notes: "Notes",
  },
  customer_order: {
    status: "Status",
    customer_id: "Customer",
    currency_code: "Currency",
    subtotal: "Subtotal",
    grand_total: "Grand total",
    expected_ship_date: "Expected ship",
    delivery_address: "Delivery address",
    customer_reference: "Customer ref",
    notes: "Notes",
    default_warehouse_id: "Warehouse",
    cancellation_reason: "Cancellation reason",
  },
  customer_order_line: {
    item_id: "Item",
    qty_ordered: "Qty",
    unit_price: "Unit price",
    discount_pct: "Discount %",
    line_subtotal: "Line subtotal",
    warehouse_id: "Pick warehouse",
  },
  customer_order_approval: {
    kind: "Tier",
    signed_by_id: "Signed by",
  },
  customer_order_file: {
    kind: "Kind",
    filename: "Filename",
  },
  customer_approved_item: {
    item_id: "Item",
    notes: "Notes",
  },
  customer_invoice: {
    status: "Status",
    kind: "Kind",
    customer_id: "Customer",
    customer_order_id: "Source CO",
    currency_code: "Currency",
    subtotal: "Subtotal",
    grand_total: "Grand total",
    invoice_date: "Invoice date",
    due_date: "Due date",
    billing_address: "Billing address",
    customer_reference: "Customer ref",
    free_text: "Free text",
    cancellation_reason: "Cancellation reason",
  },
  customer_invoice_line: {
    item_id: "Item",
    customer_order_line_id: "CO line",
    qty: "Qty",
    unit_price: "Unit price",
    discount_pct: "Discount %",
    line_subtotal: "Line subtotal",
    description: "Description",
  },
  customer_invoice_payment: {
    paid_at: "Paid on",
    amount: "Amount",
    method: "Method",
    reference: "Reference",
    notes: "Notes",
  },
  customer_return: {
    status: "Status",
    customer_id: "Customer",
    customer_invoice_id: "Source invoice",
    return_date: "Return date",
    reason_summary: "Reason summary",
    notes: "Notes",
    rejection_reason: "Rejection reason",
    cancellation_reason: "Cancellation reason",
  },
  customer_return_line: {
    item_id: "Item",
    customer_invoice_line_id: "Invoice line",
    qty_returned: "Qty returned",
    qty_accepted: "Qty accepted",
    reason_code: "Reason",
    reason_notes: "Reason notes",
    unit_price: "Unit price",
    line_credit_amount: "Line credit",
    inspection_notes: "Inspection notes",
  },
  customer_return_file: {
    kind: "Kind",
    filename: "Filename",
  },
  loyalty_program: {
    name: "Name",
    description: "Description",
    scheme: "Scheme",
    basis: "Basis",
    payout_kind: "Payout kind",
    is_active: "Active",
    is_default: "Default program",
    deactivation_reason: "Deactivation reason",
  },
  loyalty_program_tier: {
    rank: "Rank",
    min_threshold: "Threshold",
    rate_pct: "Rate %",
    label: "Label",
  },
  customer_credit: {
    customer_id: "Customer",
    kind: "Kind",
    amount: "Amount",
    currency_code: "Currency",
    reason: "Reason",
    loyalty_program_id: "Loyalty program",
    source_invoice_id: "Source invoice",
  },
  shipment: {
    status: "Status",
    qty: "Qty",
    customer_id: "Customer",
    customer_order_id: "Customer order",
    recipient_name: "Recipient",
    ship_to_address: "Delivery address",
    ship_to_country: "Country",
    carrier: "Carrier",
    vehicle_registration: "Vehicle registration",
    driver_name: "Driver",
    consignment_note_ref: "Waybill / consignment",
    seal_number: "Seal number",
    temperature_c: "Trailer temperature",
    planned_ship_at: "Planned ship time",
    notes: "Notes",
    loading_photo_url: "Loading photo",
    ready_at: "Ready at",
    ready_by_id: "Ready by",
    picked_up_at: "Picked up at",
    picked_up_by_id: "Picked up by",
    cancelled_at: "Cancelled at",
    cancelled_by_id: "Cancelled by",
    cancel_reason: "Cancel reason",
  },
  three_pl_dispatch: {
    status: "Status",
    qty: "Qty",
    reference: "Reference",
    notes: "Notes",
    photo_url: "Evidence photo",
    requested_at: "Requested at",
    requested_by_id: "Requested by",
    dispatched_at: "Completed at",
    dispatched_by_id: "Completed by",
  },
  hr_employee: {
    full_name: "Full name",
    preferred_name: "Preferred name",
    email: "Email",
    phone: "Phone",
    hire_date: "Hire date",
    termination_date: "Termination date",
    external_id: "External ID",
    employee_number: "Employee number",
    is_active: "Active",
    is_qa: "QA sign-off",
  },
  employee_wage: {
    effective_from: "Effective from",
    effective_to: "Effective to",
    hourly_rate: "Hourly rate",
    currency_code: "Currency",
    tax_treatment: "Tax treatment",
    source_kind: "Source",
    reason: "Reason",
  },
  employee_reputation_event: {
    event_type: "Event type",
    score_delta: "Score delta",
    reason: "Reason",
    session_external_id: "Session",
  },
};

export function fieldLabel(entityType: EntityType, field: string): string {
  return (
    FIELD_LABELS[entityType]?.[field] ??
    field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Friendly value rendering. Returns a plain string (no JSX so the
 * caller stays flexible — wrap it however they want).
 *
 *   - null / "" → "—" (em dash, signals "nothing")
 *   - boolean   → "Yes" / "No"
 *   - hourly_wage → "£12.50"
 *   - permissions array → "company.view, users.view, …"
 *   - working_hours / holidays / contacts (objects) → readable summary
 *   - everything else → string form, JSON-encoded for objects
 */
export function formatValue(
  entityType: EntityType,
  field: string,
  value: unknown,
): string {
  if (value === null || value === undefined || value === "") return "—";

  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (field === "hourly_wage") {
    return `£${value}`;
  }

  if (field === "permissions" && Array.isArray(value)) {
    if (value.length === 0) return "none";
    if (value.length <= 4) return value.join(", ");
    return `${value.slice(0, 4).join(", ")} +${value.length - 4} more`;
  }

  if (field === "working_hours" && isPlainObject(value)) {
    const days = Object.keys(value).filter(
      (k) => (value as Record<string, unknown>)[k] != null,
    );
    return days.length === 0 ? "none set" : `${days.length} day${days.length === 1 ? "" : "s"} configured`;
  }

  if (field === "holidays" && isPlainObject(value)) {
    const items = (value as { items?: unknown[] }).items;
    return Array.isArray(items)
      ? `${items.length} holiday${items.length === 1 ? "" : "s"}`
      : "configured";
  }

  if (field === "contacts" && isPlainObject(value)) {
    const items = (value as { items?: unknown[] }).items;
    return Array.isArray(items)
      ? `${items.length} contact${items.length === 1 ? "" : "s"}`
      : "configured";
  }

  // Floor plan blob — summarise instead of dumping the full JSON.
  if (field === "canvas_json" && isPlainObject(value)) {
    const v = value as {
      walls?: unknown[];
      outline?: { points?: unknown[]; holes?: unknown[] };
      texts?: unknown[];
      arrows?: unknown[];
    };
    const parts: string[] = [];
    if (v.outline?.points && Array.isArray(v.outline.points)) {
      parts.push(`outline ${v.outline.points.length} vertex`);
      const holes = v.outline.holes;
      if (Array.isArray(holes) && holes.length > 0) {
        parts.push(`${holes.length} hole${holes.length === 1 ? "" : "s"}`);
      }
    }
    if (Array.isArray(v.walls) && v.walls.length > 0) {
      parts.push(`${v.walls.length} wall${v.walls.length === 1 ? "" : "s"}`);
    }
    if (Array.isArray(v.texts) && v.texts.length > 0) {
      parts.push(`${v.texts.length} text${v.texts.length === 1 ? "" : "s"}`);
    }
    if (Array.isArray(v.arrows) && v.arrows.length > 0) {
      parts.push(`${v.arrows.length} arrow${v.arrows.length === 1 ? "" : "s"}`);
    }
    return parts.length === 0 ? "empty drawing" : parts.join(", ");
  }

  // `#RRGGBB` colour values render with a small inline swatch in the
  // event detail. For the plain-text summary we still return the
  // hex so the user can read it; the row component will detect this
  // and add the swatch.
  if (field === "color" && typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? "empty" : `${value.length} items`;
  }

  if (typeof value === "object") {
    // Last-ditch: stringify. Truncated at the display layer.
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Brief one-line summary of what changed. Used in the collapsed
 * event row. Examples:
 *   - "renamed to Faraday Unit 12"
 *   - "set Active to No"
 *   - "added warehouses.edit to permissions"
 *   - "changed 3 fields"
 *
 * Falls back to the generic "{n} field" form when no single change
 * dominates.
 */
export function summarizeChanges(
  entityType: EntityType,
  event: AuditEvent["event"],
  changes: AuditEvent["changes"],
): string {
  const entries = Object.entries(changes);

  if (event === "created") return "created the record";
  if (event === "deleted") return "deleted the record";
  if (entries.length === 0) return "no changes recorded";

  if (entries.length === 1) {
    const [field, diff] = entries[0]!;
    const label = fieldLabel(entityType, field);
    const newVal = formatValue(entityType, field, diff.new);
    return `set ${label} to ${newVal}`;
  }

  return `changed ${entries.length} field${entries.length === 1 ? "" : "s"}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
