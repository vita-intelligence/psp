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
import type { ProductFamily } from "@/lib/types";

interface ProductFamiliesTableProps {
  initialPage: PageResult<ProductFamily>;
}

const DEFAULT_SORT: SortSpec = { field: "name", direction: "asc" };

async function fetchFamiliesPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<ProductFamily>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  serializeColumnFilters(qs, params.columnFilters);

  const res = await fetch(`/api/product-families?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<ProductFamily>;
}

export function ProductFamiliesTable({
  initialPage,
}: ProductFamiliesTableProps) {
  const router = useRouter();

  const columns = useMemo<DataTableColumn<ProductFamily>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        sortField: "code",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-28",
        filterField: "id",
        filterKind: "text",
        filterPlaceholder: "PF00001…",
        group: "Identity",
        description: "Auto-numbered product-family code.",
        cell: (f) =>
          f.code ? (
            <span className="font-mono text-xs text-muted-foreground">
              {f.code}
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
        widthClassName: "min-w-[16rem]",
        filterField: "name",
        filterKind: "text",
        filterPlaceholder: "Family name…",
        group: "Identity",
        description: "Display name of this product family.",
        cell: (f) => (
          <span className="truncate font-medium">{f.name}</span>
        ),
      },
      {
        id: "description",
        header: "Description",
        widthClassName: "min-w-[20rem]",
        filterField: "description",
        filterKind: "text",
        filterPlaceholder: "Description…",
        group: "Meta",
        description: "Free-form description of this family.",
        cell: (f) =>
          f.description ? (
            <span className="line-clamp-1 text-xs text-muted-foreground">
              {f.description}
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
        filterField: "is_active",
        filterKind: "boolean",
        group: "Status",
        description: "Whether this family is currently active.",
        cell: (f) => (
          <Badge tone={f.is_active ? "emerald" : "muted"}>
            {f.is_active ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      ...auditColumns<ProductFamily>(),
    ],
    [],
  );

  return (
    <DataTable
      tableId="product-families"
      realtimeEntity="product-family"
      columns={columns}
      rowKey={(f) => String(f.id)}
      fetchPage={fetchFamiliesPage}
      initialPage={initialPage}
      searchPlaceholder="Search by name…"
      defaultSort={DEFAULT_SORT}
      onRowClick={(f) =>
        router.push(`/settings/product-families/${f.uuid}`)
      }
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No families yet</p>
          <p className="text-xs text-muted-foreground">
            Group variant SKUs under a family so the items list reads as
            one product family with its variants, not a flat alphabetical
            mush. Optional — items can live family-less.
          </p>
        </div>
      }
    />
  );
}
