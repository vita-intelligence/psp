"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Users2 } from "lucide-react";
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
import {
  formatCompanyDate,
  formatCompanyMoney,
} from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type {
  HREmployeeLedgerPage,
  HREmployeeSummary,
} from "@/lib/hr/types";

interface Props {
  initialPage: HREmployeeLedgerPage;
}

const DEFAULT_SORT: SortSpec = { field: "inserted_at", direction: "desc" };

const IS_ACTIVE_FILTER: FilterDef = {
  field: "is_active",
  label: "Active",
  options: [
    { label: "Active only", value: "true" },
    { label: "Archived only", value: "false" },
  ],
};

const IS_QA_FILTER: FilterDef = {
  field: "is_qa",
  label: "QA sign-off",
  options: [
    { label: "QA-signers only", value: "true" },
    { label: "Non-QA only", value: "false" },
  ],
};

const BOOL_OPTIONS = [
  { label: "Yes", value: true },
  { label: "No", value: false },
];

async function fetchPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<HREmployeeSummary>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  for (const [k, v] of Object.entries(params.filters)) {
    qs.set(`filter[${k}]`, String(v));
  }
  serializeColumnFilters(qs, params.columnFilters);
  const res = await fetch(`/api/hr/employees?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<HREmployeeSummary>;
}

/** Human colour band for the reputation score. Same three-tier
 *  bucketing vita-performance uses on its own dashboard so operators
 *  see the same signal in both places. */
function scoreTone(score: number): "emerald" | "amber" | "destructive" | "muted" {
  if (score >= 720) return "emerald";
  if (score >= 620) return "muted";
  if (score >= 500) return "amber";
  return "destructive";
}

export function HREmployeesLedger({ initialPage }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const filters = useMemo<FilterDef[]>(
    () => [IS_ACTIVE_FILTER, IS_QA_FILTER],
    [],
  );

  const columns = useMemo<DataTableColumn<HREmployeeSummary>[]>(
    () => [
      {
        id: "code",
        header: "Number",
        widthClassName: "w-28",
        group: "Identity",
        description: "Employee number / rendered display code.",
        cell: (e) => (
          <span className="font-mono text-xs font-semibold">
            {e.code ?? e.employee_number ?? `#${e.id}`}
          </span>
        ),
      },
      {
        id: "name",
        header: "Name",
        sortField: "full_name",
        filterField: "full_name",
        filterKind: "text",
        filterPlaceholder: "Full name…",
        widthClassName: "min-w-[16rem]",
        group: "Identity",
        description: "Full legal name (kiosk PIN roster reads this).",
        cell: (e) => (
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm font-medium">{e.full_name}</span>
            {e.preferred_name && (
              <span className="truncate text-xs text-muted-foreground">
                ({e.preferred_name})
              </span>
            )}
            {!e.is_active && <Badge tone="muted">Archived</Badge>}
            {e.is_qa && <Badge tone="emerald">QA</Badge>}
          </div>
        ),
      },
      {
        id: "email",
        header: "Email",
        sortField: "email",
        filterField: "email",
        filterKind: "text",
        filterPlaceholder: "name@…",
        widthClassName: "min-w-[14rem]",
        group: "Identity",
        description: "Work email — used for password resets and notifications.",
        cell: (e) =>
          e.email ? (
            <span className="truncate text-xs text-muted-foreground">
              {e.email}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "current_rate",
        header: "Current rate",
        widthClassName: "w-32",
        group: "Amounts",
        description:
          "Currently effective hourly wage. Blank when no wage row has been recorded yet.",
        cell: (e) =>
          e.current_hourly_rate ? (
            <span className="font-mono text-xs">
              {formatCompanyMoney(e.current_hourly_rate, {
                ...prefs,
                currency_code: e.current_currency_code ?? prefs.currency_code,
              })}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "reputation_score",
        header: "Reputation",
        widthClassName: "w-28",
        sortField: "reputation_score",
        group: "Status",
        description:
          "Cached projection of the reputation-event stream (300–850 band).",
        cell: (e) => (
          <Badge tone={scoreTone(e.reputation_score)}>
            {e.reputation_score}
          </Badge>
        ),
      },
      {
        id: "hire_date",
        header: "Hired",
        widthClassName: "w-28",
        sortField: "hire_date",
        filterField: "hire_date",
        filterKind: "date-range",
        group: "Dates",
        description: "Date this employee joined the company.",
        cell: (e) =>
          e.hire_date ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(e.hire_date, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "updated_at",
        header: "Updated",
        widthClassName: "w-32",
        sortField: "updated_at",
        filterField: "updated_at",
        filterKind: "date-range",
        group: "Meta",
        description: "When this employee record was last modified.",
        cell: (e) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(e.updated_at, prefs)}
          </span>
        ),
      },
      // ---- defaultHidden ----
      {
        id: "is_active",
        header: "Active",
        widthClassName: "w-20",
        align: "center",
        defaultHidden: true,
        filterField: "is_active",
        filterKind: "select",
        filterOptions: BOOL_OPTIONS,
        group: "Status",
        description: "Archived employees are hidden from pickers.",
        cell: (e) =>
          e.is_active ? (
            <Badge tone="emerald">Yes</Badge>
          ) : (
            <Badge tone="muted">No</Badge>
          ),
      },
      {
        id: "is_qa",
        header: "QA",
        widthClassName: "w-20",
        align: "center",
        defaultHidden: true,
        filterField: "is_qa",
        filterKind: "select",
        filterOptions: BOOL_OPTIONS,
        group: "Status",
        description: "Can sign off Goods-In inspections + QC verdicts.",
        cell: (e) =>
          e.is_qa ? (
            <Badge tone="emerald">Yes</Badge>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "external_id",
        header: "External ID",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Identity",
        description:
          "Foreign key from vita-performance / payroll for cross-system reconciliation.",
        cell: (e) =>
          e.external_id ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {e.external_id}
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
        sortField: "inserted_at",
        filterField: "inserted_at",
        filterKind: "date-range",
        group: "Meta",
        description: "When this employee was first onboarded.",
        cell: (e) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(e.inserted_at, prefs)}
          </span>
        ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<HREmployeeSummary>
      tableId="settings-hr-employees"
      realtimeEntity="hr-employee"
      columns={columns}
      rowKey={(e) => String(e.id)}
      fetchPage={fetchPage}
      initialPage={{
        items: initialPage.items,
        next_cursor: initialPage.next_cursor,
      }}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search employees…"
      filters={filters}
      onRowClick={(e) => {
        router.push(`/hr/employees/${e.uuid}`);
      }}
      renderMobileCard={(e) => (
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{e.full_name}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {e.code ?? e.employee_number ?? `#${e.id}`}
              </p>
            </div>
            <Badge tone={scoreTone(e.reputation_score)}>
              {e.reputation_score}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {e.current_hourly_rate && (
              <span className="font-mono">
                {formatCompanyMoney(e.current_hourly_rate, {
                  ...prefs,
                  currency_code: e.current_currency_code ?? prefs.currency_code,
                })}
                /hr
              </span>
            )}
            {!e.is_active && <Badge tone="muted">Archived</Badge>}
            {e.is_qa && <Badge tone="emerald">QA</Badge>}
          </div>
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <Users2 className="mx-auto size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No employees yet</p>
          <p className="text-xs text-muted-foreground">
            Onboard the first employee to see them appear here. Wage history
            and reputation events land on the detail page.
          </p>
        </div>
      }
    />
  );
}
