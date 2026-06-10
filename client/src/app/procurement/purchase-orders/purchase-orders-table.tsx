"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { DataTable } from "@/components/data-table";
import type {
  DataTableColumn,
  FilterDef,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge-mini";
import type { PurchaseOrder, PurchaseOrderStatus } from "@/lib/types";
import {
  formatCompanyDate,
  formatCompanyMoney,
} from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

interface Props {
  initialPage: PageResult<PurchaseOrder>;
}

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  pending_approver: "Pending approver",
  pending_director: "Pending director",
  approved: "Approved",
  ordered: "Ordered",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<
  PurchaseOrderStatus,
  "muted" | "amber" | "indigo" | "emerald" | "destructive"
> = {
  draft: "muted",
  pending_approver: "amber",
  pending_director: "amber",
  approved: "indigo",
  ordered: "indigo",
  partially_received: "amber",
  received: "emerald",
  cancelled: "destructive",
};

const STATUS_FILTER: FilterDef = {
  field: "status",
  label: "Status",
  options: (Object.keys(STATUS_LABEL) as PurchaseOrderStatus[]).map((s) => ({
    label: STATUS_LABEL[s],
    value: s,
  })),
};

const DEFAULT_SORT: SortSpec = { field: "id", direction: "desc" };

async function fetchPOPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  search: string;
}): Promise<PageResult<PurchaseOrder>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  for (const [k, v] of Object.entries(params.filters)) {
    qs.set(k, String(v));
  }
  const res = await fetch(`/api/purchase-orders?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<PurchaseOrder>;
}

export function PurchaseOrdersTable({ initialPage }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const filters = useMemo<FilterDef[]>(() => [STATUS_FILTER], []);

  const columns = useMemo<DataTableColumn<PurchaseOrder>[]>(
    () => [
      {
        id: "code",
        header: "PO",
        sortField: "id",
        widthClassName: "w-24",
        cell: (p) => (
          <span className="font-mono text-xs font-semibold text-muted-foreground">
            {p.code ?? `#${p.id}`}
          </span>
        ),
      },
      {
        id: "vendor",
        header: "Vendor",
        hideable: false,
        widthClassName: "min-w-[16rem]",
        cell: (p) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {p.vendor?.name ?? "—"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {p.lines.length} {p.lines.length === 1 ? "line" : "lines"}
              {p.notes ? ` · ${p.notes}` : ""}
            </p>
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        sortField: "status",
        widthClassName: "w-40",
        cell: (p) => (
          <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
        ),
      },
      {
        id: "total_amount",
        header: "Total",
        sortField: "total_amount",
        align: "right",
        widthClassName: "w-32",
        cell: (p) => (
          <span className="font-mono text-sm">
            {formatCompanyMoney(p.total_amount, prefs, {
              currency_code: p.currency_code,
            })}
          </span>
        ),
      },
      {
        id: "expected_delivery_date",
        header: "Expected delivery",
        sortField: "expected_delivery_date",
        widthClassName: "w-40",
        cell: (p) =>
          p.expected_delivery_date ? (
            <span className="text-sm">
              {formatCompanyDate(p.expected_delivery_date, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "submitted_at",
        header: "Submitted",
        sortField: "submitted_at",
        widthClassName: "w-36",
        defaultHidden: true,
        cell: (p) =>
          p.submitted_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(p.submitted_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<PurchaseOrder>
      tableId="purchase-orders"
      columns={columns}
      rowKey={(p) => String(p.id)}
      fetchPage={fetchPOPage}
      initialPage={initialPage}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search notes, address…"
      filters={filters}
      onRowClick={(p) => router.push(`/procurement/purchase-orders/${p.uuid}`)}
      renderMobileCard={(p) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {p.vendor?.name ?? "—"}
              </p>
              <p className="truncate text-[11px] font-mono text-muted-foreground">
                {p.code ?? `#${p.id}`}
              </p>
            </div>
            <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
          </div>
          <p className="text-right font-mono text-sm font-semibold">
            {formatCompanyMoney(p.total_amount, prefs, {
              currency_code: p.currency_code,
            })}
          </p>
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No purchase orders yet</p>
          <p className="text-xs text-muted-foreground">
            Raise your first PO against an approved vendor.
          </p>
        </div>
      }
    />
  );
}
