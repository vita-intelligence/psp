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
        cell: (mo) => (
          <span className="font-mono text-xs">{mo.code ?? `#${mo.id}`}</span>
        ),
      },
      {
        id: "item",
        header: "Product",
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
        cell: (mo) => (
          <span className="text-xs">{mo.warehouse?.name ?? "—"}</span>
        ),
      },
      {
        id: "prepared_by",
        header: "Prepared by",
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
        sortField: "start_at",
        cell: (mo) => (
          <span className="font-mono text-[11px]">
            {formatCompanyDate(mo.start_at, prefs)}
          </span>
        ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<ManufacturingOrderSummary>
      tableId="production.approvals"
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
