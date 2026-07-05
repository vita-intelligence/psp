"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Sparkles,
  UserPlus,
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
  Customer,
  CustomerApprovalStatus,
  CustomerStatus,
} from "@/lib/types";
import { formatCompanyDate, formatCompanyNumber } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

interface CustomersTableProps {
  initialPage: PageResult<Customer>;
}

const DEFAULT_SORT: SortSpec = { field: "name", direction: "asc" };

const APPROVAL_LABEL: Record<CustomerApprovalStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  suspended: "Suspended",
  rejected: "Rejected",
};

const APPROVAL_TONE: Record<
  CustomerApprovalStatus,
  "emerald" | "amber" | "muted" | "destructive"
> = {
  approved: "emerald",
  draft: "amber",
  suspended: "muted",
  rejected: "destructive",
};

const APPROVAL_ICON: Record<CustomerApprovalStatus, typeof CheckCircle2> = {
  approved: CheckCircle2,
  draft: CircleDashed,
  suspended: AlertTriangle,
  rejected: AlertTriangle,
};

const APPROVAL_OPTIONS = (
  Object.keys(APPROVAL_LABEL) as CustomerApprovalStatus[]
).map((s) => ({ label: APPROVAL_LABEL[s], value: s }));

const APPROVAL_FILTER: FilterDef = {
  field: "approval_status",
  label: "Approval",
  options: APPROVAL_OPTIONS,
};

const STATUS_LABEL: Record<CustomerStatus, string> = {
  lead: "Lead",
  prospect: "Prospect",
  active: "Active",
  dormant: "Dormant",
  inactive: "Inactive",
};

const STATUS_TONE: Record<
  CustomerStatus,
  "emerald" | "amber" | "sky" | "muted" | "destructive"
> = {
  lead: "sky",
  prospect: "amber",
  active: "emerald",
  dormant: "muted",
  inactive: "destructive",
};

const ACTIVE_FILTER: FilterDef = {
  field: "is_active",
  label: "Active",
  options: [
    { label: "Active", value: true },
    { label: "Inactive", value: false },
  ],
};

const PAYMENT_BASIS_OPTIONS = [
  { label: "Invoice date", value: "invoice_date" },
  { label: "Dispatch date", value: "dispatch_date" },
  { label: "Month end", value: "month_end" },
];

