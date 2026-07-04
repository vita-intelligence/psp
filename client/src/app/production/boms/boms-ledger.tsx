"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { ListChecks } from "lucide-react";
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
import type { BOMLedgerPage, BOMSummary } from "@/lib/production/types";

interface Props {
  initialPage: BOMLedgerPage;
}

const DEFAULT_SORT: SortSpec = { field: "inserted_at", direction: "desc" };

async function fetchBOMsPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<BOMSummary>> {
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
  const res = await fetch(`/api/production/boms?${qs.toString()}`, {
    cache: "no-store",
  });
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
  return (await res.json()) as PageResult<BOMSummary>;
}

/**
 * Desktop BOM ledger. Row click → /production/boms/<uuid> (the
 * detail/edit page). Primary BOMs get an emerald chip so the
 * default-per-item is visible at a glance.
 */
export function BOMsLedger({ initialPage }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const columns = useMemo<DataTableColumn<BOMSummary>[]>(
    () => [
      {
        id: "code",
        header: "BOM #",
        widthClassName: "w-32",
        cell: (b) => (
          <span className="font-mono text-xs font-semibold">
            {b.code ?? `#${b.id}`}
          </span>
        ),
      },
      {
        id: "name",
        header: "Name",
        sortField: "name",
        widthClassName: "min-w-[18rem]",
        cell: (b) => (
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm font-medium">{b.name}</span>
            {b.is_primary && <Badge tone="emerald">Primary</Badge>}
            {!b.is_active && <Badge tone="muted">Archived</Badge>}
          </div>
        ),
      },
      {
        id: "item",
        header: "Item",
        widthClassName: "min-w-[14rem]",
        cell: (b) =>
          b.item ? (
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-sm">{b.item.name}</p>
              {b.item.code && (
                <p className="font-mono text-[10px] text-muted-foreground">
                  {b.item.code}
                </p>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "updated_at",
        header: "Updated",
        sortField: "updated_at",
        widthClassName: "w-32",
        cell: (b) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(b.updated_at, prefs)}
          </span>
        ),
      },
      {
        id: "updated_by",
        header: "By",
        widthClassName: "min-w-[10rem]",
        defaultHidden: true,
        cell: (b) =>
          b.updated_by ? (
            <span className="truncate text-sm">{b.updated_by.name}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<BOMSummary>
      tableId="production-boms"
      columns={columns}
      rowKey={(b) => String(b.id)}
      fetchPage={fetchBOMsPage}
      initialPage={{
        items: initialPage.items,
        next_cursor: initialPage.next_cursor,
      }}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search BOMs by name…"
      onRowClick={(b) => {
        router.push(`/production/boms/${b.uuid}`);
      }}
      renderMobileCard={(b) => (
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{b.name}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {b.code ?? `#${b.id}`}
              </p>
            </div>
            {b.is_primary && <Badge tone="emerald">Primary</Badge>}
          </div>
          {b.item && (
            <p className="text-[11px] text-muted-foreground">
              {b.item.name}
              {b.item.code ? ` · ${b.item.code}` : ""}
            </p>
          )}
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <ListChecks className="mx-auto size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No BOMs yet</p>
          <p className="text-xs text-muted-foreground">
            Open any <strong>finished</strong> or{" "}
            <strong>semi-finished</strong> item and click{" "}
            <strong>Create BOM</strong> on its detail page.
          </p>
        </div>
      }
    />
  );
}
