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

const TYPE_OPTIONS = (Object.keys(TYPE_LABEL) as ItemType[]).map((t) => ({
  label: TYPE_LABEL[t],
  value: t,
}));

const COMPLIANCE_OPTIONS = [
  { label: "Draft", value: "draft" },
  { label: "Ready for use", value: "ready_for_use" },
];

const FILTERS: FilterDef[] = [
  {
    field: "item_type",
    label: "Type",
    options: TYPE_OPTIONS,
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
        filterField: "id",
        filterKind: "text",
        filterPlaceholder: "MA00001…",
        group: "Identity",
        description: "Auto-numbered item code (per item_type numbering sequence).",
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
        filterField: "name",
        filterKind: "text",
        filterPlaceholder: "Item name…",
        group: "Identity",
        description: "Display name of the item.",
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
        filterField: "item_type",
        filterKind: "select",
        filterOptions: TYPE_OPTIONS,
        group: "Identity",
        description: "Discriminator — drives per-type compliance subtables.",
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
        filterField: "external_sku",
        filterKind: "text",
        filterPlaceholder: "External SKU…",
        group: "Identity",
        description: "External / third-party SKU for interchange.",
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
        group: "Amounts",
        description: "Unit of measurement stock is tracked in.",
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
        filterField: "is_active",
        filterKind: "boolean",
        group: "Status",
        description: "Whether this item is currently active.",
        cell: (i) => (
          <Badge tone={i.is_active ? "emerald" : "muted"}>
            {i.is_active ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "barcode",
        header: "Barcode",
        widthClassName: "w-36",
        defaultHidden: true,
        filterField: "barcode",
        filterKind: "text",
        filterPlaceholder: "GTIN / EAN…",
        group: "Identity",
        description: "Scannable barcode (GTIN-8 / 13 / 14).",
        cell: (i) =>
          i.barcode ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {i.barcode}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "description",
        header: "Description",
        widthClassName: "min-w-[16rem]",
        defaultHidden: true,
        filterField: "description",
        filterKind: "text",
        filterPlaceholder: "Description…",
        group: "Meta",
        description: "Free-text item description.",
        cell: (i) =>
          i.description ? (
            <span className="line-clamp-1 text-xs text-muted-foreground">
              {i.description}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "product_family",
        header: "Product family",
        widthClassName: "w-40",
        defaultHidden: true,
        group: "Identity",
        description: "Marketing grouping this item belongs to (if any).",
        cell: (i) =>
          i.product_family ? (
            <span className="truncate text-xs">
              {i.product_family.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "compliance_status",
        header: "Compliance",
        widthClassName: "w-32",
        defaultHidden: true,
        sortField: "compliance_status",
        filterField: "compliance_status",
        filterKind: "select",
        filterOptions: COMPLIANCE_OPTIONS,
        group: "Compliance",
        description: "Draft items refuse to be assembled or PO'd — must promote first.",
        cell: (i) => (
          <Badge tone={i.compliance_status === "ready_for_use" ? "emerald" : "amber"}>
            {i.compliance_status === "ready_for_use" ? "Ready" : "Draft"}
          </Badge>
        ),
      },
      {
        id: "compliance_readied_at",
        header: "Readied at",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Compliance",
        description: "When the item was last promoted to ready-for-use.",
        cell: (i) =>
          i.compliance_readied_at ? (
            <span className="text-xs text-muted-foreground">
              {new Date(i.compliance_readied_at).toISOString().slice(0, 10)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "compliance_readied_by",
        header: "Readied by",
        widthClassName: "min-w-[10rem]",
        defaultHidden: true,
        group: "Compliance",
        description: "Who last promoted this item to ready-for-use.",
        cell: (i) =>
          i.compliance_readied_by ? (
            <span className="truncate text-xs">
              {i.compliance_readied_by.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "storage_tags",
        header: "Storage tags",
        widthClassName: "min-w-[10rem]",
        defaultHidden: true,
        group: "Compliance",
        description: "Storage-cell tag requirements enforced by the receive form.",
        cell: (i) =>
          i.storage_tags && i.storage_tags.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {i.storage_tags.map((t) => (
                <Badge key={t} tone="muted">
                  {t}
                </Badge>
              ))}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "images_count",
        header: "Images",
        widthClassName: "w-20",
        align: "right",
        defaultHidden: true,
        group: "Meta",
        description: "How many images are attached to this item.",
        cell: (i) => (
          <span className="font-mono text-xs">{i.images?.length ?? 0}</span>
        ),
      },
      {
        id: "certificates_count",
        header: "Certificates",
        widthClassName: "w-24",
        align: "right",
        defaultHidden: true,
        group: "Compliance",
        description: "How many certificates are attached to this item.",
        cell: (i) => (
          <span className="font-mono text-xs">
            {i.certificate_attachments?.length ?? 0}
          </span>
        ),
      },
      {
        id: "allergens_count",
        header: "Allergens",
        widthClassName: "w-24",
        align: "right",
        defaultHidden: true,
        group: "Compliance",
        description: "How many declared allergens are attached to this item.",
        cell: (i) => (
          <span className="font-mono text-xs">
            {i.allergens?.length ?? 0}
          </span>
        ),
      },
      {
        id: "revert_reason",
        header: "Revert reason",
        widthClassName: "min-w-[14rem]",
        defaultHidden: true,
        group: "Compliance",
        description: "Why the item was reverted from ready-for-use to draft (if applicable).",
        cell: (i) =>
          i.compliance_revert_reason ? (
            <span className="line-clamp-1 text-xs text-muted-foreground">
              {i.compliance_revert_reason}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
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
