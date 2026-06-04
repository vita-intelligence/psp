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
