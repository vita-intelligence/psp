"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Factory } from "lucide-react";
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
import { formatCompanyDate, formatCompanyMoney, formatCompanyNumber } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type {
  WorkstationGroupLedgerPage,
  WorkstationGroupSummary,
} from "@/lib/production/types";

interface Props {
  initialPage: WorkstationGroupLedgerPage;
}

const DEFAULT_SORT: SortSpec = { field: "inserted_at", direction: "desc" };

// Mirrors Backend.Production.WorkstationGroup @kinds.
const KIND_LABELS: Record<WorkstationGroupSummary["kind"], string> = {
  active_processing: "Active",
  passive_processing: "Passive",
};

const KIND_OPTIONS = (
  Object.keys(KIND_LABELS) as WorkstationGroupSummary["kind"][]
).map((k) => ({ label: KIND_LABELS[k], value: k }));

const KIND_FILTER: FilterDef = {
  field: "kind",
  label: "Type",
  options: KIND_OPTIONS,
};

const IS_ACTIVE_FILTER: FilterDef = {
  field: "is_active",
  label: "Active",
  options: [
    { label: "Active only", value: "true" },
    { label: "Archived only", value: "false" },
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
}): Promise<PageResult<WorkstationGroupSummary>> {
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
  const res = await fetch(
    `/api/production/workstation-groups?${qs.toString()}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      /* leave default */
    }
    throw new Error(detail);
  }
  return (await res.json()) as PageResult<WorkstationGroupSummary>;
}

export function WorkstationGroupsLedger({ initialPage }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const filters = useMemo<FilterDef[]>(
    () => [KIND_FILTER, IS_ACTIVE_FILTER],
    [],
  );

  const columns = useMemo<DataTableColumn<WorkstationGroupSummary>[]>(
    () => [
      {
        id: "code",
        header: "Number",
        widthClassName: "w-28",
        group: "Identity",
        description: "Auto-numbered workstation-group code.",
        cell: (g) => (
          <span className="font-mono text-xs font-semibold">
            {g.code ?? `#${g.id}`}
          </span>
        ),
      },
      {
        id: "name",
        header: "Name",
        sortField: "name",
        filterField: "name",
        filterKind: "text",
        filterPlaceholder: "Oven bank…",
        widthClassName: "min-w-[18rem]",
        group: "Identity",
        description: "Human-readable group name.",
        cell: (g) => (
          <div className="flex items-center gap-2 min-w-0">
            {g.color && (
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-sm border border-border/60"
                style={{ backgroundColor: g.color }}
              />
            )}
            <span className="truncate text-sm font-medium">{g.name}</span>
            {!g.is_active && <Badge tone="muted">Archived</Badge>}
          </div>
        ),
      },
      {
        id: "kind",
        header: "Type",
        widthClassName: "w-32",
        filterField: "kind",
        filterKind: "select",
        filterOptions: KIND_OPTIONS,
        group: "Status",
        description: "Active = operator-driven. Passive = unattended (ovens, curing).",
        cell: (g) => (
          <Badge tone={g.kind === "passive_processing" ? "amber" : "emerald"}>
            {KIND_LABELS[g.kind]}
          </Badge>
        ),
      },
      {
        id: "workstation_count",
        header: "Capacity",
        widthClassName: "w-24",
        group: "Amounts",
        description: "Derived count of active Workstation rows in this group.",
        cell: (g) => (
          <span className="font-mono text-xs">
            {formatCompanyNumber(g.workstation_count, prefs)}
          </span>
        ),
      },
      {
        id: "hourly_rate",
        header: "Machine cost / h",
        widthClassName: "w-32",
        group: "Amounts",
        description: "Machinery cost per hour of runtime (energy, depreciation, upkeep) — inherited by member workstations. NOT worker wages.",
        cell: (g) =>
          g.hourly_rate_enabled && g.hourly_rate ? (
            <span className="font-mono text-xs">
              {formatCompanyMoney(g.hourly_rate, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      // ---- defaultHidden columns below ----
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
        description: "Archived groups are hidden from routing / MO pickers.",
        cell: (g) =>
          g.is_active ? (
            <Badge tone="emerald">Yes</Badge>
          ) : (
            <Badge tone="muted">No</Badge>
          ),
      },
      {
        id: "hourly_rate_enabled",
        header: "Machine cost on",
        widthClassName: "w-32",
        align: "center",
        defaultHidden: true,
        group: "Amounts",
        description: "Whether the machine-cost-per-hour charge is enabled.",
        cell: (g) =>
          g.hourly_rate_enabled ? (
            <Badge tone="emerald">Yes</Badge>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "color",
        header: "Colour",
        widthClassName: "w-20",
        defaultHidden: true,
        group: "Identity",
        description: "Colour used to identify the group in schedule blocks.",
        cell: (g) =>
          g.color ? (
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-sm border border-border/60"
                style={{ backgroundColor: g.color }}
              />
              <span className="font-mono text-[11px] text-muted-foreground">
                {g.color}
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "default_operation_notes",
        header: "Default op notes",
        widthClassName: "min-w-[14rem]",
        defaultHidden: true,
        group: "Compliance",
        description: "Pre-filled SOP / operation description for routings + MO steps.",
        cell: (g) =>
          g.default_operation_notes ? (
            <span className="truncate text-xs text-muted-foreground">
              {g.default_operation_notes}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "effective_default_operation_notes",
        header: "Effective op notes",
        widthClassName: "min-w-[14rem]",
        defaultHidden: true,
        group: "Compliance",
        description: "BE-resolved: group value when set, otherwise a workstation-level fallback.",
        cell: (g) =>
          g.effective_default_operation_notes ? (
            <span className="truncate text-xs text-muted-foreground">
              {g.effective_default_operation_notes}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "created_by",
        header: "Created by",
        widthClassName: "min-w-[10rem]",
        defaultHidden: true,
        group: "Meta",
        description: "User who created this workstation group.",
        cell: (g) =>
          g.created_by ? (
            <span className="truncate text-xs">{g.created_by.name}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "updated_by",
        header: "Updated by",
        widthClassName: "min-w-[10rem]",
        defaultHidden: true,
        group: "Meta",
        description: "User who last modified this group.",
        cell: (g) =>
          g.updated_by ? (
            <span className="truncate text-xs">{g.updated_by.name}</span>
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
        description: "When this group was created.",
        cell: (g) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(g.inserted_at, prefs)}
          </span>
        ),
      },
      {
        id: "updated_at",
        header: "Updated",
        widthClassName: "w-32",
        defaultHidden: true,
        sortField: "updated_at",
        filterField: "updated_at",
        filterKind: "date-range",
        group: "Meta",
        description: "When this group was last modified.",
        cell: (g) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(g.updated_at, prefs)}
          </span>
        ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<WorkstationGroupSummary>
      tableId="production-workstation-groups"
      realtimeEntity="workstation-group"
      columns={columns}
      rowKey={(g) => String(g.id)}
      fetchPage={fetchPage}
      initialPage={{
        items: initialPage.items,
        next_cursor: initialPage.next_cursor,
      }}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search workstation groups…"
      filters={filters}
      onRowClick={(g) => {
        router.push(`/production/workstation-groups/${g.uuid}`);
      }}
      renderMobileCard={(g) => (
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {g.color && (
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-sm border border-border/60"
                  style={{ backgroundColor: g.color }}
                />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{g.name}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {g.code ?? `#${g.id}`}
                </p>
              </div>
            </div>
            <Badge tone={g.kind === "passive_processing" ? "amber" : "emerald"}>
              {KIND_LABELS[g.kind]}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Capacity {formatCompanyNumber(g.workstation_count, prefs)}
            {g.hourly_rate_enabled && g.hourly_rate && (
              <> · {formatCompanyMoney(g.hourly_rate, prefs)} / h</>
            )}
          </p>
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <Factory className="mx-auto size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No workstation groups yet</p>
          <p className="text-xs text-muted-foreground">
            Add an oven bank, packaging line, or blending station to
            get started.
          </p>
        </div>
      }
    />
  );
}
