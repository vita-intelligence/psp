// Public surface for the reusable <DataTable>.
//
// Every list page in PSP feeds the same shape: a server-side endpoint
// returning `{items, next_cursor}`, a list of column definitions, and
// callbacks for delete / edit / etc.

import type { ReactNode } from "react";

export type SortDirection = "asc" | "desc";

export interface SortSpec {
  field: string;
  direction: SortDirection;
}

export interface FilterValue {
  [field: string]: string | boolean | number;
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
  /** Whether the column can be hidden from the column-visibility menu.
   *  Defaults to true. */
  hideable?: boolean;
  /** When `true`, the column starts hidden on first render — the user
   *  has to opt in via the Columns menu to see it. Their choice
   *  persists in localStorage from then on; this default only seeds
   *  the very first visit. Use for audit / debugging columns that
   *  most users don't need by default. */
  defaultHidden?: boolean;
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
  /** Available choices. Use `null`/empty for "any". */
  options: Array<{ label: string; value: string | boolean }>;
}

export interface DataTableProps<T> {
  /** Persistence id — column visibility + column order are stored
   *  under `dataTable.<tableId>` in localStorage. Pick a stable
   *  string per list (`"warehouses"`, `"orders"`, etc). */
  tableId: string;
  columns: DataTableColumn<T>[];
  /** Stable row key — usually `(row) => String(row.id)`. */
  rowKey: (row: T) => string;
  /** Server fetcher — returns one page. The table drives the params. */
  fetchPage: (params: {
    cursor: string | null;
    limit: number;
    sort: SortSpec | null;
    filters: FilterValue;
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
}

export interface PersistedTableState {
  /** Column ids in display order. May omit ids that haven't been
   *  manually positioned yet — those land at their default index. */
  columnOrder?: string[];
  /** Column ids that are hidden. */
  hiddenColumns?: string[];
}
