"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Microscope } from "lucide-react";
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
import type { InspectionStatus, QualityDecision } from "@/lib/goods-in/types";
import type {
  InspectionSummary,
  InspectionsLedgerPage,
} from "@/lib/inspections/types";
import type { Warehouse } from "@/lib/types";

interface Props {
  initialPage: InspectionsLedgerPage;
  warehouses: Warehouse[];
  /** Location filters built server-side via `buildLocationFilters()`. */
  locationFilters?: FilterDef[];
}

const STATUS_LABEL: Record<InspectionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  hold: "On hold",
  rejected: "Rejected",
};

const STATUS_TONE: Record<
  InspectionStatus,
  "muted" | "amber" | "emerald" | "destructive" | "indigo"
> = {
  draft: "muted",
  submitted: "indigo",
  approved: "emerald",
  hold: "amber",
  rejected: "destructive",
};

const DECISION_LABEL: Record<QualityDecision, string> = {
  approved: "Approved",
  hold: "On hold",
  rejected: "Rejected",
};

const DECISION_TONE: Record<
  QualityDecision,
  "emerald" | "amber" | "destructive"
> = {
  approved: "emerald",
  hold: "amber",
  rejected: "destructive",
};

const STATUS_OPTIONS = (
  Object.keys(STATUS_LABEL) as InspectionStatus[]
).map((s) => ({ label: STATUS_LABEL[s], value: s }));

const DECISION_OPTIONS = (
  Object.keys(DECISION_LABEL) as QualityDecision[]
).map((d) => ({ label: DECISION_LABEL[d], value: d }));

const STATUS_FILTER: FilterDef = {
  field: "status",
  label: "Status",
  options: STATUS_OPTIONS,
};

// Viewer-aware filter. Pair with `Status: Submitted` to reproduce the
// mobile "Needs my sign-off" chip — the BE resolves `mine=true` to
// `goods_in_operator_id = current_user.id OR quality_approver_id =
// current_user.id` so QC also sees rows they signed off on.
const MINE_FILTER: FilterDef = {
  field: "mine",
  label: "Owner",
  options: [{ label: "Mine only", value: "true" }],
};

const DEFAULT_SORT: SortSpec = { field: "delivery_date", direction: "desc" };

