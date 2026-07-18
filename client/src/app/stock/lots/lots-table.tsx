"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Filter, FilePlus, Printer, X } from "lucide-react";
import { PrintLabelDialog } from "./print-label-dialog";
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
import { Button } from "@/components/ui/button";
import { auditColumns } from "@/components/audit/audit-table-columns";
import type { StockLot, StockLotStatus } from "@/lib/types";
import {
  formatCompanyDate,
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

interface LotsTableProps {
  initialPage: PageResult<StockLot>;
  /** Location filters built server-side via `buildLocationFilters()`. */
  locationFilters?: FilterDef[];
  canReceive: boolean;
  /** Server-resolved deep-link filter from `?item_id=<n>`. The lot
   *  list scopes to this item until the user clears the chip. */
  itemFilter: {
    id: number;
    name: string | null;
    code: string | null;
  } | null;
}

const DEFAULT_SORT: SortSpec = { field: "id", direction: "desc" };

// Status → badge tone. We bias toward emerald (the happy path) for
// `available`, amber for transitional states, muted for terminal.
// The two pre-arrival statuses are visually distinct: `requested`
// (paperwork-only, no vendor commitment yet) reads as a muted gray;
// `expected` (PO ordered + paid, actual commitment) reads as indigo
// so planners can see the difference at a glance in the lot list.
const STATUS_TONE: Record<
  StockLotStatus,
  "emerald" | "amber" | "muted" | "destructive" | "indigo" | "sky"
> = {
  expected: "indigo",
  requested: "muted",
  received: "sky",
  quarantine: "amber",
  awaiting_release: "amber",
  available: "emerald",
  on_hold: "amber",
  depleted: "muted",
  disposed: "muted",
  rejected: "destructive",
  canceled: "muted",
};

const STATUS_LABEL: Record<StockLotStatus, string> = {
  expected: "Expected",
  requested: "Requested",
  received: "Received",
  quarantine: "Quarantine",
  awaiting_release: "Awaiting release",
  available: "Available",
  on_hold: "On hold",
  depleted: "Depleted",
  disposed: "Disposed",
  rejected: "Rejected",
  canceled: "Canceled",
};

const STATUS_OPTIONS = (
  [
    "expected",
    "requested",
    "received",
    "quarantine",
    "awaiting_release",
    "available",
    "on_hold",
    "depleted",
    "disposed",
    "rejected",
    "canceled",
  ] as StockLotStatus[]
).map((s) => ({ label: STATUS_LABEL[s], value: s }));

const STATUS_FILTER: FilterDef = {
  field: "status",
  label: "Status",
  options: STATUS_OPTIONS,
};

const SOURCE_KIND_OPTIONS = [
  { label: "Purchase order", value: "purchase_order" },
  { label: "Manufacturing order", value: "manufacturing_order" },
  { label: "Opening balance", value: "opening_balance" },
  { label: "Return", value: "return" },
  { label: "Adjustment", value: "adjustment" },
  { label: "Manual", value: "manual" },
];

const COMPLIANCE_STATE_OPTIONS = [
  { label: "Pending", value: "pending" },
  { label: "Requested", value: "requested" },
  { label: "Received", value: "received" },
  { label: "Accepted", value: "accepted" },
  { label: "Rejected", value: "rejected" },
  { label: "N/A", value: "na" },
];

function makeFetchLotsPage(itemFilterId: number | null) {
  return async function fetchLotsPage(params: {
    cursor: string | null;
    limit: number;
    sort: SortSpec | null;
    filters: Record<string, string | boolean | number>;
    columnFilters: Record<string, ColumnFilterValue>;
    search: string;
  }): Promise<PageResult<StockLot>> {
    const qs = new URLSearchParams();
    qs.set("limit", String(params.limit));
    if (params.cursor) qs.set("cursor", params.cursor);
    if (params.sort)
      qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
    if (params.search) qs.set("search", params.search);
    for (const [k, v] of Object.entries(params.filters)) {
      qs.set(k, String(v));
    }
    serializeColumnFilters(qs, params.columnFilters);
    // Deep-link filter is server-pinned — it stays applied on every
    // paginated fetch until the user clears the chip in the banner.
    if (itemFilterId !== null) {
      qs.set("item_id", String(itemFilterId));
    }

    const res = await fetch(`/api/stock/lots?${qs.toString()}`, {
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
    return (await res.json()) as PageResult<StockLot>;
  };
}

export function LotsTable({
  initialPage,
  locationFilters,
  canReceive,
  itemFilter,
}: LotsTableProps) {
  const router = useRouter();
  const prefs = useFormatPrefs();
  const [printLot, setPrintLot] = useState<StockLot | null>(null);

  // Memo the fetcher so its identity is stable across re-renders for
  // the same itemFilterId — otherwise the DataTable's query key
  // changes every render and refetches in a loop.
  const fetchLotsPage = useMemo(
    () => makeFetchLotsPage(itemFilter?.id ?? null),
    [itemFilter?.id],
  );

  const filters = useMemo<FilterDef[]>(
    () => [STATUS_FILTER, ...(locationFilters ?? [])],
    [locationFilters],
  );

  const formatQty = (qty: string | null | undefined, symbol?: string | null) => {
    const formatted = formatCompanyNumber(qty, prefs);
    if (formatted === "—") return formatted;
    return symbol ? `${formatted} ${symbol}` : formatted;
  };
  const formatMoney = (value: string | null, currency: string | null) =>
    formatCompanyMoney(value, prefs, { currency_code: currency });
  const formatDate = (value: string | null) => formatCompanyDate(value, prefs);

  const columns = useMemo<DataTableColumn<StockLot>[]>(
    () => [
      {
        id: "code",
        header: "Lot",
        sortField: "id",
        sortLabels: { asc: "Oldest first", desc: "Newest first" },
        widthClassName: "w-28",
        hideable: false,
        filterField: "code",
        filterKind: "text",
        filterPlaceholder: "L00001…",
        group: "Identity",
        description: "Auto-numbered lot code (L00001, …).",
        cell: (l) => (
          <span className="font-mono text-xs font-semibold">
            {l.code ?? `#${l.id}`}
          </span>
        ),
      },
      {
        id: "item",
        header: "Item",
        widthClassName: "min-w-[16rem]",
        filterField: "item_name",
        filterKind: "text",
        filterPlaceholder: "Item name or SKU…",
        group: "Identity",
        description: "Item this lot belongs to. Filter by item name or SKU.",
        cell: (l) =>
          l.item ? (
            <Link
              href={`/production/items/${l.item.uuid}`}
              onClick={(e) => e.stopPropagation()}
              className="block space-y-0.5 group"
            >
              <p className="truncate font-medium underline-offset-2 group-hover:underline">
                {l.item.name}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {l.item.code ?? l.item.external_sku ?? "—"}
              </p>
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "status",
        header: "Status",
        sortField: "status",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-32",
        filterField: "status",
        filterKind: "select",
        filterOptions: STATUS_OPTIONS,
        group: "Status",
        description: "Lot lifecycle — computed from events, never picked directly.",
        cell: (l) => (
          <Badge tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</Badge>
        ),
      },
      {
        id: "qty_received",
        header: "Starting qty",
        sortField: "qty_received",
        sortLabels: { asc: "Smallest first", desc: "Largest first" },
        widthClassName: "w-28",
        align: "right",
        filterField: "qty_received",
        filterKind: "number-range",
        group: "Amounts",
        description: "Quantity when the lot was received (immutable).",
        cell: (l) => (
          <span className="font-mono text-xs">
            {formatQty(l.qty_received, l.unit_of_measurement?.symbol)}
          </span>
        ),
      },
      {
        id: "qty_on_hand",
        header: "On hand",
        widthClassName: "w-28",
        align: "right",
        group: "Amounts",
        description: "Current on-hand quantity across all placements.",
        cell: (l) => (
          <span className="font-mono text-xs">
            {formatQty(l.qty_on_hand, l.unit_of_measurement?.symbol)}
          </span>
        ),
      },
      {
        id: "unit_cost",
        header: "Unit cost",
        sortField: "unit_cost",
        sortLabels: { asc: "Cheapest first", desc: "Priciest first" },
        widthClassName: "w-28",
        align: "right",
        filterField: "unit_cost",
        filterKind: "number-range",
        group: "Amounts",
        description: "Per-unit landed cost — carried through consumption events.",
        cell: (l) => (
          <span className="font-mono text-xs text-muted-foreground">
            {formatMoney(l.unit_cost, l.currency)}
          </span>
        ),
      },
      {
        id: "supplier_batch_no",
        header: "Supplier batch",
        sortField: "supplier_batch_no",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-36",
        filterField: "supplier_batch_no",
        filterKind: "text",
        filterPlaceholder: "Batch no.…",
        group: "Compliance",
        description: "Vendor-assigned batch/lot number for traceability.",
        cell: (l) =>
          l.supplier_batch_no ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {l.supplier_batch_no}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "expiry_at",
        header: "Expires",
        sortField: "expiry_at",
        sortLabels: { asc: "Soonest first", desc: "Latest first" },
        widthClassName: "w-28",
        filterField: "expiry_at",
        filterKind: "date-range",
        group: "Dates",
        description: "Best-before / use-by date.",
        cell: (l) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(l.expiry_at)}
          </span>
        ),
      },
      {
        id: "received_at",
        header: "Received",
        sortField: "received_at",
        sortLabels: { asc: "Oldest first", desc: "Newest first" },
        widthClassName: "w-28",
        defaultHidden: true,
        filterField: "received_at",
        filterKind: "date-range",
        group: "Dates",
        description: "When the physical goods landed.",
        cell: (l) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(l.received_at)}
          </span>
        ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "currency",
        header: "Currency",
        widthClassName: "w-20",
        defaultHidden: true,
        filterField: "currency",
        filterKind: "text",
        filterPlaceholder: "GBP…",
        group: "Amounts",
        description: "Currency of the unit cost.",
        cell: (l) =>
          l.currency ? (
            <span className="font-mono text-xs">{l.currency}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "manufactured_at",
        header: "Manufactured",
        widthClassName: "w-28",
        defaultHidden: true,
        filterField: "manufactured_at",
        filterKind: "date-range",
        group: "Dates",
        description: "When the batch was produced at the supplier.",
        cell: (l) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(l.manufactured_at)}
          </span>
        ),
      },
      {
        id: "country_of_origin",
        header: "Origin",
        widthClassName: "w-28",
        defaultHidden: true,
        filterField: "country_of_origin",
        filterKind: "text",
        filterPlaceholder: "Country of origin…",
        group: "Compliance",
        description: "Country of origin declared on the paperwork.",
        cell: (l) =>
          l.country_of_origin ? (
            <span className="text-xs">{l.country_of_origin}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "source_kind",
        header: "Source",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "source_kind",
        filterKind: "select",
        filterOptions: SOURCE_KIND_OPTIONS,
        group: "Compliance",
        description: "Where this lot came from — derived from the flow that created it.",
        cell: (l) =>
          l.source_kind ? (
            <span className="text-xs capitalize">
              {l.source_kind.replace(/_/g, " ")}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "warehouse",
        header: "Warehouse",
        widthClassName: "min-w-[10rem]",
        defaultHidden: true,
        group: "Location",
        description: "Warehouse currently holding this lot's primary placement.",
        cell: (l) => {
          const wh = l.placements?.[0]?.storage_cell?.warehouse ?? null;
          return wh ? (
            <Link
              href={`/settings/warehouses/${wh.uuid}`}
              onClick={(e) => e.stopPropagation()}
              className="truncate text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {wh.name}
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          );
        },
      },
      {
        id: "cell",
        header: "Cell",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Location",
        description: "Storage cell code of the primary placement.",
        cell: (l) => {
          const cell = l.placements?.[0]?.storage_cell ?? null;
          return cell?.code ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {cell.code}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          );
        },
      },
      {
        id: "allergen_status",
        header: "Allergens",
        widthClassName: "w-28",
        defaultHidden: true,
        filterField: "allergen_status",
        filterKind: "select",
        filterOptions: COMPLIANCE_STATE_OPTIONS,
        group: "Compliance",
        description: "Allergen declaration state.",
        cell: (l) =>
          l.allergen_status ? (
            <span className="text-xs capitalize">{l.allergen_status}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "coa_status",
        header: "CoA",
        widthClassName: "w-24",
        defaultHidden: true,
        filterField: "coa_status",
        filterKind: "select",
        filterOptions: COMPLIANCE_STATE_OPTIONS,
        group: "Compliance",
        description: "Certificate of Analysis state.",
        cell: (l) =>
          l.coa_status ? (
            <span className="text-xs capitalize">{l.coa_status}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "print",
        header: "",
        widthClassName: "w-12",
        hideable: false,
        align: "right",
        // Opens the "how many labels?" modal — MRPEasy parity. The
        // modal then opens the PDF endpoint in a new tab so the
        // browser's PDF viewer handles the preview + print dialog.
        //
        // Rendered as `<span role="button">` rather than `<button>`
        // because the DataTable's mobile card layout wraps the whole
        // row in a `<button>`, and nesting buttons is invalid HTML
        // (hydration error). `onPointerDown` triggers the action and
        // stops propagation so the outer row-click never fires.
        cell: (l) => (
          <span
            role="button"
            tabIndex={0}
            onPointerDown={(e) => {
              e.stopPropagation();
              setPrintLot(l);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setPrintLot(l);
              }
            }}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Print label for ${l.code ?? l.id}`}
            title="Print label"
          >
            <Printer className="size-3.5" />
          </span>
        ),
      },
      ...auditColumns<StockLot>(),
    ],
    // Recompute when prefs change so date/qty/money cells re-render
    // against the latest company settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefs.date_format, prefs.decimal_separator, prefs.thousands_separator, prefs.currency_code, prefs.currency_format],
  );

  return (
    <>
      <DataTable
        tableId="stock-lots"
        realtimeEntity="stock-lot"
        columns={columns}
        rowKey={(l) => String(l.id)}
        fetchPage={fetchLotsPage}
        initialPage={initialPage}
        searchPlaceholder="Search supplier batch, source ref, notes…"
        filters={filters}
        defaultSort={DEFAULT_SORT}
        onRowClick={(l) => router.push(`/stock/lots/${l.uuid}`)}
        beforeTable={
          itemFilter ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-brand/40 bg-brand/5 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <Filter className="size-3.5 text-brand" />
                <span className="text-muted-foreground">
                  Filtered to item
                </span>
                <span className="font-medium">
                  {itemFilter.name ?? `#${itemFilter.id}`}
                </span>
                {itemFilter.code && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {itemFilter.code}
                  </span>
                )}
              </div>
              <Link
                href="/stock/lots"
                className="inline-flex items-center gap-1 text-brand hover:underline"
              >
                <X className="size-3" />
                Clear
              </Link>
            </div>
          ) : undefined
        }
        toolbarActions={
          canReceive ? (
            <Button asChild size="sm">
              <Link href="/stock/lots/new">
                <FilePlus className="mr-1.5 size-4" />
                Add manual lot
              </Link>
            </Button>
          ) : undefined
        }
        emptyState={
          <div className="space-y-1">
            <p className="text-sm font-medium">No stock lots yet</p>
            <p className="text-xs text-muted-foreground">
              Add a manual lot for opening balances or adjustments. Real
              receives will arrive here automatically from the Procurement
              module once it ships.
            </p>
          </div>
        }
      />

      <PrintLabelDialog
        lot={printLot}
        open={printLot !== null}
        onOpenChange={(open) => !open && setPrintLot(null)}
      />
    </>
  );
}
