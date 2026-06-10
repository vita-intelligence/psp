"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, ShieldX } from "lucide-react";
import { DataTable } from "@/components/data-table";
import type {
  DataTableColumn,
  FilterDef,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge-mini";
import type {
  Vendor,
  VendorApprovalStatus,
  VendorRisk,
} from "@/lib/types";
import { formatCompanyDate } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

interface VendorsTableProps {
  initialPage: PageResult<Vendor>;
  canCreate: boolean;
}

const DEFAULT_SORT: SortSpec = { field: "name", direction: "asc" };

const APPROVAL_LABEL: Record<VendorApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  suspended: "Suspended",
  rejected: "Rejected",
};

const APPROVAL_TONE: Record<
  VendorApprovalStatus,
  "emerald" | "amber" | "muted" | "destructive"
> = {
  approved: "emerald",
  pending: "amber",
  suspended: "muted",
  rejected: "destructive",
};

const APPROVAL_ICON: Record<VendorApprovalStatus, typeof CheckCircle2> = {
  approved: CheckCircle2,
  pending: CircleDashed,
  suspended: AlertTriangle,
  rejected: ShieldX,
};

const APPROVAL_FILTER: FilterDef = {
  field: "approval_status",
  label: "Status",
  options: (
    Object.keys(APPROVAL_LABEL) as VendorApprovalStatus[]
  ).map((s) => ({ label: APPROVAL_LABEL[s], value: s })),
};

const RISK_LABEL: Record<VendorRisk, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const RISK_TONE: Record<VendorRisk, "emerald" | "amber" | "destructive"> = {
  low: "emerald",
  medium: "amber",
  high: "destructive",
};

const RISK_FILTER: FilterDef = {
  field: "vendor_risk",
  label: "Risk",
  options: (Object.keys(RISK_LABEL) as VendorRisk[]).map((r) => ({
    label: RISK_LABEL[r],
    value: r,
  })),
};

const ACTIVE_FILTER: FilterDef = {
  field: "is_active",
  label: "Active",
  options: [
    { label: "Active", value: true },
    { label: "Inactive", value: false },
  ],
};

async function fetchVendorsPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  search: string;
}): Promise<PageResult<Vendor>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  for (const [k, v] of Object.entries(params.filters)) {
    qs.set(k, String(v));
  }

  const res = await fetch(`/api/vendors?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<Vendor>;
}

export function VendorsTable({ initialPage }: VendorsTableProps) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const filters = useMemo<FilterDef[]>(
    () => [APPROVAL_FILTER, RISK_FILTER, ACTIVE_FILTER],
    [],
  );

  const columns = useMemo<DataTableColumn<Vendor>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        widthClassName: "w-24",
        cell: (v) => (
          <span className="font-mono text-xs text-muted-foreground">
            {v.code ?? `#${v.id}`}
          </span>
        ),
      },
      {
        id: "name",
        header: "Vendor",
        sortField: "name",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        hideable: false,
        widthClassName: "min-w-[18rem]",
        cell: (v) => (
          <div className="min-w-0 space-y-1">
            <Link
              href={`/procurement/vendors/${v.uuid}`}
              className="block truncate text-sm font-medium hover:underline"
            >
              {v.name}
            </Link>
            {v.legal_name && v.legal_name !== v.name && (
              <p className="truncate text-[11px] text-muted-foreground">
                {v.legal_name}
              </p>
            )}
            {v.email && (
              <p className="truncate text-[11px] text-muted-foreground">
                {v.email}
              </p>
            )}
          </div>
        ),
      },
      {
        id: "approval_status",
        header: "Approval",
        sortField: "approval_status",
        widthClassName: "w-32",
        cell: (v) => {
          const Icon = APPROVAL_ICON[v.approval_status];
          return (
            <span
              className="inline-flex items-center gap-1.5"
              title={
                v.approved_at
                  ? `Approved ${formatCompanyDate(v.approved_at, prefs)}`
                  : APPROVAL_LABEL[v.approval_status]
              }
            >
              <Icon className="size-3.5 text-muted-foreground" />
              <Badge tone={APPROVAL_TONE[v.approval_status]}>
                {APPROVAL_LABEL[v.approval_status]}
              </Badge>
            </span>
          );
        },
      },
      {
        id: "vendor_risk",
        header: "Risk",
        sortField: "vendor_risk",
        widthClassName: "w-24",
        cell: (v) =>
          v.vendor_risk ? (
            <Badge tone={RISK_TONE[v.vendor_risk]}>
              {RISK_LABEL[v.vendor_risk]}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "supply_chain_type",
        header: "Type",
        widthClassName: "w-32",
        defaultHidden: true,
        cell: (v) =>
          v.supply_chain_type ? (
            <span className="text-xs capitalize">
              {v.supply_chain_type.replace(/_/g, " ")}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "next_review_at",
        header: "Next review",
        sortField: "next_review_at",
        widthClassName: "w-36",
        cell: (v) => {
          if (!v.next_review_at)
            return <span className="text-xs text-muted-foreground/50">—</span>;
          const dueMs = new Date(v.next_review_at).getTime();
          const days = Math.round(
            (dueMs - Date.now()) / (24 * 60 * 60 * 1000),
          );
          const overdue = days < 0;
          const soon = days >= 0 && days <= 30;
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
              {formatCompanyDate(v.next_review_at, prefs)}
            </span>
          );
        },
      },
      {
        id: "approved_items",
        header: "Approved items",
        align: "right",
        widthClassName: "w-32",
        cell: (v) => (
          <span className="text-sm">{v.approved_items?.length ?? 0}</span>
        ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<Vendor>
      tableId="vendors"
      columns={columns}
      rowKey={(v) => String(v.id)}
      fetchPage={fetchVendorsPage}
      initialPage={initialPage}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search by name, email, contact, batch…"
      filters={filters}
      onRowClick={(v) => router.push(`/procurement/vendors/${v.uuid}`)}
      renderMobileCard={(v) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{v.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {v.code ?? `#${v.id}`}
                {v.email ? ` · ${v.email}` : ""}
              </p>
            </div>
            <Badge tone={APPROVAL_TONE[v.approval_status]}>
              {APPROVAL_LABEL[v.approval_status]}
            </Badge>
          </div>
          {v.vendor_risk && (
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={RISK_TONE[v.vendor_risk]}>
                {RISK_LABEL[v.vendor_risk]} risk
              </Badge>
            </div>
          )}
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No vendors yet</p>
          <p className="text-xs text-muted-foreground">
            Add your first supplier before raising a PO.
          </p>
        </div>
      }
    />
  );
}
