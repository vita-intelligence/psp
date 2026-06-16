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
