"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FilePlus, Printer } from "lucide-react";
import { PrintLabelDialog } from "./print-label-dialog";
import { DataTable } from "@/components/data-table";
import type {
  DataTableColumn,
  FilterDef,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge-mini";
import { Button } from "@/components/ui/button";
import { auditColumns } from "@/components/audit/audit-table-columns";
import type { StockLot, StockLotStatus, Warehouse } from "@/lib/types";
import {
  formatCompanyDate,
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

interface LotsTableProps {
  initialPage: PageResult<StockLot>;
  warehouses: Warehouse[];
  canReceive: boolean;
}

const DEFAULT_SORT: SortSpec = { field: "id", direction: "desc" };

// Status → badge tone. We bias toward emerald (the happy path) for
// `received`, amber for transitional states, muted for terminal.
const STATUS_TONE: Record<
  StockLotStatus,
  "emerald" | "amber" | "muted" | "destructive" | "indigo"
> = {
  requested: "indigo",
  received: "emerald",
  quarantine: "amber",
  depleted: "muted",
  disposed: "muted",
  rejected: "destructive",
};

const STATUS_LABEL: Record<StockLotStatus, string> = {
  requested: "Requested",
  received: "Received",
  quarantine: "Quarantine",
  depleted: "Depleted",
  disposed: "Disposed",
  rejected: "Rejected",
};

const STATUS_FILTER: FilterDef = {
  field: "status",
  label: "Status",
  options: (
    [
      "requested",
      "received",
      "quarantine",
      "depleted",
      "disposed",
      "rejected",
    ] as StockLotStatus[]
  ).map((s) => ({ label: STATUS_LABEL[s], value: s })),
};

async function fetchLotsPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  search: string;
}): Promise<PageResult<StockLot>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  for (const [k, v] of Object.entries(params.filters)) {
    qs.set(k, String(v));
  }

  const res = await fetch(`/api/stock/lots?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<StockLot>;
}

export function LotsTable({
  initialPage,
  warehouses,
  canReceive,
}: LotsTableProps) {
  const router = useRouter();
  const prefs = useFormatPrefs();
  const [printLot, setPrintLot] = useState<StockLot | null>(null);

  // Warehouses are dynamic per-company so the FilterDef is built at
  // render time rather than statically. Stable identity via useMemo so
  // the DataTable doesn't see a fresh `filters` array every render.
  const filters = useMemo<FilterDef[]>(() => {
    const out: FilterDef[] = [STATUS_FILTER];
    if (warehouses.length > 0) {
      out.push({
        field: "warehouse_id",
        label: "Warehouse",
        options: warehouses.map((w) => ({
          label: w.name,
          value: w.id,
        })),
      });
    }
    return out;
  }, [warehouses]);

  const formatQty = (qty: string | null | undefined, symbol?: string | null) => {
    const formatted = formatCompanyNumber(qty, prefs);
    if (formatted === "—") return formatted;
    return symbol ? `${formatted} ${symbol}` : formatted;
  };
  const formatMoney = (value: string | null, currency: string | null) =>
    formatCompanyMoney(value, prefs, { currency_code: currency });
  const formatDate = (value: string | null) => formatCompanyDate(value, prefs);

  const columns = useMemo<DataTableColumn<StockLot>[]>(
    () => [
      {
        id: "code",
        header: "Lot",
        sortField: "id",
        sortLabels: { asc: "Oldest first", desc: "Newest first" },
        widthClassName: "w-28",
        hideable: false,
        cell: (l) => (
          <span className="font-mono text-xs font-semibold">
            {l.code ?? `#${l.id}`}
          </span>
        ),
      },
      {
        id: "item",
        header: "Item",
        widthClassName: "min-w-[16rem]",
        cell: (l) =>
          l.item ? (
            <div className="space-y-0.5">
              <p className="truncate font-medium">{l.item.name}</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {l.item.code ?? l.item.external_sku ?? "—"}
              </p>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "status",
        header: "Status",
        sortField: "status",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-32",
        cell: (l) => (
          <Badge tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</Badge>
        ),
      },
      {
        id: "qty_received",
        header: "Starting qty",
        sortField: "qty_received",
        sortLabels: { asc: "Smallest first", desc: "Largest first" },
        widthClassName: "w-28",
        align: "right",
        cell: (l) => (
          <span className="font-mono text-xs">
            {formatQty(l.qty_received, l.unit_of_measurement?.symbol)}
          </span>
        ),
      },
      {
        id: "qty_on_hand",
        header: "On hand",
        widthClassName: "w-28",
        align: "right",
        cell: (l) => (
          <span className="font-mono text-xs">
            {formatQty(l.qty_on_hand, l.unit_of_measurement?.symbol)}
          </span>
        ),
      },
      {
        id: "unit_cost",
        header: "Unit cost",
        sortField: "unit_cost",
        sortLabels: { asc: "Cheapest first", desc: "Priciest first" },
        widthClassName: "w-28",
        align: "right",
        cell: (l) => (
          <span className="font-mono text-xs text-muted-foreground">
            {formatMoney(l.unit_cost, l.currency)}
          </span>
        ),
      },
      {
        id: "supplier_batch_no",
        header: "Supplier batch",
        sortField: "supplier_batch_no",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-36",
        cell: (l) =>
          l.supplier_batch_no ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {l.supplier_batch_no}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "expiry_at",
        header: "Expires",
        sortField: "expiry_at",
        sortLabels: { asc: "Soonest first", desc: "Latest first" },
        widthClassName: "w-28",
        cell: (l) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(l.expiry_at)}
          </span>
        ),
      },
      {
        id: "received_at",
        header: "Received",
        sortField: "received_at",
        sortLabels: { asc: "Oldest first", desc: "Newest first" },
        widthClassName: "w-28",
        defaultHidden: true,
        cell: (l) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(l.received_at)}
          </span>
        ),
      },
      {
        id: "print",
        header: "",
        widthClassName: "w-12",
        hideable: false,
        align: "right",
        // Opens the "how many labels?" modal — MRPEasy parity. The
        // modal then opens the PDF endpoint in a new tab so the
        // browser's PDF viewer handles the preview + print dialog.
        //
        // Rendered as `<span role="button">` rather than `<button>`
        // because the DataTable's mobile card layout wraps the whole
        // row in a `<button>`, and nesting buttons is invalid HTML
        // (hydration error). `onPointerDown` triggers the action and
        // stops propagation so the outer row-click never fires.
        cell: (l) => (
          <span
            role="button"
            tabIndex={0}
            onPointerDown={(e) => {
              e.stopPropagation();
              setPrintLot(l);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setPrintLot(l);
              }
            }}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Print label for ${l.code ?? l.id}`}
            title="Print label"
          >
            <Printer className="size-3.5" />
          </span>
        ),
      },
      ...auditColumns<StockLot>(),
    ],
    // Recompute when prefs change so date/qty/money cells re-render
    // against the latest company settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefs.date_format, prefs.decimal_separator, prefs.thousands_separator, prefs.currency_code, prefs.currency_format],
  );

  return (
    <>
      <DataTable
        tableId="stock-lots"
        columns={columns}
        rowKey={(l) => String(l.id)}
        fetchPage={fetchLotsPage}
        initialPage={initialPage}
        searchPlaceholder="Search supplier batch, source ref, notes…"
        filters={filters}
        defaultSort={DEFAULT_SORT}
        onRowClick={(l) => router.push(`/stock/lots/${l.uuid}`)}
        toolbarActions={
          canReceive ? (
            <Button asChild size="sm">
              <Link href="/stock/lots/new">
                <FilePlus className="mr-1.5 size-4" />
                Add manual lot
              </Link>
            </Button>
          ) : undefined
        }
        emptyState={
          <div className="space-y-1">
            <p className="text-sm font-medium">No stock lots yet</p>
            <p className="text-xs text-muted-foreground">
              Add a manual lot for opening balances or adjustments. Real
              receives will arrive here automatically from the Procurement
              module once it ships.
            </p>
          </div>
        }
      />

      <PrintLabelDialog
        lot={printLot}
        open={printLot !== null}
        onOpenChange={(open) => !open && setPrintLot(null)}
      />
    </>
  );
}