async function fetchCustomersPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<Customer>> {
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

  const res = await fetch(`/api/customers?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<Customer>;
}

export function CustomersTable({ initialPage }: CustomersTableProps) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const filters = useMemo<FilterDef[]>(
    () => [APPROVAL_FILTER, ACTIVE_FILTER],
    [],
  );

  const columns = useMemo<DataTableColumn<Customer>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        widthClassName: "w-24",
        filterField: "id",
        filterKind: "text",
        filterPlaceholder: "C00001…",
        group: "Identity",
        description: "Auto-numbered customer code.",
        cell: (c) => (
          <span className="font-mono text-xs text-muted-foreground">
            {c.code ?? `#${c.id}`}
          </span>
        ),
      },
      {
        id: "name",
        header: "Customer",
        sortField: "name",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        hideable: false,
        widthClassName: "min-w-[18rem]",
        filterField: "name",
        filterKind: "text",
        filterPlaceholder: "Customer name…",
        group: "Identity",
        description: "Trading name shown across the app.",
        cell: (c) => (
          <div className="min-w-0 space-y-1">
            <Link
              href={`/sales/customers/${c.uuid}`}
              className="block truncate text-sm font-medium hover:underline"
            >
              {c.name}
            </Link>
            {c.legal_name && c.legal_name !== c.name && (
              <p className="truncate text-[11px] text-muted-foreground">
                {c.legal_name}
              </p>
            )}
            {c.country_code && (
              <p className="truncate text-[11px] text-muted-foreground">
                {c.country_code}
              </p>
            )}
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        widthClassName: "w-28",
        group: "Status",
        description: "Read-time customer lifecycle projection (lead / prospect / active / dormant / inactive).",
        cell: (c) => (
          <Badge tone={STATUS_TONE[c.status]}>
            {STATUS_LABEL[c.status]}
          </Badge>
        ),
      },
      {
        id: "approval_status",
        header: "Approval",
        sortField: "approval_status",
        widthClassName: "w-32",
        filterField: "approval_status",
        filterKind: "select",
        filterOptions: APPROVAL_OPTIONS,
        group: "Compliance",
        description: "Qualification lifecycle. Only approved customers can back a CO.",
        cell: (c) => {
          const eff = c.effective_approval_status;
          const Icon = APPROVAL_ICON[eff];
          const overdue =
            c.effective_approval_reason === "re_qualification_overdue";
          const inactive = c.effective_approval_reason === "inactive";
          const title = overdue
            ? "Re-qualification overdue — was approved, now effectively suspended"
            : inactive
              ? "Inactive — manually disabled"
              : c.approved_at
                ? `Approved ${formatCompanyDate(c.approved_at, prefs)}`
                : APPROVAL_LABEL[eff];
          return (
            <span
              className="inline-flex items-center gap-1.5"
              title={title}
            >
              <Icon className="size-3.5 text-muted-foreground" />
              <Badge tone={APPROVAL_TONE[eff]}>
                {APPROVAL_LABEL[eff]}
                {overdue && " *"}
              </Badge>
            </span>
          );
        },
      },
      {
        id: "account_manager",
        header: "Account manager",
        widthClassName: "w-40",
        group: "Meta",
        description: "Salesperson assigned to this customer.",
        cell: (c) =>
          c.account_manager ? (
            <span className="text-sm">{c.account_manager.name}</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60">
              <UserPlus className="size-3" />
              Unassigned
            </span>
          ),
      },
      {
        id: "last_contact_at",
        header: "Last contact",
        sortField: "last_contact_at",
        widthClassName: "w-32",
        filterField: "last_contact_at",
        filterKind: "date-range",
        group: "Dates",
        description: "Most recent logged contact event.",
        cell: (c) =>
          c.last_contact_at ? (
            <span className="text-sm">
              {formatCompanyDate(c.last_contact_at, prefs)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60">
              <Sparkles className="size-3" />
              No contact
            </span>
          ),
      },
      {
        id: "next_contact_at",
        header: "Next contact",
        sortField: "next_contact_at",
        widthClassName: "w-32",
        filterField: "next_contact_at",
        filterKind: "date-range",
        group: "Dates",
        description: "Next scheduled follow-up (cadence-driven).",
        cell: (c) => {
          if (!c.next_contact_at)
            return <span className="text-xs text-muted-foreground/50">—</span>;
          const dueMs = new Date(c.next_contact_at).getTime();
          const days = Math.round(
            (dueMs - Date.now()) / (24 * 60 * 60 * 1000),
          );
          const overdue = days < 0;
          const soon = days >= 0 && days <= 7;
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
              {formatCompanyDate(c.next_contact_at, prefs)}
            </span>
          );
        },
      },
      // ---- defaultHidden columns below ----
      {
        id: "legal_name",
        header: "Legal name",
        widthClassName: "min-w-[14rem]",
        defaultHidden: true,
        filterField: "legal_name",
        filterKind: "text",
        filterPlaceholder: "Legal entity…",
        group: "Identity",
        description: "Registered legal entity (used on COs + invoices).",
        cell: (c) =>
          c.legal_name ? (
            <span className="truncate text-xs">{c.legal_name}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "country_code",
        header: "Country",
        widthClassName: "w-24",
        defaultHidden: true,
        sortField: "country_code",
        filterField: "country_code",
        filterKind: "text",
        filterPlaceholder: "GB…",
        group: "Location",
        description: "ISO 3166-1 alpha-2 country code.",
        cell: (c) =>
          c.country_code ? (
            <span className="font-mono text-xs">{c.country_code}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
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
        description: "Default currency this customer trades in.",
        cell: (c) => (
          <span className="font-mono text-xs">{c.currency_code}</span>
        ),
      },
      {
        id: "payment_terms_days",
        header: "Terms (d)",
        widthClassName: "w-24",
        align: "right",
        defaultHidden: true,
        sortField: "payment_terms_days",
        filterField: "payment_terms_days",
        filterKind: "number-range",
        group: "Amounts",
        description: "Payment terms in days.",
        cell: (c) => (
          <span className="font-mono text-xs">{c.payment_terms_days}</span>
        ),
      },
      {
        id: "payment_terms_basis",
        header: "Terms basis",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "payment_terms_basis",
        filterKind: "select",
        filterOptions: PAYMENT_BASIS_OPTIONS,
        group: "Amounts",
        description: "Base date the payment window counts from.",
        cell: (c) => (
          <span className="text-xs capitalize">
            {c.payment_terms_basis.replace(/_/g, " ")}
          </span>
        ),
      },
      {
        id: "trade_credit_limit",
        header: "Credit limit",
        widthClassName: "w-32",
        align: "right",
        defaultHidden: true,
        sortField: "trade_credit_limit",
        filterField: "trade_credit_limit",
        filterKind: "number-range",
        group: "Amounts",
        description: "Maximum outstanding trade credit permitted.",
        cell: (c) =>
          c.trade_credit_limit ? (
            <span className="font-mono text-xs">
              {formatCompanyNumber(c.trade_credit_limit, prefs)} {c.currency_code}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "total_orders_count",
        header: "Orders",
        align: "right",
        widthClassName: "w-20",
        defaultHidden: true,
        sortField: "total_orders_count",
        filterField: "total_orders_count",
        filterKind: "number-range",
        group: "Amounts",
        description: "Total customer orders placed to date.",
        cell: (c) => (
          <span className="text-sm">{c.total_orders_count}</span>
        ),
      },
      {
        id: "first_order_at",
        header: "First order",
        widthClassName: "w-32",
        defaultHidden: true,
        sortField: "first_order_at",
        filterField: "first_order_at",
        filterKind: "date-range",
        group: "Dates",
        description: "When the first order was placed.",
        cell: (c) =>
          c.first_order_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(c.first_order_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "last_order_at",
        header: "Last order",
        widthClassName: "w-32",
        defaultHidden: true,
        sortField: "last_order_at",
        filterField: "last_order_at",
        filterKind: "date-range",
        group: "Dates",
        description: "When the most recent order was placed.",
        cell: (c) =>
          c.last_order_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(c.last_order_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "approved_at",
        header: "Approved at",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Compliance",
        description: "When this customer was last approved.",
        cell: (c) =>
          c.approved_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(c.approved_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "next_review_at",
        header: "Next review",
        widthClassName: "w-32",
        defaultHidden: true,
        sortField: "next_review_at",
        filterField: "next_review_at",
        filterKind: "date-range",
        group: "Compliance",
        description: "Next scheduled re-qualification review.",
        cell: (c) =>
          c.next_review_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(c.next_review_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "is_active",
        header: "Active",
        widthClassName: "w-20",
        defaultHidden: true,
        filterField: "is_active",
        filterKind: "boolean",
        group: "Status",
        description: "Whether this customer is currently active.",
        cell: (c) => (
          <Badge tone={c.is_active ? "emerald" : "muted"}>
            {c.is_active ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      ...auditColumns<Customer>(),
    ],
    [prefs],
  );

  return (
    <DataTable<Customer>
      tableId="customers"
      columns={columns}
      rowKey={(c) => String(c.id)}
      fetchPage={fetchCustomersPage}
      initialPage={initialPage}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search by name, legal name, contact, tax #…"
      filters={filters}
      onRowClick={(c) => router.push(`/sales/customers/${c.uuid}`)}
      renderMobileCard={(c) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{c.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {c.code ?? `#${c.id}`}
                {c.country_code ? ` · ${c.country_code}` : ""}
              </p>
            </div>
            <Badge tone={APPROVAL_TONE[c.effective_approval_status]}>
              {APPROVAL_LABEL[c.effective_approval_status]}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={STATUS_TONE[c.status]}>
              {STATUS_LABEL[c.status]}
            </Badge>
            {c.account_manager && (
              <span className="text-[11px] text-muted-foreground">
                AM: {c.account_manager.name}
              </span>
            )}
          </div>
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No customers yet</p>
          <p className="text-xs text-muted-foreground">
            Add your first customer before raising a sales order.
          </p>
        </div>
      }
    />
  );
}
