// Public surface for the reusable <DataTable>.
//
// Every list page in PSP feeds the same shape: a server-side endpoint
// returning `{items, next_cursor}`, a list of column definitions, and
// callbacks for delete / edit / etc.
//
// The v2 refactor added MRPEasy-style column controls:
//   - Column-header dropdown (Sort ↑ / Sort ↓ / Filter… / Hide)
//   - Per-column filter kinds (text / number-range / date-range / select /
//     boolean) applied via the header dropdown
//   - "Add column" side drawer, grouped by section (Identity, Dates,
//     Amounts, Compliance, Meta, …) so a table can expose every DB
//     column as an opt-in
//   - Optional global toolbar filters (kept from v1 — warehouse /
//     production site / status / etc.)

import type { ReactNode } from "react";

export type SortDirection = "asc" | "desc";

export interface SortSpec {
  field: string;
  direction: SortDirection;
}

/** Per-column filter kinds. The header dropdown renders the matching
 *  input; the value ships to the backend as-is under the column's
 *  filterField key. */
export type ColumnFilterKind =
  | "text"
  | "number-range"
  | "date-range"
  | "select"
  | "multi-select"
  | "boolean";

/** In-flight value for one column filter. Shape depends on the kind:
 *
 *  - text:         { op: "contains" | "eq", value: string }
 *  - number-range: { op: "range", min?: number, max?: number }
 *  - date-range:   { op: "range", from?: string, to?: string }  (ISO date)
 *  - select:       { op: "eq", value: string | number | boolean }
 *  - multi-select: { op: "in", value: Array<string | number> }
 *  - boolean:      { op: "eq", value: boolean }
 *
 *  The controller allow-lists the fields it accepts and routes each op
 *  to the right Ecto clause via Backend.Query. Keep the JSON shape
 *  simple so the URL-encoded form is legible in dev tools.
 */
export type ColumnFilterValue =
  | { op: "contains" | "eq"; value: string }
  | { op: "range"; min?: number; max?: number }
  | { op: "range"; from?: string; to?: string }
  | { op: "eq"; value: string | number | boolean }
  | { op: "in"; value: Array<string | number> };

/** Old-style toolbar filter — one dropdown per key, single value.
 *  Preserved for backward compatibility; new code should prefer the
 *  per-column `filterKind` route. */
export interface FilterValue {
  [field: string]: string | boolean | number;
}

/** New-style structured filter state — the union of per-column filters
 *  and legacy toolbar filters, keyed by backend field name. */
export interface StructuredFilters {
  /** Per-column filters keyed by backend field name. */
  columns?: Record<string, ColumnFilterValue>;
  /** Legacy toolbar filters (single value per field). */
  toolbar?: FilterValue;
}

export interface PageResult<T> {
  items: T[];
  /** `null` when the caller is at the end. */
  next_cursor: string | null;
}

/**
 * A column definition. Keep it dumb — the table component owns the
 * rendering primitives (header sort icon, drag handle, alignment).
 */
export interface DataTableColumn<T> {
  /** Stable id used by drag-reorder + visibility persistence. Doesn't
   *  need to match the field name on the server. */
  id: string;
  /** What the column header reads. */
  header: string;
  /** Cell render — `row` is the raw item. Return ReactNode. */
  cell: (row: T) => ReactNode;
  /** Backend field name for sort. Omit to make the column unsortable. */
  sortField?: string;
  /** Per-direction labels shown in the Sort menu (the non-mobile
   *  alternative to clicking column headers). Defaults to generic
   *  "Ascending / Descending". Tailor it per data type for legibility:
   *    - text:    `{asc: "A → Z", desc: "Z → A"}`
   *    - date:    `{asc: "Oldest first", desc: "Newest first"}`
   *    - boolean: `{asc: "Inactive first", desc: "Active first"}` */
  sortLabels?: { asc: string; desc: string };
  /** Backend field name for filter. Required when `filterKind` is set. */
  filterField?: string;
  /** What input the header dropdown renders when the user hits
   *  "Filter…". Omit to make the column unfilterable. */
  filterKind?: ColumnFilterKind;
  /** Choices for `select` / `multi-select` filters. Ignored otherwise. */
  filterOptions?: Array<{ label: string; value: string | number | boolean }>;
  /** Optional placeholder for `text` / `range` inputs. */
  filterPlaceholder?: string;
  /** Whether the column can be hidden from the column-visibility menu.
   *  Defaults to true. */
  hideable?: boolean;
  /** When `true`, the column starts hidden on first render — the user
   *  has to opt in via the Columns menu to see it. Their choice
   *  persists in localStorage from then on; this default only seeds
   *  the very first visit. Use for audit / debugging columns that
   *  most users don't need by default. */
  defaultHidden?: boolean;
  /** Grouping label in the column-picker drawer. Columns without a
   *  group land in "Other". Recommended groupings:
   *    - "Identity"    — code, name, kind
   *    - "Status"      — lifecycle flags
   *    - "Dates"       — timestamps
   *    - "Amounts"     — money, quantities, percentages
   *    - "Compliance"  — audit / traceability fields
   *    - "Location"    — warehouse, production site, cell
   *    - "Meta"        — created_by, updated_at, etc. */
  group?: string;
  /** Short description shown in the column-picker drawer. */
  description?: string;
  /** Optional alignment for the cell content. */
  align?: "left" | "right" | "center";
  /** Tailwind width hint applied to the header (`w-32`, `min-w-[12rem]`). */
  widthClassName?: string;
  /** Mobile card rendering — what shows on the row body when stacked
   *  on `< md:`. Falls back to `cell` if omitted. */
  mobileCell?: (row: T) => ReactNode;
}

