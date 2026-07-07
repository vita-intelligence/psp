"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { AlertTriangle, Package2 } from "lucide-react";
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
import type { InventoryRow, ItemType, Warehouse } from "@/lib/types";
import {
  formatCompanyDate,
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

interface InventoryTableProps {
  initialPage: PageResult<InventoryRow>;
  warehouses: Warehouse[];
  /** Location filters built server-side via `buildLocationFilters()`.
   *  When present, takes precedence over the legacy `warehouses` prop. */
  locationFilters?: FilterDef[];
}

const DEFAULT_SORT: SortSpec = { field: "name", direction: "asc" };

const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  raw_material: "Raw material",
  semi_finished: "Semi-finished",
  finished_product: "Finished",
  packaging: "Packaging",
  consumable: "Consumable",
};

const ITEM_TYPE_TONE: Record<
  ItemType,
  "indigo" | "emerald" | "amber" | "muted" | "sky"
> = {
  raw_material: "indigo",
  semi_finished: "amber",
  finished_product: "emerald",
  packaging: "muted",
  consumable: "sky",
};

const ITEM_TYPE_FILTER: FilterDef = {
  field: "item_type",
  label: "Type",
  options: (
    [
      "raw_material",
      "semi_finished",
      "finished_product",
      "packaging",
      "consumable",
    ] as ItemType[]
  ).map((t) => ({ label: ITEM_TYPE_LABEL[t], value: t })),
};

const IN_STOCK_FILTER: FilterDef = {
  field: "in_stock_only",
  label: "Stock",
  options: [
    { label: "In stock only", value: true },
    { label: "Include zero", value: false },
  ],
};