async function fetchInspectionsPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<InspectionSummary>> {
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
  const res = await fetch(`/api/procurement/inspections?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<InspectionSummary>;
}

/**
 * Desktop "global inspections" ledger. Mirrors `InvoicesLedger` so the
 * tables feel the same — only difference is the row-click navigates to
 * a read-only detail page instead of a collab edit dialog, because the
 * inspection wizard itself already owns the editable surface (mobile).
 */
export function InspectionsLedger({
  initialPage,
  warehouses,
  locationFilters,
}: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const filters = useMemo<FilterDef[]>(() => {
    // Prefer server-supplied buildLocationFilters(); fall back to the
    // legacy prop-passed warehouses list when the caller hasn't been
    // migrated yet.
    if (locationFilters && locationFilters.length > 0) {
      return [STATUS_FILTER, MINE_FILTER, ...locationFilters];
    }
    const warehouseFilter: FilterDef = {
      field: "warehouse_id",
      label: "Warehouse",
      options: warehouses
        .filter((w) => w.is_active)
        .map((w) => ({ label: w.name, value: String(w.id) })),
    };
    return warehouseFilter.options.length > 0
      ? [STATUS_FILTER, MINE_FILTER, warehouseFilter]
      : [STATUS_FILTER, MINE_FILTER];
  }, [warehouses, locationFilters]);

  const columns = useMemo<DataTableColumn<InspectionSummary>[]>(
    () => [
      {
        id: "code",
        header: "GI #",
        widthClassName: "w-28",
        filterField: "id",
        filterKind: "text",
        filterPlaceholder: "GI00001…",
        group: "Identity",
        description: "Auto-numbered goods-in inspection code (GI00001, …).",
        cell: (i) => (
          <span className="font-mono text-xs font-semibold">
            {i.code ?? `#${i.id}`}
          </span>
        ),
      },
      {
        id: "po_code",
        header: "PO",
        widthClassName: "w-28",
        group: "Identity",
        description: "Parent purchase order this inspection was raised against.",
        cell: (i) =>
          i.purchase_order ? (
            <Link
              href={`/procurement/purchase-orders/${i.purchase_order.uuid}`}
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-xs font-semibold text-muted-foreground hover:underline"
            >
              {i.purchase_order.code ?? `#${i.purchase_order.id}`}
            </Link>
          ) : (
            <span className="font-mono text-xs text-muted-foreground/50">
              —
            </span>
          ),
      },
      {
        id: "vendor",
        header: "Vendor",
        widthClassName: "min-w-[12rem]",
        group: "Identity",
        description: "Supplier the parent PO is raised with.",
        cell: (i) =>
          i.purchase_order?.vendor ? (
            <span className="truncate text-sm">
              {i.purchase_order.vendor.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "delivery_date",
        header: "Delivery date",
        sortField: "delivery_date",
        widthClassName: "w-32",
        filterField: "delivery_date",
        filterKind: "date-range",
        group: "Dates",
        description: "Date goods physically arrived at the warehouse.",
        cell: (i) =>
          i.delivery_date ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(i.delivery_date, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "operator",
        header: "Operator",
        widthClassName: "min-w-[10rem]",
        group: "Identity",
        description: "Goods-in operator who ran the inspection.",
        cell: (i) =>
          i.goods_in_operator ? (
            <span className="truncate text-sm">
              {i.goods_in_operator.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "status",
        header: "Status",
        sortField: "status",
        widthClassName: "w-28",
        filterField: "status",
        filterKind: "select",
        filterOptions: STATUS_OPTIONS,
        group: "Status",
        description: "Inspection lifecycle — draft → submitted → approved/hold/rejected.",
        cell: (i) => (
          <Badge tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge>
        ),
      },
      {
        id: "quality_decision",
        header: "QC decision",
        widthClassName: "w-32",
        group: "Compliance",
        description: "Quality verdict recorded by the QC approver on sign-off.",
        cell: (i) =>
          i.quality_decision ? (
            <Badge tone={DECISION_TONE[i.quality_decision]}>
              {DECISION_LABEL[i.quality_decision]}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "approver",
        header: "Approver",
        widthClassName: "min-w-[10rem]",
        defaultHidden: true,
        group: "Identity",
        description: "QC user who signed off — must be a different actor than the operator.",
        cell: (i) =>
          i.quality_approver ? (
            <span className="truncate text-sm">
              {i.quality_approver.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "quality_decision_filter",
        header: "QC decision (filter)",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "quality_decision",
        filterKind: "select",
        filterOptions: DECISION_OPTIONS,
        group: "Compliance",
        description: "Filter-only helper for quality decision.",
        cell: (i) =>
          i.quality_decision ? (
            <Badge tone={DECISION_TONE[i.quality_decision]}>
              {DECISION_LABEL[i.quality_decision]}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "operator_signed_at",
        header: "Operator signed",
        widthClassName: "w-36",
        defaultHidden: true,
        group: "Dates",
        description: "Timestamp of the goods-in operator's ESIGN.",
        cell: (i) =>
          i.goods_in_operator_signed_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(i.goods_in_operator_signed_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "approver_signed_at",
        header: "Approver signed",
        widthClassName: "w-36",
        defaultHidden: true,
        group: "Dates",
        description: "Timestamp of the QC approver's ESIGN — inspection is closed after this.",
        cell: (i) =>
          i.quality_approver_signed_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(i.quality_approver_signed_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "po_status",
        header: "PO status",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Identity",
        description: "Lifecycle state of the parent purchase order.",
        cell: (i) =>
          i.purchase_order?.status ? (
            <span className="text-xs text-muted-foreground">
              {i.purchase_order.status}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "vendor_code",
        header: "Vendor code",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Identity",
        description: "Auto-numbered vendor code.",
        cell: (i) =>
          i.purchase_order?.vendor ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {i.purchase_order.vendor.uuid.slice(0, 8)}
            </span>
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
        description: "When this inspection draft was created.",
        cell: (i) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(i.inserted_at, prefs)}
          </span>
        ),
      },
      {
        id: "updated_at",
        header: "Updated",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Meta",
        description: "When this inspection was last modified.",
        cell: (i) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(i.updated_at, prefs)}
          </span>
        ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<InspectionSummary>
      tableId="procurement-inspections"
      columns={columns}
      rowKey={(i) => String(i.id)}
      fetchPage={fetchInspectionsPage}
      initialPage={{
        items: initialPage.items,
        next_cursor: initialPage.next_cursor,
      }}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search transport, vehicle, seal…"
      filters={filters}
      onRowClick={(i) => {
        router.push(`/procurement/inspections/${i.uuid}`);
      }}
      renderMobileCard={(i) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm font-semibold">
                {i.code ?? `#${i.id}`}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {i.purchase_order?.vendor?.name ?? "—"} ·{" "}
                {i.purchase_order?.code ?? "—"}
              </p>
            </div>
            <Badge tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge>
          </div>
          {i.delivery_date && (
            <p className="text-right text-[11px] text-muted-foreground">
              Delivered {formatCompanyDate(i.delivery_date, prefs)}
            </p>
          )}
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <Microscope className="mx-auto size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No inspections yet</p>
          <p className="text-xs text-muted-foreground">
            Inspections appear here once an operator opens a draft against
            an incoming delivery.
          </p>
        </div>
      }
    />
  );
}
