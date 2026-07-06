"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { ShieldCheck } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import type {
  ColumnFilterValue,
  DataTableColumn,
  PageResult,
  SortSpec,
  FilterValue,
} from "@/components/data-table/types";
import { serializeColumnFilters } from "@/lib/data-table/serialize";
import { formatDistanceToNowStrict } from "date-fns";
import { formatCompanyDate, formatCompanyNumber } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type {
  ManufacturingOrderLedgerPage,
  ManufacturingOrderSummary,
} from "@/lib/production/types";

interface Props {
  initialPage: ManufacturingOrderLedgerPage;
}

const DEFAULT_SORT: SortSpec = { field: "inserted_at", direction: "desc" };

async function fetchPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: FilterValue;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<ManufacturingOrderSummary>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  // Always filter to prepared — this is the approvals queue.
  qs.set("status", "prepared");
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  serializeColumnFilters(qs, params.columnFilters);

  const res = await fetch(
    `/api/production/manufacturing-orders?${qs.toString()}`,
    { cache: "no-store" },
  );
  if (!res.ok) return { items: [], next_cursor: null };
  return await res.json();
}

export function ApprovalsWorklist({ initialPage }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const columns: DataTableColumn<ManufacturingOrderSummary>[] = useMemo(
    () => [
      {
        id: "code",
        header: "MO",
        sortField: "id",
        filterField: "id",
        filterKind: "text",
        filterPlaceholder: "MO00001…",
        group: "Identity",
        description: "Auto-numbered MO code awaiting approval.",
        cell: (mo) => (
          <span className="font-mono text-xs">{mo.code ?? `#${mo.id}`}</span>
        ),
      },
      {
        id: "item",
        header: "Product",
        filterField: "product",
        filterKind: "text",
        filterPlaceholder: "Item name or SKU…",
        group: "Identity",
        description: "Item being manufactured (+ BOM below). Filter by name or SKU.",
        cell: (mo) => (
          <div className="min-w-0">
            <p className="truncate text-sm">{mo.item?.name ?? "—"}</p>
            {mo.bom && (
              <p className="font-mono text-[10px] text-muted-foreground">
                {mo.bom.code ?? mo.bom.name}
              </p>
            )}
          </div>
        ),
      },
      {
        id: "quantity",
        header: "Qty",
        align: "right",
        sortField: "quantity",
        filterField: "quantity",
        filterKind: "number-range",
        group: "Amounts",
        description: "Planned production quantity.",
        cell: (mo) => (
          <span className="font-mono text-xs">
            {formatCompanyNumber(mo.quantity, prefs)}{" "}
            <span className="text-muted-foreground">
              {mo.item?.stock_uom?.symbol ?? ""}
            </span>
          </span>
        ),
      },
      {
        id: "warehouse",
        header: "Site",
        filterField: "site",
        filterKind: "text",
        filterPlaceholder: "Site name…",
        group: "Location",
        description: "Production site (warehouse) this MO runs at. Filter by name.",
        cell: (mo) => (
          <span className="text-xs">{mo.warehouse?.name ?? "—"}</span>
        ),
      },
      {
        id: "prepared_by",
        header: "Prepared by",
        group: "Identity",
        description: "Planner who signed the 1st stage (Prepare).",
        cell: (mo) => (
          <div className="min-w-0">
            <p className="truncate text-xs">{mo.prepared_by?.name ?? "—"}</p>
            {mo.prepared_at && (
              <p className="text-[10px] text-muted-foreground">
                {formatCompanyDate(mo.prepared_at, prefs)} ·{" "}
                {formatDistanceToNowStrict(new Date(mo.prepared_at), {
                  addSuffix: true,
                })}
              </p>
            )}
          </div>
        ),
      },
      {
        id: "start_at",
        header: "Planned start",
        group: "Dates",
        description: "Planned start (earliest step start — derived from step times).",
        cell: (mo) => (
          <span className="font-mono text-[11px]">
            {formatCompanyDate(mo.start_at, prefs)}
          </span>
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
        cell: (mo) => (
          <span className="font-mono text-xs text-muted-foreground">
            {mo.revision}
          </span>
        ),
      },
      {
        id: "item_code",
        header: "Item code",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Identity",
        description: "Auto-numbered code for the produced item.",
        cell: (mo) =>
          mo.item?.code ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {mo.item.code}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "assigned_to",
        header: "Assigned",
        widthClassName: "min-w-[10rem]",
        defaultHidden: true,
        group: "Identity",
        description: "Operator or planner owning the run.",
        cell: (mo) =>
          mo.assigned_to ? (
            <span className="truncate text-xs">{mo.assigned_to.name}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "finish_at",
        header: "Planned finish",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Dates",
        description: "Planned finish (latest step finish).",
        cell: (mo) =>
          mo.finish_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(mo.finish_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "due_date",
        header: "Due date",
        widthClassName: "w-28",
        defaultHidden: true,
        sortField: "due_date",
        filterField: "due_date",
        filterKind: "date-range",
        group: "Dates",
        description: "Customer-facing due date driving priority.",
        cell: (mo) =>
          mo.due_date ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(mo.due_date, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "prepared_at",
        header: "Prepared at",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "prepared_at",
        filterKind: "date-range",
        group: "Dates",
        description: "Timestamp of the 1st signature.",
        cell: (mo) =>
          mo.prepared_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(mo.prepared_at, prefs)}
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
        description: "Bookings whose lot fell out of `available` — approver should re-book first.",
        cell: (mo) => (
          <span
            className={
              mo.broken_bookings_count > 0
                ? "text-sm font-semibold text-destructive"
                : "text-xs text-muted-foreground/50"
            }
          >
            {mo.broken_bookings_count}
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
        description: "BOM lines not yet fully covered by bookings.",
        cell: (mo) => (
          <span
            className={
              mo.under_booked_count > 0
                ? "text-sm font-semibold text-amber-700 dark:text-amber-400"
                : "text-xs text-muted-foreground/50"
            }
          >
            {mo.under_booked_count}
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
        cell: (mo) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(mo.inserted_at, prefs)}
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
        cell: (mo) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(mo.updated_at, prefs)}
          </span>
        ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<ManufacturingOrderSummary>
      tableId="production.approvals"
      realtimeEntity="manufacturing-order"
      initialPage={{
        items: initialPage.items,
        next_cursor: initialPage.next_cursor,
      }}
      columns={columns}
      rowKey={(mo) => String(mo.id)}
      defaultSort={DEFAULT_SORT}
      fetchPage={fetchPage}
      onRowClick={(mo) =>
        router.push(`/production/manufacturing-orders/${mo.uuid}`)
      }
      searchPlaceholder="Search MOs by revision or notes…"
      emptyState={
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <ShieldCheck className="size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">Approval queue is empty</p>
          <p className="text-xs text-muted-foreground">
            No manufacturing orders are awaiting countersignature right now.
          </p>
        </div>
      }
    />
  );
}
