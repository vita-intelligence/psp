"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Microscope } from "lucide-react";
import { DataTable } from "@/components/data-table";
import type {
  DataTableColumn,
  FilterDef,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge-mini";
import { formatCompanyDate } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type { InspectionStatus, QualityDecision } from "@/lib/goods-in/types";
import type {
  InspectionSummary,
  InspectionsLedgerPage,
} from "@/lib/inspections/types";

interface Props {
  initialPage: InspectionsLedgerPage;
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

const STATUS_FILTER: FilterDef = {
  field: "status",
  label: "Status",
  options: [
    { label: "Draft", value: "draft" },
    { label: "Submitted", value: "submitted" },
    { label: "Approved", value: "approved" },
    { label: "On hold", value: "hold" },
    { label: "Rejected", value: "rejected" },
  ],
};

const DEFAULT_SORT: SortSpec = { field: "delivery_date", direction: "desc" };

async function fetchInspectionsPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
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
export function InspectionsLedger({ initialPage }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const filters = useMemo<FilterDef[]>(() => [STATUS_FILTER], []);

  const columns = useMemo<DataTableColumn<InspectionSummary>[]>(
    () => [
      {
        id: "code",
        header: "GI #",
        widthClassName: "w-28",
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
        cell: (i) => (
          <Badge tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge>
        ),
      },
      {
        id: "quality_decision",
        header: "QC decision",
        widthClassName: "w-32",
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
        cell: (i) =>
          i.quality_approver ? (
            <span className="truncate text-sm">
              {i.quality_approver.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
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
