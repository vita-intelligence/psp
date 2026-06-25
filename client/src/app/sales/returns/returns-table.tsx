"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  PackageOpen,
  ShieldX,
} from "lucide-react";
import { DataTable } from "@/components/data-table";
import type {
  DataTableColumn,
  FilterDef,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge-mini";
import type { CustomerReturn, CustomerReturnStatus } from "@/lib/types";
import { formatCompanyDate } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

interface Props {
  initialPage: PageResult<CustomerReturn>;
}

const DEFAULT_SORT: SortSpec = { field: "return_date", direction: "desc" };

const STATUS_LABEL: Record<CustomerReturnStatus, string> = {
  draft: "Draft",
  received: "Received",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<
  CustomerReturnStatus,
  "emerald" | "amber" | "sky" | "muted" | "destructive"
> = {
  draft: "muted",
  received: "sky",
  accepted: "emerald",
  rejected: "destructive",
  cancelled: "muted",
};

const STATUS_ICON: Record<CustomerReturnStatus, typeof CircleDashed> = {
  draft: CircleDashed,
  received: PackageOpen,
  accepted: CheckCircle2,
  rejected: ShieldX,
  cancelled: Ban,
};

const STATUS_FILTER: FilterDef = {
  field: "status",
  label: "Status",
  options: (Object.keys(STATUS_LABEL) as CustomerReturnStatus[]).map((s) => ({
    label: STATUS_LABEL[s],
    value: s,
  })),
};

async function fetchPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  search: string;
}): Promise<PageResult<CustomerReturn>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort) qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  for (const [k, v] of Object.entries(params.filters)) qs.set(k, String(v));

  const res = await fetch(`/api/customer-returns?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<CustomerReturn>;
}

export function ReturnsTable({ initialPage }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const filters = useMemo<FilterDef[]>(() => [STATUS_FILTER], []);

  const columns = useMemo<DataTableColumn<CustomerReturn>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        widthClassName: "w-24",
        cell: (rma) => (
          <span className="font-mono text-xs text-muted-foreground">
            {rma.code ?? `#${rma.id}`}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        sortField: "status",
        widthClassName: "w-32",
        cell: (rma) => {
          const Icon = STATUS_ICON[rma.status];
          return (
            <span className="inline-flex items-center gap-1.5">
              <Icon className="size-3.5 text-muted-foreground" />
              <Badge tone={STATUS_TONE[rma.status]}>{STATUS_LABEL[rma.status]}</Badge>
            </span>
          );
        },
      },
      {
        id: "customer",
        header: "Customer",
        hideable: false,
        widthClassName: "min-w-[16rem]",
        cell: (rma) => (
          <div className="min-w-0">
            <Link
              href={`/sales/returns/${rma.uuid}`}
              className="block truncate text-sm font-medium hover:underline"
            >
              {rma.customer?.name ?? "—"}
            </Link>
            {rma.customer_invoice && (
              <p className="truncate text-[11px] text-muted-foreground">
                vs {rma.customer_invoice.code ?? `#${rma.customer_invoice.id}`}
              </p>
            )}
          </div>
        ),
      },
      {
        id: "lines",
        header: "Lines",
        widthClassName: "w-20",
        align: "right",
        cell: (rma) => (
          <span className="font-mono text-sm">{rma.lines.length}</span>
        ),
      },
      {
        id: "return_date",
        header: "Return date",
        sortField: "return_date",
        widthClassName: "w-32",
        cell: (rma) => (
          <span className="text-sm">
            {formatCompanyDate(rma.return_date, prefs)}
          </span>
        ),
      },
      {
        id: "reason_summary",
        header: "Reason",
        widthClassName: "min-w-[14rem]",
        cell: (rma) =>
          rma.reason_summary ? (
            <span className="line-clamp-1 text-sm text-muted-foreground">
              {rma.reason_summary}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<CustomerReturn>
      tableId="customer-returns"
      columns={columns}
      rowKey={(rma) => String(rma.id)}
      fetchPage={fetchPage}
      initialPage={initialPage}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search by reason, notes, customer reference…"
      filters={filters}
      onRowClick={(rma) => router.push(`/sales/returns/${rma.uuid}`)}
      renderMobileCard={(rma) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {rma.customer?.name ?? "—"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {rma.code ?? `#${rma.id}`} ·{" "}
                {formatCompanyDate(rma.return_date, prefs)}
              </p>
            </div>
            <Badge tone={STATUS_TONE[rma.status]}>{STATUS_LABEL[rma.status]}</Badge>
          </div>
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No RMAs yet</p>
          <p className="text-xs text-muted-foreground">
            Customer returns start here — open an invoice and create the RMA
            against it, or start standalone from <strong>New RMA</strong>.
          </p>
        </div>
      }
    />
  );
}
