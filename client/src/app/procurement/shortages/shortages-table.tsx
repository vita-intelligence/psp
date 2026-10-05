"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle, ExternalLink, ShoppingCart, Store } from "lucide-react";
import { DataTable } from "@/components/data-table";
import type {
  ColumnFilterValue,
  DataTableColumn,
  FilterDef,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { serializeColumnFilters } from "@/lib/data-table/serialize";
import { Button } from "@/components/ui/button";
import {
  formatCompanyDate,
  formatQtyHumanized,
  type FormatPrefs,
} from "@/lib/format/company";
import type { ShortageRow } from "@/lib/procurement-shortages/server";

interface Props {
  initialPage: PageResult<ShortageRow>;
  companyDateFormat: FormatPrefs | null;
  /** Optional project filter (NPD formulation uuid). When set, the
   *  table restricts to shortage rows whose dependent MOs touch this
   *  formulation. Threaded through to the backend as
   *  ``formulation_uuid`` so pagination + totals agree. */
  formulationUuid?: string | null;
}

const FILTERS: FilterDef[] = [
  {
    field: "item_type",
    label: "Item type",
    options: [
      { label: "Raw material", value: "raw_material" },
      { label: "Packaging", value: "packaging" },
    ],
  },
  {
    field: "has_expecting",
    label: "PO status",
    options: [
      { label: "On open PO", value: "true" },
      { label: "Nothing ordered", value: "false" },
    ],
  },
];

const DEFAULT_SORT: SortSpec = { field: "shortage_qty", direction: "desc" };

async function fetchShortagesPage(
  params: {
    cursor: string | null;
    limit: number;
    sort: SortSpec | null;
    filters: Record<string, string | boolean | number>;
    columnFilters: Record<string, ColumnFilterValue>;
    search: string;
  },
  formulationUuid: string | null,
): Promise<PageResult<ShortageRow>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  for (const [k, v] of Object.entries(params.filters)) {
    qs.set(`filter[${k}]`, String(v));
  }
  if (formulationUuid) qs.set("formulation_uuid", formulationUuid);
  serializeColumnFilters(qs, params.columnFilters);

  const res = await fetch(
    `/api/procurement/shortages?${qs.toString()}`,
    { cache: "no-store" },
  );
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
  return (await res.json()) as PageResult<ShortageRow>;
}

