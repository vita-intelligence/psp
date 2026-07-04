"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Settings2 } from "lucide-react";
import { DataTable } from "@/components/data-table";
import type {
  ColumnFilterValue,
  DataTableColumn,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { serializeColumnFilters } from "@/lib/data-table/serialize";
import { Badge } from "@/components/ui/badge-mini";
import { formatCompanyMoney, formatCompanyNumber } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type {
  WorkstationLedgerPage,
  WorkstationSummary,
} from "@/lib/production/types";

interface Props {
  initialPage: WorkstationLedgerPage;
}

const DEFAULT_SORT: SortSpec = { field: "inserted_at", direction: "desc" };

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

export function WorkstationsLedger({ initialPage }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const columns = useMemo<DataTableColumn<WorkstationSummary>[]>(
    () => [
      {
        id: "code",
        header: "Number",
        widthClassName: "w-28",
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
        widthClassName: "min-w-[16rem]",
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
    ],
    [prefs],
  );

  return (
    <DataTable<WorkstationSummary>
      tableId="production-workstations"
      columns={columns}
      rowKey={(w) => String(w.id)}
      fetchPage={fetchPage}
      initialPage={{
        items: initialPage.items,
        next_cursor: initialPage.next_cursor,
      }}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search workstations…"
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