async function fetchInventoryPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<InventoryRow>> {
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

  const res = await fetch(`/api/stock/inventory?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<InventoryRow>;
}

export function InventoryTable({
  initialPage,
  warehouses,
  locationFilters,
}: InventoryTableProps) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  // Dynamic warehouse filter built once per render — useMemo to keep
  // the array identity stable for DataTable.
  const filters = useMemo<FilterDef[]>(() => {
    const out: FilterDef[] = [ITEM_TYPE_FILTER, IN_STOCK_FILTER];
    if (locationFilters && locationFilters.length > 0) {
      return [...out, ...locationFilters];
    }
    if (warehouses.length > 0) {
      out.push({
        field: "warehouse_id",
        label: "Warehouse",
        options: warehouses.map((w) => ({ label: w.name, value: w.id })),
      });
    }
    return out;
  }, [warehouses, locationFilters]);

  // Days-to-expiry threshold for the soon-to-expire badge. 30 days is
  // a defensible default for supplements; finer-grained policy lives
  // on the item itself (shelf-life column) — we just colour the
  // earliest lot here.
  const todayMs = useMemo(() => Date.now(), []);

  const columns = useMemo<DataTableColumn<InventoryRow>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        sortField: "code",
        sortLabels: { asc: "Code A→Z", desc: "Code Z→A" },
        widthClassName: "w-28",
        group: "Identity",
        description: "Auto-numbered item code.",
        cell: (r) => (
          <span className="font-mono text-xs text-muted-foreground">
            {r.item_code ?? `#${r.item_id}`}
          </span>
        ),
      },
      {
        id: "name",
        header: "Item",
        sortField: "name",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        hideable: false,
        widthClassName: "min-w-[16rem]",
        filterField: "name",
        filterKind: "text",
        filterPlaceholder: "Item name…",
        group: "Identity",
        description: "Item name + type + external SKU when set. Filter by name.",
        cell: (r) => (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{r.item_name}</span>
              <Badge tone={ITEM_TYPE_TONE[r.item_type]}>
                {ITEM_TYPE_LABEL[r.item_type]}
              </Badge>
            </div>
            {r.item_external_sku && (
              <p className="truncate text-[11px] text-muted-foreground">
                {r.item_external_sku}
              </p>
            )}
          </div>
        ),
      },
      {
        id: "qty_on_hand",
        header: "On hand",
        sortField: "qty_on_hand",
        sortLabels: { asc: "Low → high", desc: "High → low" },
        align: "right",
        widthClassName: "w-32",
        group: "Amounts",
        description: "Sum of placement qty across every non-zero cell.",
        cell: (r) => {
          const value = formatCompanyNumber(r.qty_on_hand, prefs);
          const isZero = Number(r.qty_on_hand) === 0;
          return (
            <span
              className={
                isZero ? "font-mono text-sm text-muted-foreground/60" : "font-mono text-sm font-semibold"
              }
            >
              {value}
            </span>
          );
        },
      },
      {
        id: "total_cost",
        header: "Cost value",
        sortField: "total_cost",
        sortLabels: { asc: "Cheapest first", desc: "Most expensive first" },
        align: "right",
        widthClassName: "w-32",
        group: "Amounts",
        description: "Naive sum of placement.qty × lot.unit_cost.",
        cell: (r) => {
          const formatted = formatCompanyMoney(r.total_cost, prefs, {
            currency_code: prefs.currency_code ?? "GBP",
          });
          const isZero = Number(r.total_cost) === 0;
          return (
            <span
              className={
                isZero
                  ? "font-mono text-sm text-muted-foreground/60"
                  : "font-mono text-sm"
              }
            >
              {formatted}
            </span>
          );
        },
      },
      {
        id: "lots_count",
        header: "Lots",
        sortField: "lots_count",
        sortLabels: { asc: "Few → many", desc: "Many → few" },
        align: "right",
        widthClassName: "w-20",
        group: "Amounts",
        description: "Number of distinct lots contributing to this item's on-hand qty.",
        cell: (r) =>
          r.lots_count > 0 ? (
            <span className="text-sm">{r.lots_count}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "earliest_expiry",
        header: "Earliest expiry",
        sortField: "earliest_expiry",
        sortLabels: { asc: "Soonest first", desc: "Latest first" },
        widthClassName: "w-40",
        group: "Dates",
        description: "Earliest lot expiry — soon-to-expire (<30 days) is coloured amber.",
        cell: (r) => {
          if (!r.earliest_expiry) {
            return <span className="text-xs text-muted-foreground/50">—</span>;
          }
          const expiryMs = new Date(r.earliest_expiry).getTime();
          const days = Math.round((expiryMs - todayMs) / (24 * 60 * 60 * 1000));
          const tone =
            days < 0
              ? "destructive"
              : days <= 30
                ? "amber"
                : "muted";
          const formatted = formatCompanyDate(r.earliest_expiry, prefs);
          return (
            <div className="flex items-center gap-1.5">
              {days <= 30 && (
                <AlertTriangle
                  className={
                    days < 0 ? "size-3 text-destructive" : "size-3 text-amber-600"
                  }
                />
              )}
              <span
                className={
                  tone === "destructive"
                    ? "text-sm font-medium text-destructive"
                    : tone === "amber"
                      ? "text-sm font-medium text-amber-700 dark:text-amber-400"
                      : "text-sm"
                }
              >
                {formatted}
              </span>
            </div>
          );
        },
      },
      {
        id: "latest_received_at",
        header: "Last received",
        sortField: "latest_received_at",
        sortLabels: { asc: "Oldest first", desc: "Newest first" },
        widthClassName: "w-40",
        defaultHidden: true,
        group: "Dates",
        description: "Most recent lot receive across every warehouse.",
        cell: (r) =>
          r.latest_received_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(r.latest_received_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "external_sku",
        header: "External SKU",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Identity",
        description: "Vendor / retail SKU printed on packaging.",
        cell: (r) =>
          r.item_external_sku ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {r.item_external_sku}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "item_type_label",
        header: "Type",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Identity",
        description: "Item classification — raw material, packaging, semi-finished, finished.",
        cell: (r) => (
          <Badge tone={ITEM_TYPE_TONE[r.item_type]}>
            {ITEM_TYPE_LABEL[r.item_type]}
          </Badge>
        ),
      },
      {
        id: "days_to_expiry",
        header: "Days to expiry",
        align: "right",
        widthClassName: "w-28",
        defaultHidden: true,
        group: "Dates",
        description: "Days until the earliest lot expires — negative for already-expired.",
        cell: (r) => {
          if (!r.earliest_expiry) {
            return <span className="text-xs text-muted-foreground/50">—</span>;
          }
          const expiryMs = new Date(r.earliest_expiry).getTime();
          const days = Math.round(
            (expiryMs - todayMs) / (24 * 60 * 60 * 1000),
          );
          return (
            <span
              className={
                days < 0
                  ? "font-mono text-xs text-destructive"
                  : days <= 30
                    ? "font-mono text-xs text-amber-700 dark:text-amber-400"
                    : "font-mono text-xs text-muted-foreground"
              }
            >
              {days}
            </span>
          );
        },
      },
      {
        id: "avg_cost_per_unit",
        header: "Avg cost / unit",
        align: "right",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Amounts",
        description: "Naive average = total_cost / qty_on_hand.",
        cell: (r) => {
          const qty = Number(r.qty_on_hand);
          if (qty <= 0) {
            return <span className="text-xs text-muted-foreground/50">—</span>;
          }
          const avg = Number(r.total_cost) / qty;
          return (
            <span className="font-mono text-xs text-muted-foreground">
              {formatCompanyMoney(String(avg), prefs, {
                currency_code: prefs.currency_code ?? "GBP",
              })}
            </span>
          );
        },
      },
      {
        id: "stock_status",
        header: "Stock status",
        widthClassName: "w-28",
        defaultHidden: true,
        group: "Status",
        description: "Convenience chip — Out / In stock based on qty_on_hand.",
        cell: (r) => {
          const isZero = Number(r.qty_on_hand) === 0;
          return isZero ? (
            <Badge tone="muted">Out</Badge>
          ) : (
            <Badge tone="emerald">In stock</Badge>
          );
        },
      },
      {
        id: "item_uuid",
        header: "Item UUID",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Meta",
        description: "Item UUID — useful for debugging / API cross-refs.",
        cell: (r) => (
          <span className="font-mono text-[10px] text-muted-foreground">
            {r.item_uuid.slice(0, 8)}
          </span>
        ),
      },
    ],
    [prefs, todayMs],
  );

  return (
    <DataTable<InventoryRow>
      tableId="inventory"
      columns={columns}
      rowKey={(r) => String(r.item_id)}
      fetchPage={fetchInventoryPage}
      initialPage={initialPage}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search by item name or SKU…"
      filters={filters}
      onRowClick={(r) =>
        router.push(`/stock/lots?item_id=${encodeURIComponent(r.item_id)}`)
      }
      renderMobileCard={(r) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-sm font-semibold">{r.item_name}</p>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-mono">{r.item_code ?? `#${r.item_id}`}</span>
                <Badge tone={ITEM_TYPE_TONE[r.item_type]}>
                  {ITEM_TYPE_LABEL[r.item_type]}
                </Badge>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-base font-semibold">
                {formatCompanyNumber(r.qty_on_hand, prefs)}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                on hand
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {r.lots_count} {r.lots_count === 1 ? "lot" : "lots"}
            </span>
            {r.earliest_expiry && (
              <span>Earliest expiry {formatCompanyDate(r.earliest_expiry, prefs)}</span>
            )}
          </div>
        </div>
      )}
      emptyState={
        <div className="flex flex-col items-center gap-2 py-6">
          <Package2 className="size-6 text-muted-foreground/60" />
          <p className="text-sm font-medium">No items in this view</p>
          <p className="text-xs text-muted-foreground">
            Try toggling Type or Warehouse filters, or receive a lot first.
          </p>
        </div>
      }
    />
  );
}
