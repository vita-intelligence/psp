"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Factory } from "lucide-react";
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
  WorkstationGroupLedgerPage,
  WorkstationGroupSummary,
} from "@/lib/production/types";

interface Props {
  initialPage: WorkstationGroupLedgerPage;
}

const DEFAULT_SORT: SortSpec = { field: "inserted_at", direction: "desc" };

const KIND_LABELS: Record<WorkstationGroupSummary["kind"], string> = {
  active_processing: "Active",
  passive_processing: "Passive",
};

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

  const columns = useMemo<DataTableColumn<WorkstationGroupSummary>[]>(
    () => [
      {
        id: "code",
        header: "Number",
        widthClassName: "w-28",
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
        widthClassName: "min-w-[18rem]",
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
        cell: (g) => (
          <span className="font-mono text-xs">
            {formatCompanyNumber(g.workstation_count, prefs)}
          </span>
        ),
      },
      {
        id: "hourly_rate",
        header: "Hourly rate",
        widthClassName: "w-32",
        cell: (g) =>
          g.hourly_rate_enabled && g.hourly_rate ? (
            <span className="font-mono text-xs">
              {formatCompanyMoney(g.hourly_rate, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<WorkstationGroupSummary>
      tableId="production-workstation-groups"
      columns={columns}
      rowKey={(g) => String(g.id)}
      fetchPage={fetchPage}
      initialPage={{
        items: initialPage.items,
        next_cursor: initialPage.next_cursor,
      }}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search workstation groups…"
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
