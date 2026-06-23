"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle, ExternalLink, ShoppingCart } from "lucide-react";
import { DataTable } from "@/components/data-table";
import type {
  DataTableColumn,
  FilterDef,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { Button } from "@/components/ui/button";
import {
  formatCompanyDate,
  formatCompanyNumber,
  type FormatPrefs,
} from "@/lib/format/company";
import type { ShortageRow } from "@/lib/procurement-shortages/server";

interface Props {
  initialPage: PageResult<ShortageRow>;
  companyDateFormat: FormatPrefs | null;
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

async function fetchShortagesPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  search: string;
}): Promise<PageResult<ShortageRow>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  for (const [k, v] of Object.entries(params.filters)) {
    qs.set(`filter[${k}]`, String(v));
  }

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

export function ShortagesTable({ initialPage, companyDateFormat }: Props) {
  const columns = useMemo<DataTableColumn<ShortageRow>[]>(() => {
    function uomOf(r: ShortageRow): string {
      return r.item?.stock_uom?.symbol ?? "";
    }

    return [
      {
        id: "item",
        header: "Item",
        sortField: "item_name",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        hideable: false,
        cell: (r) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {r.item?.name ?? "Unknown item"}
            </p>
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
        align: "right",
        widthClassName: "w-32",
        cell: (r) => (
          <span className="font-mono text-xs">
            {formatCompanyNumber(r.required_qty, companyDateFormat)} {uomOf(r)}
          </span>
        ),
      },
      {
        id: "booked",
        header: "Booked",
        sortField: "booked_qty",
        sortLabels: { asc: "Smallest", desc: "Largest" },
        align: "right",
        widthClassName: "w-32",
        cell: (r) => (
          <span className="font-mono text-xs text-muted-foreground">
            {formatCompanyNumber(r.booked_qty, companyDateFormat)} {uomOf(r)}
          </span>
        ),
      },
      {
        id: "expecting",
        header: "Expecting",
        sortField: "expecting_qty",
        sortLabels: { asc: "Smallest", desc: "Largest" },
        align: "right",
        widthClassName: "w-32",
        cell: (r) => {
          const v = Number(r.expecting_qty);
          return (
            <span
              className={
                v > 0
                  ? "font-mono text-xs text-sky-700 dark:text-sky-300"
                  : "font-mono text-xs text-muted-foreground"
              }
              title={v > 0 ? "Already on an open PO" : "Nothing ordered yet"}
            >
              {formatCompanyNumber(r.expecting_qty, companyDateFormat)}{" "}
              {uomOf(r)}
            </span>
          );
        },
      },
      {
        id: "on_hand",
        header: "On hand",
        sortField: "on_hand_qty",
        sortLabels: { asc: "Smallest", desc: "Largest" },
        align: "right",
        widthClassName: "w-32",
        defaultHidden: true,
        cell: (r) => (
          <span className="font-mono text-xs text-muted-foreground">
            {formatCompanyNumber(r.on_hand_qty, companyDateFormat)} {uomOf(r)}
          </span>
        ),
      },
      {
        id: "shortage",
        header: "Short",
        sortField: "shortage_qty",
        sortLabels: { asc: "Smallest gap", desc: "Largest gap" },
        align: "right",
        widthClassName: "w-32",
        cell: (r) => (
          <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-red-700 dark:text-red-300">
            <AlertTriangle className="size-3" />
            {formatCompanyNumber(r.shortage_qty, companyDateFormat)} {uomOf(r)}
          </span>
        ),
      },
      {
        id: "mos",
        header: "Waiting MOs",
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
      {
        id: "action",
        header: "",
        widthClassName: "w-32",
        hideable: false,
        cell: (r) => (
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
              )}&qty=${encodeURIComponent(r.shortage_qty)}`}
            >
              <ShoppingCart className="mr-1.5 size-3.5" />
              Create PO
            </Link>
          </Button>
        ),
      },
    ];
  }, [companyDateFormat]);

  return (
    <DataTable<ShortageRow>
      tableId="procurement-shortages"
      columns={columns}
      rowKey={(r) => String(r.item?.id ?? r.item?.uuid ?? r.shortage_qty)}
      fetchPage={fetchShortagesPage}
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
