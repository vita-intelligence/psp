"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FilePlus, PackageMinus } from "lucide-react";
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
import type {
  StockMovementReasonCategory,
  StockWriteOffDisposalMethod,
  StockWriteOffRow,
  StockWriteOffStatus,
} from "@/lib/types";
import {
  STOCK_MOVEMENT_REASON_CATEGORY_LABEL,
  STOCK_WRITE_OFF_DISPOSAL_METHOD_LABEL,
  STOCK_WRITE_OFF_STATUS_LABEL,
} from "@/lib/types";
import {
  formatCompanyDate,
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import { CreateWriteOffModal } from "./create-write-off-modal";

interface WriteOffsTableProps {
  initialPage: PageResult<StockWriteOffRow>;
  canCreate: boolean;
}

const DEFAULT_SORT: SortSpec = { field: "inserted_at", direction: "desc" };

const STATUS_TONE: Record<
  StockWriteOffStatus,
  "muted" | "amber" | "sky" | "emerald" | "destructive"
> = {
  draft: "muted",
  pending_approval: "amber",
  pending_authorisation: "amber",
  active: "emerald",
  reverted: "destructive",
};

const STATUS_OPTIONS = (
  Object.keys(STOCK_WRITE_OFF_STATUS_LABEL) as StockWriteOffStatus[]
).map((v) => ({
  label: STOCK_WRITE_OFF_STATUS_LABEL[v],
  value: v,
}));

const REASON_CATEGORY_OPTIONS = (
  [
    "damage",
    "expiry",
    "qc_fail",
    "stock_take_variance",
    "theft_loss",
    "sample_pull",
    "customer_return",
    "admin_correction",
    "other",
  ] as StockMovementReasonCategory[]
).map((v) => ({
  label: STOCK_MOVEMENT_REASON_CATEGORY_LABEL[v],
  value: v,
}));

const DISPOSAL_METHOD_OPTIONS = (
  Object.keys(STOCK_WRITE_OFF_DISPOSAL_METHOD_LABEL) as StockWriteOffDisposalMethod[]
).map((v) => ({
  label: STOCK_WRITE_OFF_DISPOSAL_METHOD_LABEL[v],
  value: v,
}));

async function fetchWriteOffsPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<StockWriteOffRow>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  for (const [k, v] of Object.entries(params.filters)) {
    if (v === "" || v === null || v === undefined) continue;
    qs.set(k, String(v));
  }

  const insertedFilter = params.columnFilters["inserted_at"];
  if (
    insertedFilter &&
    insertedFilter.op === "range" &&
    "from" in insertedFilter &&
    (insertedFilter.from || insertedFilter.to)
  ) {
    if (insertedFilter.from) qs.set("from_at", `${insertedFilter.from}T00:00:00Z`);
    if (insertedFilter.to) qs.set("to_at", `${insertedFilter.to}T23:59:59Z`);
  }

  serializeColumnFilters(qs, params.columnFilters);

  const res = await fetch(`/api/stock/write-offs?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<StockWriteOffRow>;
}

export function WriteOffsTable({ initialPage, canCreate }: WriteOffsTableProps) {
  const prefs = useFormatPrefs();
  const [createOpen, setCreateOpen] = useState(false);

  const filters = useMemo<FilterDef[]>(() => [], []);

  const columns = useMemo<DataTableColumn<StockWriteOffRow>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        widthClassName: "w-24",
        hideable: false,
        group: "Identity",
        description: "Auto-numbered write-off code (WO00001, …).",
        cell: (w) => (
          <span className="font-mono text-xs font-semibold">
            {w.code ?? `#${w.id}`}
          </span>
        ),
      },
      {
        id: "inserted_at",
        header: "Filed",
        sortField: "inserted_at",
        sortLabels: { asc: "Oldest first", desc: "Newest first" },
        widthClassName: "w-40",
        filterField: "inserted_at",
        filterKind: "date-range",
        group: "Time",
        description: "When the draft was created.",
        cell: (w) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(w.inserted_at, prefs)}
            <span className="ml-1 text-[10px] opacity-70">
              {new Date(w.inserted_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        widthClassName: "w-40",
        hideable: false,
        filterField: "status",
        filterKind: "select",
        filterOptions: STATUS_OPTIONS,
        group: "State",
        description:
          "draft → pending_approval → pending_authorisation → active (reverted terminal).",
        cell: (w) => (
          <Badge tone={STATUS_TONE[w.status]}>
            {STOCK_WRITE_OFF_STATUS_LABEL[w.status]}
          </Badge>
        ),
      },
      {
        id: "reason_category",
        header: "Reason",
        widthClassName: "w-40",
        filterField: "reason_category",
        filterKind: "select",
        filterOptions: REASON_CATEGORY_OPTIONS,
        group: "What",
        description: "Closed-enum reason. Powers the waste-log report.",
        cell: (w) => (
          <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {STOCK_MOVEMENT_REASON_CATEGORY_LABEL[w.reason_category] ??
              w.reason_category}
          </span>
        ),
      },
      {
        id: "disposal_method",
        header: "Method",
        widthClassName: "w-40",
        filterField: "disposal_method",
        filterKind: "select",
        filterOptions: DISPOSAL_METHOD_OPTIONS,
        defaultHidden: true,
        group: "What",
        description: "How the physical goods left the site.",
        cell: (w) => (
          <span className="text-xs text-muted-foreground">
            {STOCK_WRITE_OFF_DISPOSAL_METHOD_LABEL[w.disposal_method] ??
              w.disposal_method}
          </span>
        ),
      },
      {
        id: "qty",
        header: "Qty",
        sortField: "qty",
        sortLabels: { asc: "Smallest first", desc: "Largest first" },
        widthClassName: "w-24",
        align: "right",
        filterField: "qty",
        filterKind: "number-range",
        group: "Amounts",
        description: "Quantity being written off.",
        cell: (w) => (
          <span className="font-mono text-xs font-semibold tabular-nums text-rose-600 dark:text-rose-500">
            −{formatCompanyNumber(w.qty, prefs)}{" "}
            {w.unit_of_measurement?.symbol ?? ""}
          </span>
        ),
      },
      {
        id: "value",
        header: "Value",
        widthClassName: "w-24",
        align: "right",
        group: "Amounts",
        description: "qty × unit_cost snapshotted at draft creation.",
        cell: (w) => (
          <span className="font-mono text-xs text-muted-foreground">
            {w.total_value
              ? formatCompanyMoney(w.total_value, prefs, {
                  currency_code: w.currency_snapshot,
                })
              : "—"}
          </span>
        ),
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
        cell: (w) =>
          w.item ? (
            <Link
              href={`/production/items/${w.item.uuid}`}
              onClick={(e) => e.stopPropagation()}
              className="block space-y-0.5 group"
            >
              <p className="truncate text-sm font-medium underline-offset-2 group-hover:underline">
                {w.item.name}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {w.item.code ?? "—"}
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
        description: "The stock lot being written off.",
        cell: (w) =>
          w.stock_lot ? (
            <Link
              href={`/stock/lots/${w.stock_lot.uuid}`}
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-xs font-semibold underline-offset-2 hover:underline"
            >
              {w.stock_lot.code ?? `#${w.stock_lot.id}`}
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "narrative",
        header: "Notes",
        widthClassName: "min-w-[16rem]",
        group: "What",
        description: "Free-text explanation captured by the creator.",
        cell: (w) => (
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {w.reason_narrative}
          </span>
        ),
      },
      {
        // `filed_by` (not `created_by`) so this doesn't collide with
        // the shared `auditColumns()` helper's `created_by` column
        // mixed in at the bottom — both would key on the same id and
        // trip React's duplicate-key warning inside the DataTable.
        id: "filed_by",
        header: "Filed by",
        widthClassName: "w-40",
        group: "Signatures",
        description: "Who filed the draft.",
        cell: (w) =>
          w.created_by ? (
            <span className="text-xs">
              {w.created_by.name ?? w.created_by.email ?? "—"}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "approved_by",
        header: "Approver",
        widthClassName: "w-40",
        defaultHidden: true,
        group: "Signatures",
        description: "Who approved (second signature).",
        cell: (w) =>
          w.approved_by ? (
            <span className="text-xs">
              {w.approved_by.name ?? w.approved_by.email ?? "—"}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "authorised_by",
        header: "Authoriser",
        widthClassName: "w-40",
        defaultHidden: true,
        group: "Signatures",
        description: "Who authorised (final signature).",
        cell: (w) =>
          w.authorised_by ? (
            <span className="text-xs">
              {w.authorised_by.name ?? w.authorised_by.email ?? "—"}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      ...auditColumns<StockWriteOffRow>(),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefs.date_format, prefs.decimal_separator, prefs.thousands_separator, prefs.currency_code, prefs.currency_format],
  );

  return (
    <>
      <DataTable
        tableId="stock-write-offs"
        columns={columns}
        rowKey={(w) => String(w.id)}
        fetchPage={fetchWriteOffsPage}
        initialPage={initialPage}
        searchPlaceholder="Search notes…"
        filters={filters}
        defaultSort={DEFAULT_SORT}
        rowHref={(w) => `/stock/write-offs/${w.uuid}`}
        toolbarActions={
          canCreate ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <FilePlus className="mr-1.5 size-4" />
              Create write-off
            </Button>
          ) : undefined
        }
        emptyState={
          <div className="space-y-1">
            <div className="flex items-center justify-center pb-2">
              <PackageMinus className="size-8 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium">No write-offs yet</p>
            <p className="text-xs text-muted-foreground">
              File one from a lot detail page or hit &quot;Create
              write-off&quot; above.
            </p>
          </div>
        }
      />

      <CreateWriteOffModal
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </>
  );
}
