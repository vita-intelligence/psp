"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Coins,
  Send,
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
import type { CustomerInvoice, CustomerInvoiceStatus } from "@/lib/types";
import { formatCompanyDate, formatCompanyNumber } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

interface Props {
  initialPage: PageResult<CustomerInvoice>;
}

const DEFAULT_SORT: SortSpec = { field: "invoice_date", direction: "desc" };

const STATUS_LABEL: Record<CustomerInvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<
  CustomerInvoiceStatus,
  "emerald" | "amber" | "sky" | "muted" | "destructive"
> = {
  draft: "muted",
  sent: "amber",
  partially_paid: "sky",
  paid: "emerald",
  cancelled: "destructive",
};

const STATUS_ICON: Record<CustomerInvoiceStatus, typeof CircleDashed> = {
  draft: CircleDashed,
  sent: Send,
  partially_paid: Coins,
  paid: CheckCircle2,
  cancelled: ShieldX,
};

const STATUS_FILTER: FilterDef = {
  field: "status",
  label: "Status",
  options: (Object.keys(STATUS_LABEL) as CustomerInvoiceStatus[]).map((s) => ({
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
}): Promise<PageResult<CustomerInvoice>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort) qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  for (const [k, v] of Object.entries(params.filters)) qs.set(k, String(v));

  const res = await fetch(`/api/customer-invoices?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<CustomerInvoice>;
}

export function InvoicesTable({ initialPage }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const filters = useMemo<FilterDef[]>(() => [STATUS_FILTER], []);

  const columns = useMemo<DataTableColumn<CustomerInvoice>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        widthClassName: "w-24",
        cell: (inv) => (
          <span className="font-mono text-xs text-muted-foreground">
            {inv.code ?? `#${inv.id}`}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        sortField: "status",
        widthClassName: "w-36",
        cell: (inv) => {
          const Icon = STATUS_ICON[inv.status];
          return (
            <span className="inline-flex items-center gap-1.5">
              <Icon className="size-3.5 text-muted-foreground" />
              <Badge tone={STATUS_TONE[inv.status]}>{STATUS_LABEL[inv.status]}</Badge>
            </span>
          );
        },
      },
      {
        id: "customer",
        header: "Customer",
        hideable: false,
        widthClassName: "min-w-[16rem]",
        cell: (inv) => (
          <div className="min-w-0">
            <Link
              href={`/sales/invoices/${inv.uuid}`}
              className="block truncate text-sm font-medium hover:underline"
            >
              {inv.customer?.name ?? "—"}
            </Link>
            {inv.customer_order && (
              <p className="truncate text-[11px] text-muted-foreground">
                from {inv.customer_order.code ?? `#${inv.customer_order.id}`}
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
        cell: (inv) => (
          <span className="font-mono text-sm">
            {formatCompanyNumber(inv.grand_total, prefs)} {inv.currency_code}
          </span>
        ),
      },
      {
        id: "outstanding",
        header: "Outstanding",
        widthClassName: "w-32",
        align: "right",
        cell: (inv) => {
          const o = Number(inv.outstanding);
          if (inv.status === "paid" || inv.status === "cancelled" || o <= 0) {
            return <span className="text-xs text-muted-foreground/60">—</span>;
          }
          return (
            <span className="font-mono text-sm font-medium">
              {formatCompanyNumber(inv.outstanding, prefs)} {inv.currency_code}
            </span>
          );
        },
      },
      {
        id: "invoice_date",
        header: "Issued",
        sortField: "invoice_date",
        widthClassName: "w-28",
        cell: (inv) => (
          <span className="text-sm">
            {formatCompanyDate(inv.invoice_date, prefs)}
          </span>
        ),
      },
      {
        id: "due_date",
        header: "Due",
        sortField: "due_date",
        widthClassName: "w-32",
        cell: (inv) => {
          if (!inv.due_date)
            return <span className="text-xs text-muted-foreground/50">—</span>;
          const due = new Date(inv.due_date).getTime();
          const days = Math.round((due - Date.now()) / (24 * 60 * 60 * 1000));
          const isOpen =
            inv.status === "sent" || inv.status === "partially_paid";
          const overdue = isOpen && days < 0;
          const soon = isOpen && days >= 0 && days <= 7;
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
              {formatCompanyDate(inv.due_date, prefs)}
              {overdue && <AlertTriangle className="ml-1 inline size-3" />}
            </span>
          );
        },
      },
    ],
    [prefs],
  );

  return (
    <DataTable<CustomerInvoice>
      tableId="customer-invoices"
      columns={columns}
      rowKey={(inv) => String(inv.id)}
      fetchPage={fetchPage}
      initialPage={initialPage}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search by reference, billing address, free text…"
      filters={filters}
      onRowClick={(inv) => router.push(`/sales/invoices/${inv.uuid}`)}
      renderMobileCard={(inv) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {inv.customer?.name ?? "—"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {inv.code ?? `#${inv.id}`} ·{" "}
                {formatCompanyNumber(inv.grand_total, prefs)} {inv.currency_code}
              </p>
            </div>
            <Badge tone={STATUS_TONE[inv.status]}>{STATUS_LABEL[inv.status]}</Badge>
          </div>
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No invoices yet</p>
          <p className="text-xs text-muted-foreground">
            Confirm a customer order and click <strong>Generate invoice</strong> to start the order-to-cash flow.
          </p>
        </div>
      }
    />
  );
}
