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
import { Badge } from "@/components/ui/badge-mini";
import { auditColumns } from "@/components/audit/audit-table-columns";
import type { Item, ItemType } from "@/lib/types";

interface ItemsTableProps {
  initialPage: PageResult<Item>;
}

const DEFAULT_SORT: SortSpec = { field: "name", direction: "asc" };

const TYPE_LABEL: Record<ItemType, string> = {
  raw_material: "Raw material",
  semi_finished: "Semi-finished",
  finished_product: "Finished product",
  packaging: "Packaging",
};

const TYPE_TONE: Record<
  ItemType,
  "indigo" | "amber" | "emerald" | "brand"
> = {
  raw_material: "amber",
  semi_finished: "brand",
  finished_product: "emerald",
  packaging: "indigo",
};

const FILTERS: FilterDef[] = [
  {
    field: "item_type",
    label: "Type",
    options: [
      { label: "Raw material", value: "raw_material" },
      { label: "Semi-finished", value: "semi_finished" },
      { label: "Finished product", value: "finished_product" },
      { label: "Packaging", value: "packaging" },
    ],
  },
  {
    field: "is_active",
    label: "Status",
    options: [
      { label: "Active", value: true },
      { label: "Inactive", value: false },
    ],
  },
];

async function fetchItemsPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<Item>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  // The item_type filter maps to a backend query param directly so
  // the server can scope the result set (and skip the FE-side filter
  // pass). Other filters fall through to the generic search.
  for (const [k, v] of Object.entries(params.filters)) {
    qs.set(k === "item_type" ? "item_type" : `filter[${k}]`, String(v));
  }
  serializeColumnFilters(qs, params.columnFilters);

  const res = await fetch(`/api/items?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<Item>;
}

export function ItemsTable({ initialPage }: ItemsTableProps) {
  const router = useRouter();

  const columns = useMemo<DataTableColumn<Item>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        sortField: "code",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-28",
        cell: (i) =>
          i.code ? (
            <span className="font-mono text-xs text-muted-foreground">
              {i.code}
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
        cell: (i) => (
          <div className="flex flex-col">
            <span className="truncate font-medium">{i.name}</span>
            {i.product_family && (
              <span className="truncate text-xs text-muted-foreground">
                {i.product_family.name}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "type",
        header: "Type",
        sortField: "item_type",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-36",
        cell: (i) => (
          <Badge tone={TYPE_TONE[i.item_type]}>{TYPE_LABEL[i.item_type]}</Badge>
        ),
      },
      {
        id: "external_sku",
        header: "External SKU",
        sortField: "external_sku",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-36",
        cell: (i) =>
          i.external_sku ? (
            <span className="font-mono text-xs text-muted-foreground">
              {i.external_sku}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "stock_uom",
        header: "Stock UoM",
        widthClassName: "w-24",
        cell: (i) =>
          i.stock_uom ? (
            <span className="font-mono text-xs">{i.stock_uom.symbol}</span>
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
        cell: (i) => (
          <Badge tone={i.is_active ? "emerald" : "muted"}>
            {i.is_active ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      ...auditColumns<Item>(),
    ],
    [],
  );

  return (
    <DataTable
      tableId="items"
      columns={columns}
      rowKey={(i) => String(i.id)}
      fetchPage={fetchItemsPage}
      initialPage={initialPage}
      searchPlaceholder="Search by name, SKU, or barcode…"
      defaultSort={DEFAULT_SORT}
      filters={FILTERS}
      onRowClick={(i) => router.push(`/settings/items/${i.uuid}`)}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No items yet</p>
          <p className="text-xs text-muted-foreground">
            Add your first stock item — raw material, finished product, or
            packaging.
          </p>
        </div>
      }
    />
  );
}
