"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { DataTable } from "@/components/data-table";
import type {
  ColumnFilterValue,
  DataTableColumn,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { serializeColumnFilters } from "@/lib/data-table/serialize";
import { Badge } from "@/components/ui/badge-mini";
import { auditColumns } from "@/components/audit/audit-table-columns";
import type {
  AttributeDefinition,
  AttributeScope,
  AttributeType,
} from "@/lib/types";

const DEFAULT_SORT: SortSpec = { field: "sort_order", direction: "asc" };

const SCOPE_LABEL: Record<AttributeScope, string> = {
  raw_material: "Raw material",
  semi_finished: "Semi-finished",
  finished_product: "Finished product",
  packaging: "Packaging",
  item_any: "Any item",
};

const TYPE_LABEL: Record<AttributeType, string> = {
  text: "Text",
  number: "Number",
  boolean: "Boolean",
  date: "Date",
  enum: "Enum",
  url: "URL",
};

async function fetchPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<AttributeDefinition>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  serializeColumnFilters(qs, params.columnFilters);

  const res = await fetch(`/api/attribute-definitions?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<AttributeDefinition>;
}

export function AttributesTable({
  initialPage,
}: {
  initialPage: PageResult<AttributeDefinition>;
}) {
  const router = useRouter();

  const columns = useMemo<DataTableColumn<AttributeDefinition>[]>(
    () => [
      {
        id: "order",
        header: "Order",
        sortField: "sort_order",
        widthClassName: "w-16",
        cell: (a) => (
          <span className="font-mono text-xs text-muted-foreground">
            {a.sort_order}
          </span>
        ),
      },
      {
        id: "label",
        header: "Label",
        sortField: "label",
        hideable: false,
        widthClassName: "min-w-[12rem]",
        cell: (a) => (
          <div className="flex flex-col">
            <span className="truncate font-medium">{a.label}</span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {a.key}
            </span>
          </div>
        ),
      },
      {
        id: "scope",
        header: "Scope",
        sortField: "scope",
        widthClassName: "w-32",
        cell: (a) => <Badge tone="muted">{SCOPE_LABEL[a.scope]}</Badge>,
      },
      {
        id: "type",
        header: "Type",
        sortField: "attribute_type",
        widthClassName: "w-24",
        cell: (a) => (
          <span className="font-mono text-xs">{TYPE_LABEL[a.attribute_type]}</span>
        ),
      },
      {
        id: "required",
        header: "Required",
        widthClassName: "w-24",
        cell: (a) =>
          a.required ? (
            <Badge tone="amber">Required</Badge>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "status",
        header: "Status",
        sortField: "is_active",
        widthClassName: "w-24",
        cell: (a) => (
          <Badge tone={a.is_active ? "emerald" : "muted"}>
            {a.is_active ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      ...auditColumns<AttributeDefinition>(),
    ],
    [],
  );

  return (
    <DataTable
      tableId="attribute-definitions"
      columns={columns}
      rowKey={(a) => String(a.id)}
      fetchPage={fetchPage}
      initialPage={initialPage}
      searchPlaceholder="Search by key, label, help text…"
      defaultSort={DEFAULT_SORT}
      onRowClick={(a) => router.push(`/settings/attribute-definitions/${a.uuid}`)}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No custom attributes yet</p>
          <p className="text-xs text-muted-foreground">
            Define typed extension fields per item type — the items form will
            render them automatically based on scope.
          </p>
        </div>
      }
    />
  );
}
