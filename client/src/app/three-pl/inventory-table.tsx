"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Boxes, MapPin, Timer } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import type {
  ColumnFilterValue,
  DataTableColumn,
  FilterValue,
  PageResult,
  SortSpec,
} from "@/components/data-table/types";
import type { ThreePLInventoryRow } from "@/lib/three-pl/types";
import type { CompanyDefaults } from "@/lib/types";
import { formatCompanyDate } from "@/lib/format/company";
import { cn } from "@/lib/utils";

interface Props {
  items: ThreePLInventoryRow[];
  companyDefaults: CompanyDefaults | null;
  currency: string | null;
}

const DEFAULT_SORT: SortSpec = {
  field: "bailee_routed_at",
  direction: "desc",
};

/**
 * Bailee-custody inventory list. Uses the shared <DataTable> so this
 * page behaves the same way as every other list surface in PSP —
 * column visibility, sort, search, and row-click navigation.
 *
 * Row click opens `/three-pl/[lot_uuid]`; there's no per-row Dispatch
 * button because dispatch itself is one of the actions the item page
 * exposes. Keeping the row single-action means the whole surface is
 * clickable without ambiguity.
 */
export function ThreePLInventoryTable({
  items,
  companyDefaults,
  currency,
}: Props) {
  const router = useRouter();

  const columns = useMemo<DataTableColumn<ThreePLInventoryRow>[]>(
    () => [
      {
        id: "lot",
        header: "Lot",
        cell: (r) => (
          <div className="min-w-0">
            <p className="truncate font-mono text-[11px]">
              {r.lot.code ?? "—"}
            </p>
            {r.lot.supplier_batch_no && (
              <p className="truncate text-[10px] text-muted-foreground">
                {r.lot.supplier_batch_no}
              </p>
            )}
          </div>
        ),
      },
      {
        id: "item",
        header: "Item",
        cell: (r) => (
          <p className="truncate text-sm">{r.lot.item?.name ?? "—"}</p>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        cell: (r) => (
          <p className="truncate text-sm">
            {r.lot.bailee_customer?.name ?? "—"}
          </p>
        ),
      },
      {
        id: "volume",
        header: "Volume (m³)",
        align: "right",
        cell: (r) => (
          <span className="font-mono text-xs">{r.stored_volume_m3}</span>
        ),
      },
      {
        id: "days_held",
        header: "Days held",
        align: "right",
        cell: (r) => (
          <span className="inline-flex items-center gap-1 text-xs">
            <Timer className="size-3 text-muted-foreground" />
            {r.days_held}
          </span>
        ),
      },
      {
        id: "accrued",
        header: "Accrued",
        align: "right",
        cell: (r) =>
          r.accrued_amount === null || !currency ? (
            <span className="text-xs text-muted-foreground/60">—</span>
          ) : (
            <span className="font-mono text-xs">
              {r.accrued_amount} {currency}
            </span>
          ),
      },
      {
        id: "since",
        header: "Since",
        sortField: "bailee_routed_at",
        sortLabels: { asc: "Oldest first", desc: "Newest first" },
        cell: (r) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(r.lot.bailee_routed_at, companyDefaults)}
          </span>
        ),
      },
      {
        id: "cell",
        header: "Cell",
        cell: (r) => {
          const placement = r.lot.placements?.[0];
          const cell = placement?.storage_cell;
          const location = cell?.storage_location;
          const misplaced =
            cell?.purpose && cell.purpose !== "three_pl_storage";
          return (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px]",
                misplaced && "text-amber-700 dark:text-amber-300",
              )}
            >
              <MapPin className="size-3" />
              {locationLabel(location) ?? "—"}
              {cellLabel(cell) ? ` · ${cellLabel(cell)}` : ""}
              {misplaced && " (needs move)"}
            </span>
          );
        },
      },
    ],
    [companyDefaults, currency],
  );

  const fetchPage = useMemo(
    () => async (params: {
      cursor: string | null;
      limit: number;
      sort: SortSpec | null;
      filters: FilterValue;
      columnFilters: Record<string, ColumnFilterValue>;
      search: string;
    }): Promise<PageResult<ThreePLInventoryRow>> => {
      // /api/three-pl/inventory currently returns every bailee lot in
      // one shot — bailee inventory is bounded (dozens to a few
      // hundred at most). Filter + sort client-side, on the pre-loaded
      // page. When the volume outgrows this we'll add cursor + sort
      // params on the backend.
      let filtered = items;
      if (params.search.trim()) {
        const q = params.search.trim().toLowerCase();
        filtered = filtered.filter((r) => {
          const hay = [
            r.lot.code,
            r.lot.supplier_batch_no,
            r.lot.item?.name,
            r.lot.bailee_customer?.name,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
      }
      const sorted = [...filtered].sort((a, b) => {
        const field = params.sort?.field ?? "bailee_routed_at";
        const dir = params.sort?.direction === "asc" ? 1 : -1;
        const av = a.lot[field as keyof typeof a.lot] as string | null;
        const bv = b.lot[field as keyof typeof b.lot] as string | null;
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return av > bv ? dir : av < bv ? -dir : 0;
      });
      return { items: sorted, next_cursor: null };
    },
    [items],
  );

  return (
    <DataTable<ThreePLInventoryRow>
      tableId="three-pl.inventory"
      initialPage={{ items, next_cursor: null }}
      columns={columns}
      rowKey={(r) => r.lot.uuid}
      defaultSort={DEFAULT_SORT}
      fetchPage={fetchPage}
      onRowClick={(r) =>
        router.push(`/three-pl/${encodeURIComponent(r.lot.uuid)}`)
      }
      searchPlaceholder="Search by lot, item, batch, or customer…"
      emptyState={
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
            <Boxes className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold">Nothing in bailee custody</p>
          <p className="max-w-md text-xs text-muted-foreground">
            When Positive Release fires and the operator routes a lot to 3PL
            storage, the lot shows up here. Own stock stays on the regular
            Stock tab.
          </p>
        </div>
      }
    />
  );
}

// ---------------- Small helpers ----------------

function locationLabel(
  loc: { name?: string | null; code?: string | null } | null | undefined,
): string | null {
  if (!loc) return null;
  const name = loc.name?.trim();
  if (name) return name;
  const code = loc.code?.trim();
  if (code) return code;
  return null;
}

function cellLabel(
  cell:
    | { name?: string | null; code?: string | null; ordinal?: number | null }
    | null
    | undefined,
): string | null {
  if (!cell) return null;
  const name = cell.name?.trim();
  if (name) return name;
  const code = cell.code?.trim();
  if (code) return code;
  if (typeof cell.ordinal === "number") return `Level ${cell.ordinal + 1}`;
  return null;
}

