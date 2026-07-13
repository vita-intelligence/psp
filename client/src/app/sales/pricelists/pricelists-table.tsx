"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { CheckCircle2, Star } from "lucide-react";
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
import type { Pricelist } from "@/lib/types";
import { formatCompanyDate } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

interface Props {
  initialPage: PageResult<Pricelist>;
}

const DEFAULT_SORT: SortSpec = { field: "name", direction: "asc" };

const ACTIVE_FILTER: FilterDef = {
  field: "is_active",
  label: "Active",
  options: [
    { label: "Active", value: true },
    { label: "Inactive", value: false },
  ],
};

async function fetchPricelistsPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<Pricelist>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort) qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  for (const [k, v] of Object.entries(params.filters)) {
    qs.set(k, String(v));
  }
  serializeColumnFilters(qs, params.columnFilters);

  const res = await fetch(`/api/pricelists?${qs.toString()}`, { cache: "no-store" });
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
  return (await res.json()) as PageResult<Pricelist>;
}

export function PricelistsTable({ initialPage }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const filters = useMemo<FilterDef[]>(() => [ACTIVE_FILTER], []);

  const columns = useMemo<DataTableColumn<Pricelist>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        widthClassName: "w-24",
        filterField: "code",
        filterKind: "text",
        filterPlaceholder: "PL00001…",
        group: "Identity",
        description: "Auto-numbered pricelist code.",
        cell: (p) => (
          <span className="font-mono text-xs text-muted-foreground">
            {p.code ?? `#${p.id}`}
          </span>
        ),
      },
      {
        id: "name",
        header: "Name",
        sortField: "name",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        hideable: false,
        widthClassName: "min-w-[20rem]",
        filterField: "name",
        filterKind: "text",
        filterPlaceholder: "Pricelist name…",
        group: "Identity",
        description: "Display name of this pricelist.",
        cell: (p) => (
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-1.5">
              <Link
                href={`/sales/pricelists/${p.uuid}`}
                className="block truncate text-sm font-medium hover:underline"
              >
                {p.name}
              </Link>
              {p.is_default && (
                <Star
                  className="size-3.5 fill-amber-500 text-amber-500"
                  aria-label="Default"
                />
              )}
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              {p.items.length} item{p.items.length === 1 ? "" : "s"}
            </p>
          </div>
        ),
      },
      {
        id: "currency_code",
        header: "Currency",
        sortField: "currency_code",
        widthClassName: "w-24",
        filterField: "currency_code",
        filterKind: "text",
        filterPlaceholder: "GBP…",
        group: "Amounts",
        description: "Currency this pricelist quotes in.",
        cell: (p) => (
          <span className="font-mono text-xs">{p.currency_code}</span>
        ),
      },
      {
        id: "is_active",
        header: "Active",
        widthClassName: "w-24",
        filterField: "is_active",
        filterKind: "boolean",
        group: "Status",
        description: "Whether this pricelist is currently active.",
        cell: (p) =>
          p.is_active ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" />
              Active
            </span>
          ) : (
            <Badge tone="muted">Inactive</Badge>
          ),
      },
      {
        id: "valid_from",
        header: "Valid from",
        sortField: "valid_from",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "valid_from",
        filterKind: "date-range",
        group: "Dates",
        description: "Start of the pricelist's validity window.",
        cell: (p) =>
          p.valid_from ? (
            <span className="text-sm">{formatCompanyDate(p.valid_from, prefs)}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "valid_until",
        header: "Valid until",
        sortField: "valid_until",
        widthClassName: "w-32",
        filterField: "valid_until",
        filterKind: "date-range",
        group: "Dates",
        description: "End of the pricelist's validity window.",
        cell: (p) => {
          if (!p.valid_until)
            return <span className="text-xs text-muted-foreground/50">—</span>;
          const due = new Date(p.valid_until).getTime();
          const days = Math.round((due - Date.now()) / (24 * 60 * 60 * 1000));
          const overdue = days < 0;
          const soon = days >= 0 && days <= 30;
          return (
            <span
              className={
                overdue
                  ? "text-sm font-medium text-destructive"
                  : soon
                    ? "text-sm font-medium text-amber-700 dark:text-amber-400"
                    : "text-sm"
              }
            >
              {formatCompanyDate(p.valid_until, prefs)}
            </span>
          );
        },
      },
      // ---- defaultHidden columns below ----
      {
        id: "is_default",
        header: "Default",
        widthClassName: "w-24",
        defaultHidden: true,
        sortField: "is_default",
        filterField: "is_default",
        filterKind: "boolean",
        group: "Status",
        description: "The company's fallback pricelist. Only one can be default.",
        cell: (p) => (
          <Badge tone={p.is_default ? "amber" : "muted"}>
            {p.is_default ? "Default" : "—"}
          </Badge>
        ),
      },
      {
        id: "items_count",
        header: "Items",
        widthClassName: "w-20",
        align: "right",
        defaultHidden: true,
        group: "Amounts",
        description: "How many items are priced on this pricelist.",
        cell: (p) => (
          <span className="font-mono text-xs">{p.items.length}</span>
        ),
      },
      {
        id: "notes",
        header: "Notes",
        widthClassName: "min-w-[14rem]",
        defaultHidden: true,
        group: "Meta",
        description: "Operator notes about this pricelist.",
        cell: (p) =>
          p.notes ? (
            <span className="line-clamp-1 text-xs text-muted-foreground">
              {p.notes}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      ...auditColumns<Pricelist>(),
    ],
    [prefs],
  );

  return (
    <DataTable<Pricelist>
      tableId="pricelists"
      realtimeEntity="pricelist"
      columns={columns}
      rowKey={(p) => String(p.id)}
      fetchPage={fetchPricelistsPage}
      initialPage={initialPage}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search pricelists by name or notes…"
      filters={filters}
      onRowClick={(p) => router.push(`/sales/pricelists/${p.uuid}`)}
      renderMobileCard={(p) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {p.name}
                {p.is_default && (
                  <Star className="ml-1 inline size-3 fill-amber-500 text-amber-500" />
                )}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {p.code ?? `#${p.id}`} · {p.currency_code} · {p.items.length}{" "}
                item{p.items.length === 1 ? "" : "s"}
              </p>
            </div>
            <Badge tone={p.is_active ? "emerald" : "muted"}>
              {p.is_active ? "Active" : "Inactive"}
            </Badge>
          </div>
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No pricelists yet</p>
          <p className="text-xs text-muted-foreground">
            Add your first pricelist before raising a customer order.
          </p>
        </div>
      }
    />
  );
}
