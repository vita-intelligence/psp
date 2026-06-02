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
