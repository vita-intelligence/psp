"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Factory } from "lucide-react";
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
import { formatCompanyDate, formatCompanyNumber } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type {
  ManufacturingOrderLedgerPage,
  ManufacturingOrderStatus,
  ManufacturingOrderSummary,
} from "@/lib/production/types";

interface Props {
  initialPage: ManufacturingOrderLedgerPage;
}

const DEFAULT_SORT: SortSpec = { field: "inserted_at", direction: "desc" };

const STATUS_TONE: Record<
  ManufacturingOrderStatus,
  "muted" | "amber" | "emerald" | "destructive" | "indigo" | "sky"
> = {
  draft: "muted",
  prepared: "amber",
  approved: "indigo",
  scheduled: "sky",
  in_progress: "amber",
  completed: "emerald",
  cancelled: "destructive",
};

const STATUS_LABEL: Record<ManufacturingOrderStatus, string> = {
  draft: "Draft",
  prepared: "Awaiting approval",
  approved: "Approved",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const FILTERS: FilterDef[] = [
  {
    field: "status",
    label: "Status",
    options: [
      { label: "Draft", value: "draft" },
      { label: "Awaiting approval", value: "prepared" },
      { label: "Approved", value: "approved" },
      { label: "Scheduled", value: "scheduled" },
      { label: "In progress", value: "in_progress" },
      { label: "Completed", value: "completed" },
      { label: "Cancelled", value: "cancelled" },
    ],
  },
];

async function fetchPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<ManufacturingOrderSummary>> {
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
  const res = await fetch(
    `/api/production/manufacturing-orders?${qs.toString()}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      /* leave */
    }
    throw new Error(detail);
  }
  return (await res.json()) as PageResult<ManufacturingOrderSummary>;
}

export function ManufacturingOrdersLedger({ initialPage }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const columns = useMemo<DataTableColumn<ManufacturingOrderSummary>[]>(
    () => [
      {
        id: "code",
        header: "MO",
        widthClassName: "w-24",
        cell: (m) => (
          <span className="font-mono text-xs font-semibold">
            {m.code ?? `#${m.id}`}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        widthClassName: "w-32",
        cell: (m) => (
          <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
        ),
      },
      {
        id: "product",
        header: "Product",
        widthClassName: "min-w-[16rem]",
        cell: (m) =>
          m.item ? (
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-sm">{m.item.name}</p>
              {m.item.code && (
                <p className="font-mono text-[10px] text-muted-foreground">
                  {m.item.code}
                </p>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "quantity",
        header: "Qty",
        widthClassName: "w-24",
        cell: (m) => (
          <span className="font-mono text-xs">
            {formatCompanyNumber(m.quantity, prefs)}
          </span>
        ),
      },
      {
        id: "site",
        header: "Site",
        widthClassName: "min-w-[12rem]",
        cell: (m) =>
          m.warehouse ? (
            <span className="truncate text-xs text-muted-foreground">
              {m.warehouse.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "start_at",
        header: "Scheduled",
        widthClassName: "w-32",
        cell: (m) => (
          <span className="text-xs text-muted-foreground">
            {m.start_at ? formatCompanyDate(m.start_at, prefs) : "—"}
          </span>
        ),
      },
      {
        id: "finish_at",
        header: "Finishes",
        widthClassName: "w-32",
        cell: (m) => (
          <span className="text-xs text-muted-foreground">
            {m.finish_at ? formatCompanyDate(m.finish_at, prefs) : "—"}
          </span>
        ),
      },
      {
        id: "assigned_to",
        header: "Assigned",
        widthClassName: "min-w-[10rem]",
        cell: (m) =>
          m.assigned_to ? (
            <span className="truncate text-xs">{m.assigned_to.name}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<ManufacturingOrderSummary>
      tableId="production-manufacturing-orders"
      columns={columns}
      rowKey={(m) => String(m.id)}
      fetchPage={fetchPage}
      initialPage={{
        items: initialPage.items,
        next_cursor: initialPage.next_cursor,
      }}
      defaultSort={DEFAULT_SORT}
      filters={FILTERS}
      searchPlaceholder="Search by revision or notes…"
      onRowClick={(m) =>
        router.push(`/production/manufacturing-orders/${m.uuid}`)
      }
      renderMobileCard={(m) => (
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {m.item?.name ?? m.code}
              </p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {m.code ?? `#${m.id}`}
              </p>
            </div>
            <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {formatCompanyNumber(m.quantity, prefs)} Each · {m.warehouse?.name}
          </p>
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <Factory className="mx-auto size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No manufacturing orders yet</p>
          <p className="text-xs text-muted-foreground">
            Create the first run for a finished or semi-finished item.
          </p>
        </div>
      }
    />
  );
}
