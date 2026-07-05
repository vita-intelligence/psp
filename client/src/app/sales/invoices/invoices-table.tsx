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
  ColumnFilterValue,
  DataTableColumn,
  FilterDef,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { serializeColumnFilters } from "@/lib/data-table/serialize";
import { Badge } from "@/components/ui/badge-mini";
import { auditColumns } from "@/components/audit/audit-table-columns";
import type {
  CustomerInvoice,
  CustomerInvoiceKind,
  CustomerInvoiceStatus,
} from "@/lib/types";
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

const STATUS_OPTIONS = (
  Object.keys(STATUS_LABEL) as CustomerInvoiceStatus[]
).map((s) => ({ label: STATUS_LABEL[s], value: s }));

const STATUS_FILTER: FilterDef = {
  field: "status",
  label: "Status",
  options: STATUS_OPTIONS,
};

const KIND_LABEL: Record<CustomerInvoiceKind, string> = {
  invoice: "Invoice",
  proforma: "Proforma",
  credit_note: "Credit note",
  quotation: "Quotation",
};

const KIND_OPTIONS = (
  Object.keys(KIND_LABEL) as CustomerInvoiceKind[]
).map((k) => ({ label: KIND_LABEL[k], value: k }));

async function fetchPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<CustomerInvoice>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort) qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  for (const [k, v] of Object.entries(params.filters)) qs.set(k, String(v));
  serializeColumnFilters(qs, params.columnFilters);

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
        filterField: "id",
        filterKind: "text",
        filterPlaceholder: "INV00001…",
        group: "Identity",
        description: "Auto-numbered invoice code (kind-specific sequence).",
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
        filterField: "status",
        filterKind: "select",
        filterOptions: STATUS_OPTIONS,
        group: "Status",
        description: "Invoice lifecycle — computed from send + payment events.",
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
        group: "Identity",
        description: "Customer being billed.",
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
        filterField: "grand_total",
        filterKind: "number-range",
        group: "Amounts",
        description: "Grand total (subtotal + tax − discount).",
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
        group: "Amounts",
        description: "Grand total minus paid amount.",
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
        filterField: "invoice_date",
        filterKind: "date-range",
        group: "Dates",
        description: "Invoice issue date.",
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
        filterField: "due_date",
        filterKind: "date-range",
        group: "Dates",
        description: "Payment due date.",
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
      // ---- defaultHidden columns below ----
      {
        id: "kind",
        header: "Kind",
        widthClassName: "w-32",
        defaultHidden: true,
        sortField: "kind",
        filterField: "kind",
        filterKind: "select",
        filterOptions: KIND_OPTIONS,
        group: "Identity",
        description: "Invoice / proforma / credit note / quotation.",
        cell: (inv) => (
          <Badge tone="muted">{KIND_LABEL[inv.kind]}</Badge>
        ),
      },
      {
        id: "currency_code",
        header: "Currency",
        widthClassName: "w-20",
        defaultHidden: true,
        sortField: "currency_code",
        filterField: "currency_code",
        filterKind: "text",
        filterPlaceholder: "GBP…",
        group: "Amounts",
        description: "Currency this invoice is denominated in.",
        cell: (inv) => (
          <span className="font-mono text-xs">{inv.currency_code}</span>
        ),
      },
      {
        id: "subtotal",
        header: "Subtotal",
        align: "right",
        widthClassName: "w-28",
        defaultHidden: true,
        sortField: "subtotal",
        filterField: "subtotal",
        filterKind: "number-range",
        group: "Amounts",
        description: "Sum of line subtotals before tax + discount.",
        cell: (inv) => (
          <span className="font-mono text-xs">
            {formatCompanyNumber(inv.subtotal, prefs)}
          </span>
        ),
      },
      {
        id: "tax_amount",
        header: "Tax",
        align: "right",
        widthClassName: "w-28",
        defaultHidden: true,
        sortField: "tax_amount",
        filterField: "tax_amount",
        filterKind: "number-range",
        group: "Amounts",
        description: "Server-computed tax on the invoice.",
        cell: (inv) => (
          <span className="font-mono text-xs text-muted-foreground">
            {formatCompanyNumber(inv.tax_amount, prefs)}
          </span>
        ),
      },
      {
        id: "discount_amount",
        header: "Discount",
        align: "right",
        widthClassName: "w-28",
        defaultHidden: true,
        group: "Amounts",
        description: "Total discount applied.",
        cell: (inv) => (
          <span className="font-mono text-xs text-muted-foreground">
            {formatCompanyNumber(inv.discount_amount, prefs)}
          </span>
        ),
      },
      {
        id: "paid_amount",
        header: "Paid",
        align: "right",
        widthClassName: "w-28",
        defaultHidden: true,
        group: "Amounts",
        description: "Amount received against this invoice.",
        cell: (inv) => (
          <span className="font-mono text-xs">
            {formatCompanyNumber(inv.paid_amount, prefs)}
          </span>
        ),
      },
      {
        id: "customer_reference",
        header: "Cust. ref.",
        widthClassName: "min-w-[10rem]",
        defaultHidden: true,
        filterField: "customer_reference",
        filterKind: "text",
        filterPlaceholder: "PO reference…",
        group: "Identity",
        description: "Customer's own PO reference for this invoice.",
        cell: (inv) =>
          inv.customer_reference ? (
            <span className="truncate text-xs">{inv.customer_reference}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "sent_at",
        header: "Sent at",
        widthClassName: "w-32",
        defaultHidden: true,
        sortField: "sent_at",
        filterField: "sent_at",
        filterKind: "date-range",
        group: "Dates",
        description: "When this invoice was sent to the customer.",
        cell: (inv) =>
          inv.sent_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(inv.sent_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "cancelled_at",
        header: "Cancelled at",
        widthClassName: "w-32",
        defaultHidden: true,
        sortField: "cancelled_at",
        filterField: "cancelled_at",
        filterKind: "date-range",
        group: "Dates",
        description: "When this invoice was cancelled (if applicable).",
        cell: (inv) =>
          inv.cancelled_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(inv.cancelled_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "lines_count",
        header: "Lines",
        widthClassName: "w-16",
        align: "right",
        defaultHidden: true,
        group: "Amounts",
        description: "Number of line items on this invoice.",
        cell: (inv) => (
          <span className="text-sm">{inv.lines.length}</span>
        ),
      },
      ...auditColumns<CustomerInvoice>(),
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
