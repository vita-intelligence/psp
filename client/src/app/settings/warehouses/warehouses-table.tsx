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
import { WarehouseEditorsBadge } from "./active-sessions";
import { Badge } from "@/components/ui/badge-mini";
import { auditColumns } from "@/components/audit/audit-table-columns";

interface WarehousesTableProps {
  initialPage: PageResult<Warehouse>;
  currentUserId: number;
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

async function fetchWarehousesPage(params: {
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

  const res = await fetch(`/api/warehouses?${qs.toString()}`, {
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

export function WarehousesTable({
  initialPage,
  currentUserId,
  toolbarActions,
  beforeTable,
}: WarehousesTableProps) {
  const router = useRouter();

  const columns = useMemo<DataTableColumn<Warehouse>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        sortField: "code",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-28",
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
        cell: (w) => (
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{w.name}</span>
            <WarehouseEditorsBadge
              warehouseUuid={w.uuid}
              currentUserId={currentUserId}
            />
          </div>
        ),
      },
      {
        id: "address",
        header: "Address",
        widthClassName: "min-w-[14rem]",
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
        cell: (w) => (
          <Badge tone={w.is_active ? "emerald" : "muted"}>
            {w.is_active ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      ...auditColumns<Warehouse>(),
    ],
    [currentUserId],
  );

  return (
    <DataTable<Warehouse>
      tableId="warehouses"
      columns={columns}
      rowKey={(w) => String(w.id)}
      fetchPage={fetchWarehousesPage}
      initialPage={initialPage}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search by name or address…"
      filters={FILTERS}
      onRowClick={(w) => router.push(`/settings/warehouses/${w.uuid}`)}
      toolbarActions={toolbarActions}
      beforeTable={beforeTable}
      renderMobileCard={(w) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-sm font-semibold">{w.name}</p>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Badge tone={w.is_active ? "emerald" : "muted"}>
                  {w.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>
            <WarehouseEditorsBadge
              warehouseUuid={w.uuid}
              currentUserId={currentUserId}
            />
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
          <p className="text-sm font-medium">No warehouses yet</p>
          <p className="text-xs text-muted-foreground">
            Add your first physical location to start tracking stock.
          </p>
        </div>
      }
    />
  );
}
