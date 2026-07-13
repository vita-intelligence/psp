"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Route } from "lucide-react";
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

  const filters = useMemo<FilterDef[]>(() => [IS_ACTIVE_FILTER], []);

  const columns = useMemo<DataTableColumn<RoutingSummary>[]>(
    () => [
      {
        id: "code",
        header: "Number",
        sortField: "id",
        sortLabels: { asc: "Oldest first", desc: "Newest first" },
        filterField: "code",
        filterKind: "text",
        filterPlaceholder: "R00001…",
        widthClassName: "w-24",
        group: "Identity",
        description: "Auto-numbered routing code.",
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
        filterField: "name",
        filterKind: "text",
        filterPlaceholder: "Encapsulation…",
        widthClassName: "min-w-[18rem]",
        group: "Identity",
        description: "Human-readable routing name.",
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
        filterField: "item",
        filterKind: "text",
        filterPlaceholder: "Item name or SKU…",
        group: "Identity",
        description: "Item this routing produces. Filter by name or SKU.",
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
        filterField: "bom",
        filterKind: "text",
        filterPlaceholder: "BOM name…",
        group: "Identity",
        description: "BOM this routing pins to. Empty = works with any BOM. Filter by BOM name.",
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
        filterField: "updated_at",
        filterKind: "date-range",
        widthClassName: "w-32",
        group: "Dates",
        description: "When this routing was last modified.",
        cell: (r) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(r.updated_at, prefs)}
          </span>
        ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "item_code",
        header: "Item code",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Identity",
        description: "Output item's auto-numbered code.",
        cell: (r) =>
          r.item?.code ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {r.item.code}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "item_type",
        header: "Item type",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Identity",
        description: "Finished vs semi-finished output.",
        cell: (r) =>
          r.item?.item_type ? (
            <span className="text-xs text-muted-foreground">
              {r.item.item_type}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
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
        description: "Archived routings are hidden from MO create pickers.",
        cell: (r) =>
          r.is_active ? (
            <Badge tone="emerald">Yes</Badge>
          ) : (
            <Badge tone="muted">No</Badge>
          ),
      },
      {
        id: "bom_code",
        header: "BOM code",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Identity",
        description: "Auto-numbered code for the pinned BOM (if any).",
        cell: (r) =>
          r.bom?.code ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {r.bom.code}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "bom_name",
        header: "BOM name",
        widthClassName: "min-w-[12rem]",
        defaultHidden: true,
        group: "Identity",
        description: "Name of the pinned BOM (if any).",
        cell: (r) =>
          r.bom?.name ? (
            <span className="truncate text-xs text-muted-foreground">
              {r.bom.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "external_sku",
        header: "Item SKU",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Identity",
        description: "Output item's external SKU.",
        cell: (r) =>
          r.item?.external_sku ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {r.item.external_sku}
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
        description: "User who created this routing.",
        cell: (r) =>
          r.created_by ? (
            <span className="truncate text-xs">{r.created_by.name}</span>
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
        description: "User who last modified this routing.",
        cell: (r) =>
          r.updated_by ? (
            <span className="truncate text-xs">{r.updated_by.name}</span>
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
        description: "When this routing was created.",
        cell: (r) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(r.inserted_at, prefs)}
          </span>
        ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<RoutingSummary>
      tableId="production-routings"
      realtimeEntity="routing"
      columns={columns}
      rowKey={(r) => String(r.id)}
      fetchPage={fetchPage}
      initialPage={{
        items: initialPage.items,
        next_cursor: initialPage.next_cursor,
      }}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search routings…"
      filters={filters}
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
