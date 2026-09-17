"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Ban,
  MoveHorizontal,
  Package,
  Recycle,
  ShoppingBag,
  Sparkles,
  Truck,
} from "lucide-react";
import { DataTable } from "@/components/data-table";
import type {
  ColumnFilterValue,
  DataTableColumn,
  FilterDef,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { serializeColumnFilters } from "@/lib/data-table/serialize";
import { Badge } from "@/components/ui/badge-mini";
import { auditColumns } from "@/components/audit/audit-table-columns";
import type { StockMovementRow } from "@/lib/stock/server";
import type { StockMovementReasonCategory } from "@/lib/types";
import { STOCK_MOVEMENT_REASON_CATEGORY_LABEL } from "@/lib/types";
import { formatCompanyDate, formatCompanyNumber } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

interface MovementsTableProps {
  initialPage: PageResult<StockMovementRow>;
  locationFilters?: FilterDef[];
}

const DEFAULT_SORT: SortSpec = { field: "occurred_at", direction: "desc" };

// Kind → chip tone + label + icon. Colour-coded so the operator can
// scan the timeline for green (inbound / positive) vs red (outbound
// / write-off) vs neutral (move / auto-route) at a glance.
type Tone = "emerald" | "sky" | "amber" | "destructive" | "muted" | "brand";

const KIND_META: Record<
  string,
  { label: string; tone: Tone; Icon: typeof ArrowUpRight }
> = {
  receive: { label: "Receive", tone: "emerald", Icon: ArrowDownRight },
  move: { label: "Move", tone: "muted", Icon: MoveHorizontal },
  consume: { label: "Consume", tone: "brand", Icon: Package },
  adjust_up: { label: "Adjust up", tone: "emerald", Icon: ArrowUpRight },
  adjust_down: { label: "Adjust down", tone: "amber", Icon: ArrowDownRight },
  dispose: { label: "Dispose", tone: "destructive", Icon: Ban },
  return: { label: "Return", tone: "sky", Icon: Recycle },
  auto_route: { label: "Auto-route", tone: "muted", Icon: Sparkles },
  issue: { label: "Issue", tone: "brand", Icon: ShoppingBag },
  ship_out: { label: "Ship out", tone: "sky", Icon: Truck },
};

const KIND_OPTIONS = Object.entries(KIND_META).map(([value, meta]) => ({
  label: meta.label,
  value,
}));

const REASON_CATEGORY_OPTIONS = (
  [
    "damage",
    "expiry",
    "qc_fail",
    "stock_take_variance",
    "theft_loss",
    "sample_pull",
    "physical_move",
    "customer_return",
    "admin_correction",
    "other",
  ] as StockMovementReasonCategory[]
).map((v) => ({
  label: STOCK_MOVEMENT_REASON_CATEGORY_LABEL[v],
  value: v,
}));

/**
 * Fetches one page of movements from the backend. Both the toolbar
 * `filters` and the per-column `columnFilters` come through — we
 * route the single-select toolbar values (kind, reason_category,
 * warehouse) into query params the BE recognises, plus the
 * column-level date range + free text. Kinds + categories are sent
 * as CSVs so the same endpoint accepts multi-select expansion later
 * without a shape change.
 */
async function fetchMovementsPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<StockMovementRow>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);

  // Toolbar filters — currently just the compound location filter
  // (warehouse). Kind + reason_category moved to per-column filters
  // and ride through `column_filter[...]` via serializeColumnFilters.
  for (const [k, v] of Object.entries(params.filters)) {
    if (v === "" || v === null || v === undefined) continue;
    qs.set(k, String(v));
  }

  // Column filters — date-range on `occurred_at` becomes from_at/to_at.
  const occurredFilter = params.columnFilters["occurred_at"];
  if (
    occurredFilter &&
    occurredFilter.op === "range" &&
    "from" in occurredFilter &&
    (occurredFilter.from || occurredFilter.to)
  ) {
    if (occurredFilter.from)
      qs.set("from_at", `${occurredFilter.from}T00:00:00Z`);
    if (occurredFilter.to)
      qs.set("to_at", `${occurredFilter.to}T23:59:59Z`);
  }
  // Other column filters serialize into the ?column_filter[...] shape,
  // but our BE doesn't consume that on this endpoint yet — pass them
  // anyway so future filter columns can plug in without a schema
  // change on the FE.
  serializeColumnFilters(qs, params.columnFilters);

  const res = await fetch(`/api/stock/movements?${qs.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      /* leave detail */
    }
    throw new Error(detail);
  }
  return (await res.json()) as PageResult<StockMovementRow>;
}

export function MovementsTable({
  initialPage,
  locationFilters,
}: MovementsTableProps) {
  const prefs = useFormatPrefs();

  // Kind + reason_category live as per-column filters now (see the
  // column defs below), so the toolbar only carries the compound
  // location filter — no visible column corresponds to it.
  const filters = useMemo<FilterDef[]>(
    () => [...(locationFilters ?? [])],
    [locationFilters],
  );

  const columns = useMemo<DataTableColumn<StockMovementRow>[]>(
    () => [
      {
        id: "occurred_at",
        header: "When",
        sortField: "occurred_at",
        sortLabels: { asc: "Oldest first", desc: "Newest first" },
        widthClassName: "w-40",
        hideable: false,
        filterField: "occurred_at",
        filterKind: "date-range",
        group: "Time",
        description: "When the movement was recorded.",
        cell: (m) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(m.occurred_at, prefs)}
            <span className="ml-1 text-[10px] opacity-70">
              {new Date(m.occurred_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </span>
        ),
      },
      {
        id: "kind",
        header: "Kind",
        widthClassName: "w-32",
        hideable: false,
        filterField: "kind",
        filterKind: "select",
        filterOptions: KIND_OPTIONS,
        group: "What",
        description: "The kind of movement — receive / move / adjust / …",
        cell: (m) => {
          const meta = KIND_META[m.kind] ?? {
            label: m.kind,
            tone: "muted" as const,
            Icon: ArrowLeftRight,
          };
          const Icon = meta.Icon;
          return (
            <Badge tone={meta.tone}>
              <Icon className="mr-1 size-3" />
              {meta.label}
            </Badge>
          );
        },
      },
      {
        id: "reason_category",
        header: "Reason",
        widthClassName: "w-40",
        filterField: "reason_category",
        filterKind: "select",
        filterOptions: REASON_CATEGORY_OPTIONS,
        group: "What",
        description:
          "Closed-enum classification of the reason. Powers the waste-log report.",
        cell: (m) =>
          m.reason_category ? (
            <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {STOCK_MOVEMENT_REASON_CATEGORY_LABEL[m.reason_category] ??
                m.reason_category}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "delta_qty",
        header: "Δ Qty",
        sortField: "delta_qty",
        sortLabels: { asc: "Smallest first", desc: "Largest first" },
        widthClassName: "w-24",
        align: "right",
        filterField: "delta_qty",
        filterKind: "number-range",
        group: "Amounts",
        description: "Signed qty change. Positive = inbound, negative = draw.",
        cell: (m) => {
          const num = Number(m.delta_qty);
          const positive = num > 0;
          const sign = positive ? "+" : "";
          return (
            <span
              className={`font-mono text-xs font-semibold tabular-nums ${
                positive
                  ? "text-emerald-600 dark:text-emerald-500"
                  : num < 0
                    ? "text-rose-600 dark:text-rose-500"
                    : "text-muted-foreground"
              }`}
            >
              {sign}
              {formatCompanyNumber(m.delta_qty, prefs)}{" "}
              {m.unit_of_measurement?.symbol ?? ""}
            </span>
          );
        },
      },
      {
        id: "item",
        header: "Item",
        widthClassName: "min-w-[14rem]",
        filterField: "item_name",
        filterKind: "text",
        filterPlaceholder: "Item name or SKU…",
        group: "Identity",
        description: "The item this lot represents.",
        cell: (m) =>
          m.item ? (
            <Link
              href={`/production/items/${m.item.uuid}`}
              onClick={(e) => e.stopPropagation()}
              className="block space-y-0.5 group"
            >
              <p className="truncate text-sm font-medium underline-offset-2 group-hover:underline">
                {m.item.name}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {m.item.code ?? m.item.external_sku ?? "—"}
              </p>
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "lot",
        header: "Lot",
        widthClassName: "w-28",
        filterField: "lot_code",
        filterKind: "text",
        filterPlaceholder: "L00001 or supplier batch…",
        group: "Identity",
        description: "The stock lot the movement affected.",
        cell: (m) =>
          m.stock_lot ? (
            <Link
              href={`/stock/lots/${m.stock_lot.uuid}`}
              onClick={(e) => e.stopPropagation()}
              className="block space-y-0.5 group"
            >
              <p className="font-mono text-xs font-semibold underline-offset-2 group-hover:underline">
                {m.stock_lot.code ?? `#${m.stock_lot.id}`}
              </p>
              {m.stock_lot.supplier_batch_no && (
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {m.stock_lot.supplier_batch_no}
                </p>
              )}
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "path",
        header: "From → To",
        widthClassName: "min-w-[14rem]",
        group: "Location",
        description: "Source and destination cells (where applicable).",
        cell: (m) => (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="truncate">
              {cellBreadcrumb(m.from_cell) ?? "—"}
            </span>
            <ArrowLeftRight className="size-3 shrink-0 opacity-50" />
            <span className="truncate">
              {cellBreadcrumb(m.to_cell) ?? "—"}
            </span>
          </div>
        ),
      },
      {
        id: "reason",
        header: "Notes",
        widthClassName: "min-w-[16rem]",
        filterField: "reason",
        filterKind: "text",
        filterPlaceholder: "Search notes…",
        group: "What",
        description: "Free-text explanation captured by the operator.",
        cell: (m) =>
          m.reason ? (
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {m.reason}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "reference",
        header: "Reference",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "reference_ref",
        filterKind: "text",
        filterPlaceholder: "MO00042 / PO00017…",
        group: "Identity",
        description: "Linked source doc (MO / PO / etc.) when applicable.",
        cell: (m) =>
          m.reference_ref ? (
            <span className="text-[11px] text-muted-foreground">
              <span className="uppercase tracking-wide">
                {(m.reference_kind ?? "").replace(/_/g, " ")}
              </span>
              <br />
              <span className="font-mono">{m.reference_ref}</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "actor",
        header: "Actor",
        widthClassName: "w-40",
        filterField: "actor_name",
        filterKind: "text",
        filterPlaceholder: "Name or email…",
        group: "Meta",
        description: "The user who recorded the movement.",
        cell: (m) =>
          m.actor ? (
            <span className="text-xs">
              {m.actor.name ?? m.actor.email ?? "—"}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">system</span>
          ),
      },
      // Audit metadata columns (defaultHidden). Movements are append-
      // only so `updated_at` is really just `inserted_at`; keep both
      // for compatibility with the shared helper.
      ...auditColumns<StockMovementRow>(),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      prefs.date_format,
      prefs.decimal_separator,
      prefs.thousands_separator,
    ],
  );

  return (
    <DataTable
      tableId="stock-movements"
      realtimeEntity="stock-lot"
      columns={columns}
      rowKey={(m) => String(m.id)}
      fetchPage={fetchMovementsPage}
      initialPage={initialPage}
      searchPlaceholder="Search notes, reference, batch…"
      filters={filters}
      defaultSort={DEFAULT_SORT}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No movements recorded yet</p>
          <p className="text-xs text-muted-foreground">
            Every receive / move / adjust / dispose lands here.
          </p>
        </div>
      }
    />
  );
}

function cellBreadcrumb(
  cell: StockMovementRow["from_cell"] | StockMovementRow["to_cell"],
): string | null {
  if (!cell) return null;
  const parts: string[] = [];
  if (cell.warehouse?.name) parts.push(cell.warehouse.name);
  if (cell.floor?.name) parts.push(cell.floor.name);
  if (cell.storage_location?.name) parts.push(cell.storage_location.name);
  parts.push(cell.name ?? cell.code ?? `#${cell.id}`);
  return parts.join(" › ");
}
