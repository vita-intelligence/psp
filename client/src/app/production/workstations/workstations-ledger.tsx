"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Settings2 } from "lucide-react";
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
  WorkstationLedgerPage,
  WorkstationSummary,
} from "@/lib/production/types";

interface Props {
  initialPage: WorkstationLedgerPage;
  /** Location filters built server-side via `buildLocationFilters()`. */
  locationFilters?: FilterDef[];
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
}): Promise<PageResult<WorkstationSummary>> {
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
    `/api/production/workstations?${qs.toString()}`,
    { cache: "no-store" },
  );
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
  return (await res.json()) as PageResult<WorkstationSummary>;
}

export function WorkstationsLedger({ initialPage, locationFilters }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const filters = useMemo<FilterDef[]>(
    () => [IS_ACTIVE_FILTER, ...(locationFilters ?? [])],
    [locationFilters],
  );

  const columns = useMemo<DataTableColumn<WorkstationSummary>[]>(
    () => [
      {
        id: "code",
        header: "Number",
        widthClassName: "w-28",
        group: "Identity",
        description: "Auto-numbered workstation code.",
        cell: (w) => (
          <span className="font-mono text-xs font-semibold">
            {w.code ?? `#${w.id}`}
          </span>
        ),
      },
      {
        id: "name",
        header: "Name",
        sortField: "name",
        filterField: "name",
        filterKind: "text",
        filterPlaceholder: "Encapsulator A…",
        widthClassName: "min-w-[16rem]",
        group: "Identity",
        description: "Human-readable workstation name.",
        cell: (w) => (
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm font-medium">{w.name}</span>
            {!w.is_active && <Badge tone="muted">Archived</Badge>}
          </div>
        ),
      },
      {
        id: "group",
        header: "Group",
        widthClassName: "min-w-[12rem]",
        filterField: "group",
        filterKind: "text",
        filterPlaceholder: "Group name…",
        group: "Identity",
        description: "Parent workstation group this station belongs to. Filter by group name.",
        cell: (w) =>
          w.workstation_group ? (
            <div className="flex items-center gap-2 min-w-0">
              {w.workstation_group.color && (
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-sm border border-border/60"
                  style={{ backgroundColor: w.workstation_group.color }}
                />
              )}
              <span className="truncate text-sm">
                {w.workstation_group.name}
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "site",
        header: "Site",
        widthClassName: "min-w-[12rem]",
        group: "Location",
        description: "Production site (facility) this workstation lives at.",
        cell: (w) =>
          w.warehouse ? (
            <span className="truncate text-sm text-muted-foreground">
              {w.warehouse.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "productivity",
        header: "Productivity",
        widthClassName: "w-28",
        group: "Amounts",
        description: "Speed multiplier (1.0 = baseline; 2.0 = double).",
        cell: (w) => (
          <span className="font-mono text-xs">
            {formatCompanyNumber(w.productivity, prefs)}×
          </span>
        ),
      },
      {
        id: "hourly_rate",
        header: "Hourly rate",
        widthClassName: "w-32",
        group: "Amounts",
        description: "Cost per hour when override enabled — otherwise inherits from the group.",
        cell: (w) =>
          w.hourly_rate_enabled && w.hourly_rate ? (
            <span className="font-mono text-xs">
              {formatCompanyMoney(w.hourly_rate, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">
              Inherits
            </span>
          ),
      },
      {
        id: "psp_source_of_truth",
        header: "Kiosk",
        widthClassName: "w-32",
        group: "Status",
        description:
          "Cut-over flag. Kiosk Live rows accept sessions from the vita-performance kiosk and post labour cost back to PSP.",
        cell: (w) =>
          w.psp_source_of_truth ? (
            <Badge tone="emerald">Kiosk Live</Badge>
          ) : (
            <Badge tone="muted">Local only</Badge>
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
        description: "Archived workstations are hidden from schedule pickers.",
        cell: (w) =>
          w.is_active ? (
            <Badge tone="emerald">Yes</Badge>
          ) : (
            <Badge tone="muted">No</Badge>
          ),
      },
      {
        id: "group_code",
        header: "Group code",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Identity",
        description: "Auto-numbered code for the parent group.",
        cell: (w) =>
          w.workstation_group?.code ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {w.workstation_group.code}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "group_kind",
        header: "Group kind",
        widthClassName: "w-28",
        defaultHidden: true,
        group: "Status",
        description: "Active vs passive processing on the parent group.",
        cell: (w) =>
          w.workstation_group?.kind ? (
            <span className="text-xs text-muted-foreground">
              {w.workstation_group.kind}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "hourly_rate_enabled",
        header: "Rate on",
        widthClassName: "w-20",
        align: "center",
        defaultHidden: true,
        group: "Amounts",
        description: "Whether this station's own hourly rate override is enabled.",
        cell: (w) =>
          w.hourly_rate_enabled ? (
            <Badge tone="emerald">Yes</Badge>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "idle_from",
        header: "Idle from",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Dates",
        description: "Start of the maintenance / idle window (scheduler blocks bookings inside it).",
        cell: (w) =>
          w.idle_from ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(w.idle_from, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "idle_to",
        header: "Idle to",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Dates",
        description: "End of the maintenance / idle window.",
        cell: (w) =>
          w.idle_to ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(w.idle_to, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "warehouse_kind",
        header: "Site kind",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Location",
        description: "Kind of hosting site (should always be production_facility).",
        cell: (w) =>
          w.warehouse?.kind ? (
            <span className="text-xs text-muted-foreground">
              {w.warehouse.kind}
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
        description: "When this workstation was created.",
        cell: (w) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(w.inserted_at, prefs)}
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
        description: "When this workstation was last modified.",
        cell: (w) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(w.updated_at, prefs)}
          </span>
        ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<WorkstationSummary>
      tableId="production-workstations"
      realtimeEntity="workstation"
      columns={columns}
      rowKey={(w) => String(w.id)}
      fetchPage={fetchPage}
      initialPage={{
        items: initialPage.items,
        next_cursor: initialPage.next_cursor,
      }}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search workstations…"
      filters={filters}
      onRowClick={(w) => {
        router.push(`/production/workstations/${w.uuid}`);
      }}
      renderMobileCard={(w) => (
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{w.name}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {w.code ?? `#${w.id}`}
              </p>
            </div>
            {!w.is_active && <Badge tone="muted">Archived</Badge>}
          </div>
          {(w.workstation_group || w.warehouse) && (
            <p className="text-[11px] text-muted-foreground">
              {w.workstation_group?.name}
              {w.workstation_group && w.warehouse ? " · " : ""}
              {w.warehouse?.name}
            </p>
          )}
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <Settings2 className="mx-auto size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No workstations yet</p>
          <p className="text-xs text-muted-foreground">
            Add the first machine / line slot — it'll need to live on a
            production site under an existing workstation group.
          </p>
        </div>
      }
    />
  );
}
