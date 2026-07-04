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
import type { UnitDimension, UnitOfMeasurement } from "@/lib/types";

interface UnitsTableProps {
  initialPage: PageResult<UnitOfMeasurement>;
}

const DEFAULT_SORT: SortSpec = { field: "name", direction: "asc" };

const DIMENSION_TONE: Record<
  UnitDimension,
  "muted" | "amber" | "indigo" | "emerald" | "brand" | "destructive"
> = {
  mass: "indigo",
  volume: "amber",
  count: "muted",
  length: "emerald",
  area: "brand",
  time: "destructive",
};

const DIMENSION_LABEL: Record<UnitDimension, string> = {
  mass: "Mass",
  volume: "Volume",
  count: "Count",
  length: "Length",
  area: "Area",
  time: "Time",
};

const DIMENSION_OPTIONS = (
  Object.keys(DIMENSION_LABEL) as UnitDimension[]
).map((d) => ({ label: DIMENSION_LABEL[d], value: d }));

async function fetchUnitsPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<UnitOfMeasurement>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  serializeColumnFilters(qs, params.columnFilters);

  const res = await fetch(`/api/units-of-measurement?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<UnitOfMeasurement>;
}

export function UnitsTable({ initialPage }: UnitsTableProps) {
  const router = useRouter();

  const columns = useMemo<DataTableColumn<UnitOfMeasurement>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        sortField: "code",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-28",
        filterField: "id",
        filterKind: "text",
        filterPlaceholder: "UM00001…",
        group: "Identity",
        description: "Auto-numbered unit code.",
        cell: (u) =>
          u.code ? (
            <span className="font-mono text-xs text-muted-foreground">
              {u.code}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "symbol",
        header: "Symbol",
        sortField: "symbol",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-28",
        filterField: "symbol",
        filterKind: "text",
        filterPlaceholder: "kg…",
        group: "Identity",
        description: "Short display symbol (kg, g, L, …).",
        cell: (u) => (
          <span className="font-mono text-sm font-semibold">{u.symbol}</span>
        ),
      },
      {
        id: "name",
        header: "Name",
        sortField: "name",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        hideable: false,
        widthClassName: "min-w-[12rem]",
        filterField: "name",
        filterKind: "text",
        filterPlaceholder: "Kilogram…",
        group: "Identity",
        description: "Human-readable name of this unit.",
        cell: (u) => <span className="truncate font-medium">{u.name}</span>,
      },
      {
        id: "dimension",
        header: "Dimension",
        sortField: "dimension",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-32",
        filterField: "dimension",
        filterKind: "select",
        filterOptions: DIMENSION_OPTIONS,
        group: "Identity",
        description: "Physical dimension (mass, volume, count, …).",
        cell: (u) => (
          <Badge tone={DIMENSION_TONE[u.dimension]}>
            {DIMENSION_LABEL[u.dimension]}
          </Badge>
        ),
      },
      {
        id: "factor",
        header: "Factor",
        sortField: "factor_to_base",
        sortLabels: { asc: "Smallest first", desc: "Largest first" },
        widthClassName: "w-40",
        align: "right",
        filterField: "factor_to_base",
        filterKind: "number-range",
        group: "Amounts",
        description: "Multiplier to convert this unit to the base unit of its dimension.",
        cell: (u) =>
          u.is_base ? (
            <span className="text-xs text-muted-foreground">
              base
            </span>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              {u.factor_to_base}
            </span>
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
        description: "Whether this unit is currently active.",
        cell: (u) => (
          <Badge tone={u.is_active ? "emerald" : "muted"}>
            {u.is_active ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "is_base",
        header: "Base unit",
        widthClassName: "w-28",
        defaultHidden: true,
        filterField: "is_base",
        filterKind: "boolean",
        group: "Amounts",
        description: "Base unit of its dimension (factor 1). One per dimension.",
        cell: (u) => (
          <Badge tone={u.is_base ? "brand" : "muted"}>
            {u.is_base ? "Base" : "Derived"}
          </Badge>
        ),
      },
      ...auditColumns<UnitOfMeasurement>(),
    ],
    [],
  );

  return (
    <DataTable
      tableId="units-of-measurement"
      columns={columns}
      rowKey={(u) => String(u.id)}
      fetchPage={fetchUnitsPage}
      initialPage={initialPage}
      searchPlaceholder="Search by name or symbol…"
      defaultSort={DEFAULT_SORT}
      onRowClick={(u) => router.push(`/settings/units-of-measurement/${u.uuid}`)}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No units yet</p>
          <p className="text-xs text-muted-foreground">
            Common SI defaults usually arrive pre-seeded — if this is empty
            you may need to run the seed migration.
          </p>
        </div>
      }
    />
  );
}
