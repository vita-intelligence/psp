"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Send,
  ShieldCheck,
  ShieldX,
  Truck,
} from "lucide-react";
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
import type { CustomerOrder, CustomerOrderStatus } from "@/lib/types";
import { formatCompanyDate, formatCompanyNumber } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

interface Props {
  initialPage: PageResult<CustomerOrder>;
}

const DEFAULT_SORT: SortSpec = { field: "inserted_at", direction: "desc" };

const STATUS_LABEL: Record<CustomerOrderStatus, string> = {
  draft: "Draft",
  pending_approver: "Awaiting approver",
  pending_director: "Awaiting director",
  approved: "Approved",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<
  CustomerOrderStatus,
  "emerald" | "amber" | "sky" | "muted" | "destructive"
> = {
  draft: "muted",
  pending_approver: "amber",
  pending_director: "amber",
  approved: "sky",
  confirmed: "emerald",
  cancelled: "destructive",
};

const STATUS_ICON: Record<CustomerOrderStatus, typeof CircleDashed> = {
  draft: CircleDashed,
  pending_approver: Send,
  pending_director: ShieldCheck,
  approved: CheckCircle2,
  confirmed: Truck,
  cancelled: ShieldX,
};

const STATUS_FILTER: FilterDef = {
  field: "status",
  label: "Status",
  options: (Object.keys(STATUS_LABEL) as CustomerOrderStatus[]).map((s) => ({
    label: STATUS_LABEL[s],
    value: s,
  })),
};

async function fetchPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<CustomerOrder>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort) qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  for (const [k, v] of Object.entries(params.filters)) qs.set(k, String(v));
  serializeColumnFilters(qs, params.columnFilters);

  const res = await fetch(`/api/customer-orders?${qs.toString()}`, {
    cache: "no-store",
  });
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
  return (await res.json()) as PageResult<CustomerOrder>;
}

export function CustomerOrdersTable({ initialPage }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const filters = useMemo<FilterDef[]>(() => [STATUS_FILTER], []);

  const columns = useMemo<DataTableColumn<CustomerOrder>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        widthClassName: "w-24",
        cell: (co) => (
          <span className="font-mono text-xs text-muted-foreground">
            {co.code ?? `#${co.id}`}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        sortField: "status",
        widthClassName: "w-44",
        cell: (co) => {
          const Icon = STATUS_ICON[co.status];
          return (
            <span className="inline-flex items-center gap-1.5">
              <Icon className="size-3.5 text-muted-foreground" />
              <Badge tone={STATUS_TONE[co.status]}>{STATUS_LABEL[co.status]}</Badge>
            </span>
          );
        },
      },
      {
        id: "customer",
        header: "Customer",
        hideable: false,
        widthClassName: "min-w-[16rem]",
        cell: (co) => (
          <div className="min-w-0">
            <Link
              href={`/sales/orders/${co.uuid}`}
              className="block truncate text-sm font-medium hover:underline"
            >
              {co.customer?.name ?? "—"}
            </Link>
            {co.customer_reference && (
              <p className="truncate text-[11px] text-muted-foreground">
                Ref: {co.customer_reference}
              </p>
            )}
          </div>
        ),
      },
      {
        id: "grand_total",
        header: "Total",
        sortField: "grand_total",
        widthClassName: "w-32",
        align: "right",
        cell: (co) => (
          <span className="font-mono text-sm">
            {formatCompanyNumber(co.grand_total, prefs)} {co.currency_code}
          </span>
        ),
      },
      {
        id: "expected_ship_date",
        header: "Ship by",
        sortField: "expected_ship_date",
        widthClassName: "w-32",
        cell: (co) => {
          if (!co.expected_ship_date)
            return <span className="text-xs text-muted-foreground/50">—</span>;
          const due = new Date(co.expected_ship_date).getTime();
          const days = Math.round((due - Date.now()) / (24 * 60 * 60 * 1000));
          const overdue = days < 0 && co.status !== "confirmed" && co.status !== "cancelled";
          const soon = days >= 0 && days <= 3;
          return (
            <span
              className={
                overdue
                  ? "text-sm font-medium text-destructive"
                  : soon
                    ? "text-sm font-medium text-amber-700 dark:text-amber-400"
                    : "text-sm"
              }
            >
              {formatCompanyDate(co.expected_ship_date, prefs)}
              {overdue && (
                <AlertTriangle className="ml-1 inline size-3" />
              )}
            </span>
          );
        },
      },
      {
        id: "lines_count",
        header: "Lines",
        widthClassName: "w-16",
        align: "right",
        defaultHidden: true,
        cell: (co) => <span className="text-sm">{co.lines.length}</span>,
      },
    ],
    [prefs],
  );

  return (
    <DataTable<CustomerOrder>
      tableId="customer-orders"
      columns={columns}
      rowKey={(co) => String(co.id)}
      fetchPage={fetchPage}
      initialPage={initialPage}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search by reference, delivery address, notes…"
      filters={filters}
      onRowClick={(co) => router.push(`/sales/orders/${co.uuid}`)}
      renderMobileCard={(co) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {co.customer?.name ?? "—"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {co.code ?? `#${co.id}`} ·{" "}
                {formatCompanyNumber(co.grand_total, prefs)} {co.currency_code}
              </p>
            </div>
            <Badge tone={STATUS_TONE[co.status]}>{STATUS_LABEL[co.status]}</Badge>
          </div>
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No customer orders yet</p>
          <p className="text-xs text-muted-foreground">
            Create the first one — your customer + pricelist setup is
            already wired in.
          </p>
        </div>
      }
    />
  );
}
