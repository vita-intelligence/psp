"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { ListChecks } from "lucide-react";
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
import type { BOMLedgerPage, BOMSummary } from "@/lib/production/types";

interface Props {
  initialPage: BOMLedgerPage;
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

  const filters = useMemo<FilterDef[]>(() => [IS_ACTIVE_FILTER], []);

  const columns = useMemo<DataTableColumn<BOMSummary>[]>(
    () => [
      {
        id: "code",
        header: "BOM #",
        sortField: "id",
        sortLabels: { asc: "Oldest first", desc: "Newest first" },
        filterField: "code",
        filterKind: "text",
        filterPlaceholder: "BOM00001…",
        widthClassName: "w-32",
        group: "Identity",
        description: "Auto-numbered BOM code.",
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
        filterField: "name",
        filterKind: "text",
        filterPlaceholder: "Vitamin C 500mg…",
        widthClassName: "min-w-[18rem]",
        group: "Identity",
        description: "Human-readable BOM name.",
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
        filterField: "item",
        filterKind: "text",
        filterPlaceholder: "Item name or SKU…",
        group: "Identity",
        description: "Output item this recipe produces. Filter by name or SKU.",
        cell: (b) =>
          b.item ? (
            <Link
              href={`/settings/items/${b.item.uuid}`}
              onClick={(e) => e.stopPropagation()}
              className="block min-w-0 space-y-0.5 group"
            >
              <p className="truncate text-sm underline-offset-2 group-hover:underline">
                {b.item.name}
              </p>
              {b.item.code && (
                <p className="font-mono text-[10px] text-muted-foreground">
                  {b.item.code}
                </p>
              )}
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
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
        description: "When this BOM was last modified.",
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
        group: "Meta",
        description: "User who last modified this BOM.",
        cell: (b) =>
          b.updated_by ? (
            <span className="truncate text-sm">{b.updated_by.name}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "item_code",
        header: "Item code",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Identity",
        description: "Auto-numbered code for the output item.",
        cell: (b) =>
          b.item?.code ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {b.item.code}
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
        description: "Type of output — finished vs semi-finished.",
        cell: (b) =>
          b.item?.item_type ? (
            <span className="text-xs text-muted-foreground">
              {b.item.item_type}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "is_primary",
        header: "Primary",
        widthClassName: "w-24",
        align: "center",
        defaultHidden: true,
        filterField: "is_primary",
        filterKind: "select",
        filterOptions: BOOL_OPTIONS,
        group: "Status",
        description: "Whether this BOM is the default recipe for the item.",
        cell: (b) =>
          b.is_primary ? (
            <Badge tone="emerald">Primary</Badge>
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
        description: "Archived BOMs are hidden from item pickers.",
        cell: (b) =>
          b.is_active ? (
            <Badge tone="emerald">Yes</Badge>
          ) : (
            <Badge tone="muted">No</Badge>
          ),
      },
      {
        id: "external_sku",
        header: "Item SKU",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Identity",
        description: "Output item's external SKU.",
        cell: (b) =>
          b.item?.external_sku ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {b.item.external_sku}
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
        description: "User who created this BOM.",
        cell: (b) =>
          b.created_by ? (
            <span className="truncate text-xs">{b.created_by.name}</span>
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
        description: "When this BOM was created.",
        cell: (b) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(b.inserted_at, prefs)}
          </span>
        ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<BOMSummary>
      tableId="production-boms"
      realtimeEntity="bom"
      columns={columns}
      rowKey={(b) => String(b.id)}
      fetchPage={fetchBOMsPage}
      initialPage={{
        items: initialPage.items,
        next_cursor: initialPage.next_cursor,
      }}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search BOMs by name…"
      filters={filters}
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
