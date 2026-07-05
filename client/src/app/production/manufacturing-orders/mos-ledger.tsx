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
  /** Location filters built server-side via `buildLocationFilters()`. */
  locationFilters?: FilterDef[];
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

const STATUS_OPTIONS = (
  Object.keys(STATUS_LABEL) as ManufacturingOrderStatus[]
).map((s) => ({ label: STATUS_LABEL[s], value: s }));

const STATUS_FILTER: FilterDef = {
  field: "status",
  label: "Status",
  options: STATUS_OPTIONS,
};

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

export function ManufacturingOrdersLedger({
  initialPage,
  locationFilters,
}: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const filters = useMemo<FilterDef[]>(
    () => [STATUS_FILTER, ...(locationFilters ?? [])],
    [locationFilters],
  );

  const columns = useMemo<DataTableColumn<ManufacturingOrderSummary>[]>(
    () => [
      {
        id: "code",
        header: "MO",
        widthClassName: "w-24",
        filterField: "id",
        filterKind: "text",
        filterPlaceholder: "MO00001…",
        group: "Identity",
        description: "Auto-numbered MO code (MO00001, …).",
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
        sortField: "status",
        filterField: "status",
        filterKind: "select",
        filterOptions: STATUS_OPTIONS,
        group: "Status",
        description: "MO lifecycle — draft → approved → scheduled → in progress → completed.",
        cell: (m) => (
          <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
        ),
      },
      {
        id: "product",
        header: "Product",
        widthClassName: "min-w-[16rem]",
        group: "Identity",
        description: "Item being manufactured.",
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
        align: "right",
        sortField: "quantity",
        filterField: "quantity",
        filterKind: "number-range",
        group: "Amounts",
        description: "Planned production quantity.",
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
        group: "Location",
        description: "Production site (warehouse) this MO runs at.",
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
        group: "Dates",
        description: "Planned start (earliest step start).",
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
        group: "Dates",
        description: "Planned finish (latest step finish).",
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
        group: "Identity",
        description: "Operator/planner owning this MO.",
        cell: (m) =>
          m.assigned_to ? (
            <span className="truncate text-xs">{m.assigned_to.name}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "revision",
        header: "Revision",
        widthClassName: "w-20",
        defaultHidden: true,
        group: "Identity",
        description: "MO revision label (V00, V01, …).",
        cell: (m) => (
          <span className="font-mono text-xs text-muted-foreground">
            {m.revision}
          </span>
        ),
      },
      {
        id: "bom",
        header: "BOM",
        widthClassName: "min-w-[12rem]",
        defaultHidden: true,
        group: "Identity",
        description: "Bill of materials driving component consumption.",
        cell: (m) =>
          m.bom ? (
            <span className="truncate text-xs text-muted-foreground">
              {m.bom.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "item_code",
        header: "Item code",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Identity",
        description: "Auto-numbered item code for the produced item.",
        cell: (m) =>
          m.item?.code ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {m.item.code}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "due_date",
        header: "Due",
        widthClassName: "w-28",
        defaultHidden: true,
        sortField: "due_date",
        filterField: "due_date",
        filterKind: "date-range",
        group: "Dates",
        description: "Customer-facing due date (may drive scheduling priority).",
        cell: (m) =>
          m.due_date ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(m.due_date, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "prepared_at",
        header: "Prepared",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "prepared_at",
        filterKind: "date-range",
        group: "Dates",
        description: "1st signature (planner) timestamp.",
        cell: (m) =>
          m.prepared_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(m.prepared_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "approved_at",
        header: "Approved",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "approved_at",
        filterKind: "date-range",
        group: "Dates",
        description: "2nd signature (scientist) timestamp — MO is committed after this.",
        cell: (m) =>
          m.approved_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(m.approved_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "broken_bookings",
        header: "Broken",
        align: "right",
        widthClassName: "w-20",
        defaultHidden: true,
        group: "Compliance",
        description: "Bookings whose lot fell out of `available` (broken plan).",
        cell: (m) => (
          <span
            className={
              m.broken_bookings_count > 0
                ? "text-sm font-semibold text-destructive"
                : "text-xs text-muted-foreground/50"
            }
          >
            {m.broken_bookings_count}
          </span>
        ),
      },
      {
        id: "under_booked",
        header: "Under-booked",
        align: "right",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Compliance",
        description: "BOM lines not fully covered by bookings.",
        cell: (m) => (
          <span
            className={
              m.under_booked_count > 0
                ? "text-sm font-semibold text-amber-700 dark:text-amber-400"
                : "text-xs text-muted-foreground/50"
            }
          >
            {m.under_booked_count}
          </span>
        ),
      },
      {
        id: "inserted_at",
        header: "Created",
        widthClassName: "w-32",
        defaultHidden: true,
        sortField: "inserted_at",
        filterField: "inserted_at",
        filterKind: "date-range",
        group: "Meta",
        description: "When this MO was created.",
        cell: (m) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(m.inserted_at, prefs)}
          </span>
        ),
      },
      {
        id: "updated_at",
        header: "Updated",
        widthClassName: "w-32",
        defaultHidden: true,
        sortField: "updated_at",
        filterField: "updated_at",
        filterKind: "date-range",
        group: "Meta",
        description: "When this MO was last modified.",
        cell: (m) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(m.updated_at, prefs)}
          </span>
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
      filters={filters}
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
