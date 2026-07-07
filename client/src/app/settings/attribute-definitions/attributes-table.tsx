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
  consumable: "Consumable",
  item_any: "Any item",
};

const SCOPE_OPTIONS = (
  Object.keys(SCOPE_LABEL) as AttributeScope[]
).map((s) => ({ label: SCOPE_LABEL[s], value: s }));

const TYPE_LABEL: Record<AttributeType, string> = {
  text: "Text",
  number: "Number",
  boolean: "Boolean",
  date: "Date",
  enum: "Enum",
  url: "URL",
};

const TYPE_OPTIONS = (
  Object.keys(TYPE_LABEL) as AttributeType[]
).map((t) => ({ label: TYPE_LABEL[t], value: t }));

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
        filterField: "sort_order",
        filterKind: "number-range",
        group: "Meta",
        description: "Manual sort order (lower = earlier in the item form).",
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
        filterField: "label",
        filterKind: "text",
        filterPlaceholder: "Attribute label…",
        group: "Identity",
        description: "Human-readable label shown in the item form.",
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
        filterField: "scope",
        filterKind: "select",
        filterOptions: SCOPE_OPTIONS,
        group: "Identity",
        description: "Which item type this attribute applies to.",
        cell: (a) => <Badge tone="muted">{SCOPE_LABEL[a.scope]}</Badge>,
      },
      {
        id: "type",
        header: "Type",
        sortField: "attribute_type",
        widthClassName: "w-24",
        filterField: "attribute_type",
        filterKind: "select",
        filterOptions: TYPE_OPTIONS,
        group: "Identity",
        description: "Value type — drives input rendering + validation.",
        cell: (a) => (
          <span className="font-mono text-xs">{TYPE_LABEL[a.attribute_type]}</span>
        ),
      },
      {
        id: "required",
        header: "Required",
        widthClassName: "w-24",
        filterField: "required",
        filterKind: "boolean",
        group: "Compliance",
        description: "Whether the item form makes this attribute required.",
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
        filterField: "is_active",
        filterKind: "boolean",
        group: "Status",
        description: "Whether this definition is currently active.",
        cell: (a) => (
          <Badge tone={a.is_active ? "emerald" : "muted"}>
            {a.is_active ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "key",
        header: "Key",
        widthClassName: "w-40",
        defaultHidden: true,
        filterField: "key",
        filterKind: "text",
        filterPlaceholder: "attribute_key…",
        group: "Identity",
        description: "Machine-readable key stored in items.attributes JSONB.",
        cell: (a) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {a.key}
          </span>
        ),
      },
      {
        id: "unit_symbol",
        header: "Unit",
        widthClassName: "w-20",
        defaultHidden: true,
        group: "Amounts",
        description: "Optional unit-of-measurement symbol appended to the value.",
        cell: (a) =>
          a.unit_symbol ? (
            <span className="font-mono text-xs">{a.unit_symbol}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "help_text",
        header: "Help text",
        widthClassName: "min-w-[14rem]",
        defaultHidden: true,
        group: "Meta",
        description: "Hint copy shown under the input in the item form.",
        cell: (a) =>
          a.help_text ? (
            <span className="line-clamp-1 text-xs text-muted-foreground">
              {a.help_text}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "enum_choices_count",
        header: "Choices",
        widthClassName: "w-20",
        align: "right",
        defaultHidden: true,
        group: "Meta",
        description: "How many enum options are defined (only relevant for enum type).",
        cell: (a) => (
          <span className="font-mono text-xs">
            {a.enum_choices?.length ?? 0}
          </span>
        ),
      },
      {
        id: "has_default",
        header: "Default",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Meta",
        description: "Whether a default value is pre-filled on the item form.",
        cell: (a) => (
          <Badge tone={a.default_value ? "sky" : "muted"}>
            {a.default_value ? "Set" : "None"}
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
      realtimeEntity="attribute-definition"
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
