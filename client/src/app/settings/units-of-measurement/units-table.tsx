"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { DataTable } from "@/components/data-table";
import type {
  DataTableColumn,
  PageResult,
  SortSpec,
} from "@/components/data-table";
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

async function fetchUnitsPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  search: string;
}): Promise<PageResult<UnitOfMeasurement>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);

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
        cell: (u) => <span className="truncate font-medium">{u.name}</span>,
      },
      {
        id: "dimension",
        header: "Dimension",
        sortField: "dimension",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-32",
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
        cell: (u) => (
          <Badge tone={u.is_active ? "emerald" : "muted"}>
            {u.is_active ? "Active" : "Inactive"}
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
