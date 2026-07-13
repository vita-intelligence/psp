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
import type { Warehouse } from "@/lib/types";
import { Badge } from "@/components/ui/badge-mini";
import { auditColumns } from "@/components/audit/audit-table-columns";

interface ProductionSitesTableProps {
  initialPage: PageResult<Warehouse>;
  toolbarActions?: React.ReactNode;
  beforeTable?: React.ReactNode;
}

const FILTERS: FilterDef[] = [
  {
    field: "is_active",
    label: "Status",
    options: [
      { label: "Active", value: true },
      { label: "Inactive", value: false },
    ],
  },
];

const DEFAULT_SORT: SortSpec = { field: "name", direction: "asc" };

async function fetchSitesPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<Warehouse>> {
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

  const res = await fetch(`/api/production-facilities?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<Warehouse>;
}

export function ProductionSitesTable({
  initialPage,
  toolbarActions,
  beforeTable,
}: ProductionSitesTableProps) {
  const router = useRouter();

  const columns = useMemo<DataTableColumn<Warehouse>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        sortField: "code",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-28",
        filterField: "code",
        filterKind: "text",
        filterPlaceholder: "PF00001…",
        group: "Identity",
        description: "Auto-numbered production-facility code.",
        cell: (w) =>
          w.code ? (
            <span className="font-mono text-xs text-muted-foreground">
              {w.code}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "name",
        header: "Name",
        sortField: "name",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        hideable: false,
        widthClassName: "min-w-[14rem]",
        filterField: "name",
        filterKind: "text",
        filterPlaceholder: "Facility name…",
        group: "Identity",
        description: "Display name of this production facility.",
        cell: (w) => <span className="truncate font-medium">{w.name}</span>,
      },
      {
        id: "address",
        header: "Address",
        widthClassName: "min-w-[14rem]",
        filterField: "address",
        filterKind: "text",
        filterPlaceholder: "Address…",
        group: "Location",
        description: "Physical postal address of this facility.",
        cell: (w) =>
          w.address ? (
            <span className="line-clamp-1 text-sm text-muted-foreground">
              {w.address}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "status",
        header: "Status",
        sortField: "is_active",
        sortLabels: { asc: "Inactive first", desc: "Active first" },
        widthClassName: "w-28",
        filterField: "is_active",
        filterKind: "boolean",
        group: "Status",
        description: "Whether this facility is currently active.",
        cell: (w) => (
          <Badge tone={w.is_active ? "emerald" : "muted"}>
            {w.is_active ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "timezone",
        header: "Timezone",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Location",
        description: "Local timezone override — null inherits from the company.",
        cell: (w) =>
          w.timezone ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {w.timezone}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">
              inherit
            </span>
          ),
      },
      {
        id: "contacts_count",
        header: "Contacts",
        widthClassName: "w-24",
        align: "right",
        defaultHidden: true,
        group: "Meta",
        description: "How many contact rows are stored on this facility.",
        cell: (w) => (
          <span className="font-mono text-xs">
            {w.contacts?.items?.length ?? 0}
          </span>
        ),
      },
      {
        id: "notes",
        header: "Notes",
        widthClassName: "min-w-[14rem]",
        defaultHidden: true,
        filterField: "notes",
        filterKind: "text",
        filterPlaceholder: "Notes…",
        group: "Meta",
        description: "Free-form operator notes about this facility.",
        cell: (w) =>
          w.notes ? (
            <span className="line-clamp-1 text-xs text-muted-foreground">
              {w.notes}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "has_plan",
        header: "Has plan",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Location",
        description: "Whether a floor plan has been drawn for this facility.",
        cell: (w) => (
          <Badge tone={w.plan ? "emerald" : "muted"}>
            {w.plan ? "Yes" : "No"}
          </Badge>
        ),
      },
      {
        id: "has_holidays",
        header: "Holiday override",
        widthClassName: "w-36",
        defaultHidden: true,
        group: "Location",
        description: "Whether this facility overrides company holidays.",
        cell: (w) => (
          <Badge tone={w.holidays ? "sky" : "muted"}>
            {w.holidays ? "Custom" : "Inherit"}
          </Badge>
        ),
      },
      {
        id: "has_working_hours",
        header: "Working hours override",
        widthClassName: "w-44",
        defaultHidden: true,
        group: "Location",
        description: "Whether this facility overrides company working hours.",
        cell: (w) => (
          <Badge tone={w.working_hours ? "sky" : "muted"}>
            {w.working_hours ? "Custom" : "Inherit"}
          </Badge>
        ),
      },
      ...auditColumns<Warehouse>(),
    ],
    [],
  );

  return (
    <DataTable<Warehouse>
      tableId="production-sites"
      realtimeEntity="production-site"
      columns={columns}
      rowKey={(w) => String(w.id)}
      fetchPage={fetchSitesPage}
      initialPage={initialPage}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search by name or address…"
      filters={FILTERS}
      onRowClick={(w) => router.push(`/settings/production-sites/${w.uuid}`)}
      toolbarActions={toolbarActions}
      beforeTable={beforeTable}
      renderMobileCard={(w) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-sm font-semibold">{w.name}</p>
              <Badge tone={w.is_active ? "emerald" : "muted"}>
                {w.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
          </div>
          {w.address && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {w.address}
            </p>
          )}
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No production sites yet</p>
          <p className="text-xs text-muted-foreground">
            Add your first manufacturing facility to start mapping its
            floor plan and WIP storage.
          </p>
        </div>
      }
    />
  );
}
