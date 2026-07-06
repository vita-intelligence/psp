"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
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
import type { PurchaseOrder, PurchaseOrderStatus } from "@/lib/types";
import {
  formatCompanyDate,
  formatCompanyMoney,
} from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

interface Props {
  initialPage: PageResult<PurchaseOrder>;
  /** Location filters built server-side via `buildLocationFilters()`. */
  locationFilters?: FilterDef[];
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

const STATUS_OPTIONS = (
  Object.keys(STATUS_LABEL) as PurchaseOrderStatus[]
).map((s) => ({ label: STATUS_LABEL[s], value: s }));

const STATUS_FILTER: FilterDef = {
  field: "status",
  label: "Status",
  options: STATUS_OPTIONS,
};

const DEFAULT_SORT: SortSpec = { field: "id", direction: "desc" };

async function fetchPOPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
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
  serializeColumnFilters(qs, params.columnFilters);
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

export function PurchaseOrdersTable({ initialPage, locationFilters }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const filters = useMemo<FilterDef[]>(
    () => [STATUS_FILTER, ...(locationFilters ?? [])],
    [locationFilters],
  );

  const columns = useMemo<DataTableColumn<PurchaseOrder>[]>(
    () => [
      {
        id: "code",
        header: "PO",
        sortField: "id",
        widthClassName: "w-24",
        filterField: "id",
        filterKind: "text",
        filterPlaceholder: "PO00001…",
        group: "Identity",
        description: "Auto-numbered PO code (PO00001, …).",
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
        filterField: "vendor",
        filterKind: "text",
        filterPlaceholder: "Vendor name…",
        group: "Identity",
        description: "Supplier this PO is raised against. Filter by vendor name.",
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
        filterField: "status",
        filterKind: "select",
        filterOptions: STATUS_OPTIONS,
        group: "Status",
        description: "PO lifecycle state — draft → approved → ordered → received.",
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
        filterField: "grand_total",
        filterKind: "number-range",
        group: "Amounts",
        description: "Grand total (subtotal + tax + shipping + fees).",
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
        filterField: "expected_delivery_date",
        filterKind: "date-range",
        group: "Dates",
        description: "When goods are expected to arrive.",
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
        filterField: "submitted_at",
        filterKind: "date-range",
        group: "Dates",
        description: "When the PO was submitted for approval.",
        cell: (p) =>
          p.submitted_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(p.submitted_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "vendor_code",
        header: "Vendor code",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Identity",
        description: "Auto-numbered vendor code (VN00001, …).",
        cell: (p) =>
          p.vendor?.code ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {p.vendor.code}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "currency_code",
        header: "Currency",
        widthClassName: "w-20",
        defaultHidden: true,
        filterField: "currency_code",
        filterKind: "text",
        filterPlaceholder: "GBP…",
        group: "Amounts",
        description: "Currency this PO is denominated in.",
        cell: (p) => (
          <span className="font-mono text-xs">{p.currency_code}</span>
        ),
      },
      {
        id: "subtotal",
        header: "Subtotal",
        align: "right",
        widthClassName: "w-28",
        defaultHidden: true,
        filterField: "subtotal",
        filterKind: "number-range",
        group: "Amounts",
        description: "Sum of line subtotals before discount/tax/shipping.",
        cell: (p) => (
          <span className="font-mono text-xs">
            {formatCompanyMoney(p.subtotal, prefs, {
              currency_code: p.currency_code,
            })}
          </span>
        ),
      },
      {
        id: "tax_amount",
        header: "Tax",
        align: "right",
        widthClassName: "w-28",
        defaultHidden: true,
        filterField: "tax_amount",
        filterKind: "number-range",
        group: "Amounts",
        description: "Server-computed tax applied to (subtotal − discount).",
        cell: (p) => (
          <span className="font-mono text-xs text-muted-foreground">
            {formatCompanyMoney(p.tax_amount, prefs, {
              currency_code: p.currency_code,
            })}
          </span>
        ),
      },
      {
        id: "grand_total",
        header: "Grand total",
        align: "right",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "grand_total",
        filterKind: "number-range",
        group: "Amounts",
        description: "Final invoice-facing total.",
        cell: (p) => (
          <span className="font-mono text-xs">
            {formatCompanyMoney(p.grand_total, prefs, {
              currency_code: p.currency_code,
            })}
          </span>
        ),
      },
      {
        id: "warehouse",
        header: "Warehouse",
        widthClassName: "min-w-[10rem]",
        defaultHidden: true,
        group: "Location",
        description: "Default delivery warehouse for receiving.",
        cell: (p) =>
          p.default_warehouse ? (
            <span className="truncate text-xs text-muted-foreground">
              {p.default_warehouse.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "ordered_at",
        header: "Ordered",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "ordered_at",
        filterKind: "date-range",
        group: "Dates",
        description: "When the PO was placed with the supplier.",
        cell: (p) =>
          p.ordered_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(p.ordered_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "received_at",
        header: "Received",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "received_at",
        filterKind: "date-range",
        group: "Dates",
        description: "When goods were first received against this PO.",
        cell: (p) =>
          p.received_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(p.received_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "cancelled_at",
        header: "Cancelled",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "cancelled_at",
        filterKind: "date-range",
        group: "Dates",
        description: "When the PO was cancelled (if applicable).",
        cell: (p) =>
          p.cancelled_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(p.cancelled_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "inserted_at",
        header: "Created",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "inserted_at",
        filterKind: "date-range",
        group: "Meta",
        description: "When this PO row was created.",
        cell: (p) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(p.inserted_at, prefs)}
          </span>
        ),
      },
      {
        id: "updated_at",
        header: "Updated",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "updated_at",
        filterKind: "date-range",
        group: "Meta",
        description: "When this PO was last modified.",
        cell: (p) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(p.updated_at, prefs)}
          </span>
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