export function ShortagesTable({
  initialPage,
  companyDateFormat,
  formulationUuid = null,
}: Props) {
  const columns = useMemo<DataTableColumn<ShortageRow>[]>(() => {
    function uomOf(r: ShortageRow): string {
      // Prefer the UoM every contributing BOM line actually stores
      // its qty in (kg / L after NPD's base-unit normalisation).
      // Falls back to the item's stock_uom for legacy rows and the
      // ultimate empty string only when neither is set.
      return r.line_uom?.symbol ?? r.item?.stock_uom?.symbol ?? "";
    }

    return [
      {
        id: "item",
        header: "Item",
        sortField: "item_name",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        filterField: "item_name",
        filterKind: "text",
        filterPlaceholder: "Search item…",
        hideable: false,
        group: "Identity",
        description: "Raw material or packaging item that's short.",
        cell: (r) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-medium">
                {r.item?.name ?? "Unknown item"}
              </p>
              {r.is_rnd ? (
                <span
                  title="R&D stream — this row aggregates demand from trial / sample MOs. Create a separate PO with the For R&D flag ticked."
                  className="shrink-0 rounded-full border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-400"
                >
                  R&amp;D
                </span>
              ) : null}
            </div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {r.item?.item_type ?? "—"}
            </p>
          </div>
        ),
      },
      {
        id: "required",
        header: "Required",
        sortField: "required_qty",
        sortLabels: { asc: "Smallest", desc: "Largest" },
        filterField: "required_qty",
        filterKind: "number-range",
        align: "right",
        widthClassName: "w-32",
        group: "Amounts",
        description: "Total qty every open MO needs of this item.",
        cell: (r) => {
          const q = formatQtyHumanized(r.required_qty, uomOf(r), companyDateFormat);
          return (
            <span className="font-mono text-xs">
              {q.value} {q.unit}
            </span>
          );
        },
      },
      {
        id: "booked",
        header: "Booked",
        sortField: "booked_qty",
        sortLabels: { asc: "Smallest", desc: "Largest" },
        filterField: "booked_qty",
        filterKind: "number-range",
        align: "right",
        widthClassName: "w-32",
        group: "Amounts",
        description: "Qty already reserved from existing stock via MO bookings.",
        cell: (r) => {
          const q = formatQtyHumanized(r.booked_qty, uomOf(r), companyDateFormat);
          return (
            <span className="font-mono text-xs text-muted-foreground">
              {q.value} {q.unit}
            </span>
          );
        },
      },
      {
        id: "expecting",
        header: "Expecting",
        sortField: "expecting_qty",
        sortLabels: { asc: "Smallest", desc: "Largest" },
        filterField: "expecting_qty",
        filterKind: "number-range",
        align: "right",
        widthClassName: "w-32",
        group: "Amounts",
        description: "Qty already on open POs (ordered / partially received).",
        cell: (r) => {
          const v = Number(r.expecting_qty);
          const q = formatQtyHumanized(r.expecting_qty, uomOf(r), companyDateFormat);
          return (
            <span
              className={
                v > 0
                  ? "font-mono text-xs text-sky-700 dark:text-sky-300"
                  : "font-mono text-xs text-muted-foreground"
              }
              title={v > 0 ? "Already on an open PO" : "Nothing ordered yet"}
            >
              {q.value} {q.unit}
            </span>
          );
        },
      },
      {
        id: "on_hand",
        header: "On hand",
        sortField: "on_hand_qty",
        sortLabels: { asc: "Smallest", desc: "Largest" },
        filterField: "on_hand_qty",
        filterKind: "number-range",
        align: "right",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Amounts",
        description: "Currently on-hand qty in `available` cells (unreserved).",
        cell: (r) => {
          const q = formatQtyHumanized(r.on_hand_qty, uomOf(r), companyDateFormat);
          return (
            <span className="font-mono text-xs text-muted-foreground">
              {q.value} {q.unit}
            </span>
          );
        },
      },
      {
        id: "shortage",
        header: "Short",
        sortField: "shortage_qty",
        sortLabels: { asc: "Smallest gap", desc: "Largest gap" },
        filterField: "shortage_qty",
        filterKind: "number-range",
        align: "right",
        widthClassName: "w-40",
        group: "Amounts",
        description:
          "Net gap = required − on_hand − expecting. Rows with 0 gap but flagged 'book from stock' surface here because an operator hit \"Request purchases\" — on-hand covers it, so book instead of raising a PO.",
        cell: (r) => {
          const isZero = Number(r.shortage_qty) === 0;
          if (isZero && r.explicit_request) {
            return (
              <span
                className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-300"
                title="Operator flagged for procurement, but on-hand stock covers it — book from stock rather than raising a PO."
              >
                <AlertTriangle className="size-3" />
                Book from stock
              </span>
            );
          }
          const q = formatQtyHumanized(r.shortage_qty, uomOf(r), companyDateFormat);
          return (
            <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-red-700 dark:text-red-300">
              <AlertTriangle className="size-3" />
              {q.value} {q.unit}
            </span>
          );
        },
      },
      {
        id: "mos",
        header: "Waiting MOs",
        filterField: "mo_code",
        filterKind: "text",
        filterPlaceholder: "MO00…",
        group: "Compliance",
        description:
          "Open MOs blocked on this shortage. Filter matches on MO code (e.g. `MO00219`) or the finished item's name across any waiting MO on the row.",
        cell: (r) => {
          if (r.dependent_mos.length === 0) {
            return <span className="text-xs text-muted-foreground/50">—</span>;
          }
          const head = r.dependent_mos.slice(0, 2);
          const rest = r.dependent_mos.length - head.length;
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              {head.map((mo) => (
                <Link
                  key={mo.uuid}
                  href={`/production/manufacturing-orders/${mo.uuid}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] hover:bg-muted/70"
                  title={
                    mo.planned_start
                      ? `${mo.item_name} · planned ${formatCompanyDate(mo.planned_start, companyDateFormat)}`
                      : mo.item_name
                  }
                >
                  <span className="truncate font-mono">
                    {mo.code ?? mo.uuid.slice(0, 8)}
                  </span>
                  <ExternalLink className="size-2.5 text-muted-foreground" />
                </Link>
              ))}
              {rest > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  +{rest} more
                </span>
              )}
            </div>
          );
        },
      },
      // ---- defaultHidden columns below ----
      {
        id: "item_type",
        header: "Item type",
        filterField: "item_type",
        filterKind: "select",
        filterOptions: [
          { label: "Raw material", value: "raw_material" },
          { label: "Packaging", value: "packaging" },
        ],
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Identity",
        description: "Item category (raw material or packaging).",
        cell: (r) =>
          r.item?.item_type ? (
            <span className="text-xs text-muted-foreground">
              {r.item.item_type}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "uom",
        header: "UoM",
        filterField: "uom",
        filterKind: "text",
        filterPlaceholder: "kg, ml…",
        widthClassName: "w-20",
        defaultHidden: true,
        group: "Identity",
        description: "Stock unit of measurement (symbol).",
        cell: (r) =>
          r.item?.stock_uom ? (
            <span className="font-mono text-xs">{r.item.stock_uom.symbol}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "coverage_pct",
        header: "Coverage",
        align: "right",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Amounts",
        description: "(booked + expecting) / required — 100% means no shortage.",
        cell: (r) => {
          const required = Number(r.required_qty);
          if (required <= 0) {
            return <span className="text-xs text-muted-foreground/50">—</span>;
          }
          const covered =
            Number(r.booked_qty) + Number(r.expecting_qty);
          const pct = Math.round((covered / required) * 100);
          return (
            <span
              className={
                pct >= 100
                  ? "font-mono text-xs text-emerald-700 dark:text-emerald-400"
                  : "font-mono text-xs text-amber-700 dark:text-amber-400"
              }
            >
              {pct}%
            </span>
          );
        },
      },
      {
        id: "dependent_count",
        header: "MOs blocked",
        align: "right",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Compliance",
        description: "Count of open MOs blocked by this shortage.",
        cell: (r) => (
          <span className="font-mono text-xs">{r.dependent_mos.length}</span>
        ),
      },
      {
        id: "vendor",
        header: "Vendor",
        widthClassName: "w-56",
        group: "Identity",
        description:
          "Primary supplier for this item — resolved from vendor purchase terms (ranked by priority) with vendor_approved_items as a fallback. Alternates listed below.",
        cell: (r) => {
          const cands = r.vendor_candidates ?? [];
          if (cands.length === 0) {
            return (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300"
                title="No vendor approved for this item yet — add one in Vendors → Approved items before raising a PO."
              >
                <AlertTriangle className="size-2.5" />
                No vendor
              </span>
            );
          }
          const primary = cands[0];
          const alternates = cands.slice(1, 3);
          const overflow = cands.length - 1 - alternates.length;
          return (
            <div className="min-w-0 space-y-1">
              <Link
                href={`/vendors/${encodeURIComponent(primary.vendor_uuid)}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium hover:bg-muted/70"
                title={
                  primary.source === "purchase_term"
                    ? `Primary vendor (purchase-term priority ${primary.priority})`
                    : "Approved vendor — no commercial baseline yet"
                }
              >
                <Store className="size-2.5 text-muted-foreground" />
                <span className="truncate">{primary.vendor_name}</span>
                {primary.source === "approved" && (
                  <span className="shrink-0 rounded-full border border-dashed border-amber-500/40 px-1 text-[9px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    approved
                  </span>
                )}
              </Link>
              {(primary.lead_time_days != null || primary.price != null) && (
                <p className="text-[10px] text-muted-foreground">
                  {primary.lead_time_days != null
                    ? `${primary.lead_time_days}d lead`
                    : null}
                  {primary.lead_time_days != null && primary.price != null
                    ? " · "
                    : ""}
                  {primary.price != null
                    ? `${primary.currency_code ?? ""} ${primary.price}`.trim()
                    : null}
                </p>
              )}
              {alternates.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {alternates.map((v) => (
                    <Link
                      key={v.vendor_id}
                      href={`/vendors/${encodeURIComponent(v.vendor_uuid)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="truncate rounded-md border border-border/40 px-1 text-[10px] text-muted-foreground hover:bg-muted"
                      title={`Alternate (${v.source === "purchase_term" ? `priority ${v.priority}` : "approved"})`}
                    >
                      {v.vendor_name}
                    </Link>
                  ))}
                  {overflow > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{overflow}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: "earliest_planned",
        header: "Earliest need",
        filterField: "earliest_planned",
        filterKind: "date-range",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Dates",
        description: "Earliest planned start across MOs waiting on this item.",
        cell: (r) => {
          const dates = r.dependent_mos
            .map((mo) => mo.planned_start)
            .filter((d): d is string => !!d)
            .sort();
          const earliest = dates[0];
          return earliest ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(earliest, companyDateFormat)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          );
        },
      },
      {
        id: "action",
        header: "",
        widthClassName: "w-32",
        hideable: false,
        cell: (r) => {
          // Pre-fill qty for the PO line:
          // * genuine shortage → shortage_qty (the exact gap after
          //   netting on-hand + expecting — matches what
          //   procurement must buy).
          // * explicit_request with no shortage → required − booked
          //   (the outstanding unbooked qty the operator flagged
          //   for procurement; on-hand is irrelevant because they
          //   want a fresh PO regardless).
          const shortage = Number(r.shortage_qty);
          const outstanding = Number(r.required_qty) - Number(r.booked_qty);
          const preFillQty =
            shortage > 0
              ? r.shortage_qty
              : outstanding > 0
                ? String(outstanding)
                : r.required_qty;
          return (
            <Button
              asChild
              size="sm"
              variant="default"
              className="h-8 w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <Link
                href={`/procurement/purchase-orders/new?item_uuid=${encodeURIComponent(
                  r.item?.uuid ?? "",
                )}&qty=${encodeURIComponent(preFillQty)}${
                  r.is_rnd ? "&is_rnd=1" : ""
                }`}
              >
                <ShoppingCart className="mr-1.5 size-3.5" />
                Create PO
              </Link>
            </Button>
          );
        },
      },
    ];
  }, [companyDateFormat]);

  const fetchPage = useMemo(
    () => (params: Parameters<typeof fetchShortagesPage>[0]) =>
      fetchShortagesPage(params, formulationUuid),
    [formulationUuid],
  );

  return (
    <DataTable<ShortageRow>
      tableId="procurement-shortages"
      realtimeEntity="shortage"
      columns={columns}
      rowKey={(r) => String(r.item?.id ?? r.item?.uuid ?? r.shortage_qty)}
      fetchPage={fetchPage}
      initialPage={initialPage}
      defaultSort={DEFAULT_SORT}
      filters={FILTERS}
      searchPlaceholder="Search items…"
      emptyState={
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-6 py-12 text-center text-sm text-muted-foreground">
          Nothing short right now. Every open MO has its booked or
          on-order qty covered.
        </div>
      }
    />
  );
}