export interface FilterDef {
  /** Backend filter key — sent as `?filter[<field>]=<value>`. */
  field: string;
  /** Display name in the toolbar. */
  label: string;
  /** Available choices. Use `null`/empty for "any". Number values
   *  (e.g. warehouse_id) get stringified for the URL and parsed back
   *  by the controller. */
  options: Array<{ label: string; value: string | number | boolean }>;
}

export interface DataTableProps<T> {
  /** Persistence id — column visibility + column order are stored
   *  under `dataTable.<tableId>` in localStorage. Pick a stable
   *  string per list (`"warehouses"`, `"orders"`, etc). */
  tableId: string;
  columns: DataTableColumn<T>[];
  /** Stable row key — usually `(row) => String(row.id)`. */
  rowKey: (row: T) => string;
  /** Server fetcher — returns one page. The table drives the params.
   *  `columnFilters` carries the new per-column structured filter map;
   *  `filters` keeps the legacy toolbar filter shape for backward
   *  compatibility. Endpoints that opted into v2 read both. */
  fetchPage: (params: {
    cursor: string | null;
    limit: number;
    sort: SortSpec | null;
    filters: FilterValue;
    columnFilters: Record<string, ColumnFilterValue>;
    search: string;
  }) => Promise<PageResult<T>>;
  /** Pre-fetched first page (from a server component). Optional —
   *  saves one round-trip on initial render. */
  initialPage?: PageResult<T>;
  /** Search across the backend-configured search fields. */
  searchPlaceholder?: string;
  /** Optional filter dropdowns shown in the toolbar. */
  filters?: FilterDef[];
  /** Default sort applied on first render. */
  defaultSort?: SortSpec;
  /** Row click handler — typically navigates to the resource detail. */
  onRowClick?: (row: T) => void;
  /** Override the per-page limit (server clamps to its own max). */
  pageSize?: number;
  /** Empty-state when no rows AND no active search/filter. */
  emptyState?: ReactNode;
  /** Slot for the toolbar's right side — primary action like "New". */
  toolbarActions?: ReactNode;
  /** Optional slot rendered above the table (banners, alerts). */
  beforeTable?: ReactNode;
  /** Custom renderer for the narrow-container (card) layout. When the
   *  table is wrapped in a parent narrower than ~640px it switches
   *  away from the desktop table. By default columns render as
   *  `LABEL — value` rows; supply this for a hand-crafted card. */
  renderMobileCard?: (row: T) => ReactNode;
  /** Kebab-case entity name matching `Backend.Broadcasts.entity_changed/4`.
   *  When set, the table subscribes to `entity:<name>:<company_id>`
   *  and re-fetches whenever a peer creates / updates / deletes /
   *  transitions a row on this entity within the tenant. Debounced
   *  server-side by nothing and client-side by ~250 ms so a burst
   *  of writes collapses to a single refresh. Leave undefined to
   *  keep the old snapshot-on-load behaviour. */
  realtimeEntity?: string;
}

export interface PersistedTableState {
  /** Column ids in display order. May omit ids that haven't been
   *  manually positioned yet — those land at their default index. */
  columnOrder?: string[];
  /** Column ids that are hidden. */
  hiddenColumns?: string[];
  /** Per-column filters — persist so a user's saved view survives
   *  reloads. Cleared via the "Reset filters" chip. */
  columnFilters?: Record<string, ColumnFilterValue>;
}
