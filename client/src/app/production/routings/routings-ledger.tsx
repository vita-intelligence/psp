"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Route } from "lucide-react";
import { DataTable } from "@/components/data-table";
import type {
  ColumnFilterValue,
  DataTableColumn,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { serializeColumnFilters } from "@/lib/data-table/serialize";
import { Badge } from "@/components/ui/badge-mini";
import { formatCompanyDate } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type {
  RoutingLedgerPage,
  RoutingSummary,
} from "@/lib/production/types";

interface Props {
  initialPage: RoutingLedgerPage;
}

const DEFAULT_SORT: SortSpec = { field: "inserted_at", direction: "desc" };

async function fetchPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<RoutingSummary>> {
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
  const res = await fetch(`/api/production/routings?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<RoutingSummary>;
}

export function RoutingsLedger({ initialPage }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const columns = useMemo<DataTableColumn<RoutingSummary>[]>(
    () => [
      {
        id: "code",
        header: "Number",
        widthClassName: "w-24",
        cell: (r) => (
          <span className="font-mono text-xs font-semibold">
            {r.code ?? `#${r.id}`}
          </span>
        ),
      },
      {
        id: "name",
        header: "Name",
        sortField: "name",
        widthClassName: "min-w-[18rem]",
        cell: (r) => (
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm font-medium">{r.name}</span>
            {!r.is_active && <Badge tone="muted">Archived</Badge>}
          </div>
        ),
      },
      {
        id: "item",
        header: "Output item",
        widthClassName: "min-w-[14rem]",
        cell: (r) =>
          r.item ? (
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-sm">{r.item.name}</p>
              {r.item.code && (
                <p className="font-mono text-[10px] text-muted-foreground">
                  {r.item.code}
                </p>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "bom",
        header: "Connected BOM",
        widthClassName: "min-w-[12rem]",
        cell: (r) =>
          r.bom ? (
            <span className="truncate text-xs text-muted-foreground">
              {r.bom.code ?? r.bom.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/40">Any BOM</span>
          ),
      },
      {
        id: "updated_at",
        header: "Updated",
        sortField: "updated_at",
        widthClassName: "w-32",
        cell: (r) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(r.updated_at, prefs)}
          </span>
        ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<RoutingSummary>
      tableId="production-routings"
      columns={columns}
      rowKey={(r) => String(r.id)}
      fetchPage={fetchPage}
      initialPage={{
        items: initialPage.items,
        next_cursor: initialPage.next_cursor,
      }}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search routings…"
      onRowClick={(r) => router.push(`/production/routings/${r.uuid}`)}
      renderMobileCard={(r) => (
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.name}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {r.code ?? `#${r.id}`}
              </p>
            </div>
            {!r.is_active && <Badge tone="muted">Archived</Badge>}
          </div>
          {(r.item || r.bom) && (
            <p className="text-[11px] text-muted-foreground">
              {r.item?.name}
              {r.bom ? ` · ${r.bom.code ?? r.bom.name}` : ""}
            </p>
          )}
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <Route className="mx-auto size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No routings yet</p>
          <p className="text-xs text-muted-foreground">
            Pick a finished or semi-finished item and define the
            operations + workstation groups it runs through.
          </p>
        </div>
      }
    />
  );
}
