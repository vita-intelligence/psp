"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import type {
  DataTableColumn,
  FilterValue,
  PageResult,
  SortSpec,
} from "@/components/data-table/types";
import { formatCompanyDate } from "@/lib/format/company";
import type { CompanyDefaults } from "@/lib/types";
import type {
  Shipment,
  ShipmentListResponse,
  ShipmentStatus,
} from "@/lib/shipments/types";
import { cn } from "@/lib/utils";

interface Props {
  initialPage: ShipmentListResponse;
  companyDefaults: CompanyDefaults | null;
}

const DEFAULT_SORT: SortSpec = { field: "inserted_at", direction: "desc" };

const STATUS_TONE: Record<
  ShipmentStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "Draft",
    className:
      "border-border/60 bg-muted text-muted-foreground",
  },
  ready: {
    label: "Ready",
    className:
      "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200",
  },
  picked_up: {
    label: "Picked up",
    className:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  },
  cancelled: {
    label: "Cancelled",
    className:
      "border-destructive/40 bg-destructive/5 text-destructive",
  },
};

async function fetchPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: FilterValue;
  search: string;
}): Promise<PageResult<Shipment>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  const status = params.filters.status;
  if (typeof status === "string" && status.length > 0) qs.set("status", status);
  if (params.search) qs.set("search", params.search);

  const res = await fetch(`/api/shipments?${qs.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) return { items: [], next_cursor: null };
  return (await res.json()) as PageResult<Shipment>;
}

export function ShipmentList({ initialPage, companyDefaults }: Props) {
  const router = useRouter();

  const columns = useMemo<DataTableColumn<Shipment>[]>(
    () => [
      {
        id: "lot",
        header: "Lot",
        cell: (s) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {s.stock_lot?.item?.name ?? "—"}
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {s.stock_lot?.code ?? "—"}
            </p>
          </div>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        cell: (s) => (
          <p className="truncate text-sm">{s.customer?.name ?? "—"}</p>
        ),
      },
      {
        id: "qty",
        header: "Qty",
        align: "right",
        cell: (s) => (
          <span className="font-mono text-xs">
            {s.qty}
            {s.stock_lot?.unit_symbol ? ` ${s.stock_lot.unit_symbol}` : ""}
          </span>
        ),
      },
      {
        id: "carrier",
        header: "Carrier",
        cell: (s) => (
          <div className="min-w-0">
            <p className="truncate text-xs">{s.carrier ?? "—"}</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {s.vehicle_registration ?? ""}
            </p>
          </div>
        ),
      },
      {
        id: "waybill",
        header: "Waybill",
        cell: (s) => (
          <span className="font-mono text-[11px]">
            {s.consignment_note_ref ?? "—"}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: (s) => {
          const meta = STATUS_TONE[s.status];
          return (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                meta.className,
              )}
            >
              {meta.label}
            </span>
          );
        },
      },
      {
        id: "created",
        header: "Created",
        sortField: "inserted_at",
        sortLabels: { asc: "Oldest first", desc: "Newest first" },
        cell: (s) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(s.created_at, companyDefaults)}
          </span>
        ),
      },
    ],
    [companyDefaults],
  );

  return (
    <DataTable<Shipment>
      tableId="shipments.list"
      initialPage={initialPage}
      columns={columns}
      rowKey={(s) => s.uuid}
      defaultSort={DEFAULT_SORT}
      fetchPage={fetchPage}
      onRowClick={(s) =>
        router.push(`/shipments/${encodeURIComponent(s.uuid)}`)
      }
      searchPlaceholder="Search by recipient, waybill, plate, batch, customer…"
      filters={[
        {
          field: "status",
          label: "Status",
          options: [
            { label: "Draft", value: "draft" },
            { label: "Ready", value: "ready" },
            { label: "Picked up", value: "picked_up" },
            { label: "Cancelled", value: "cancelled" },
            { label: "All statuses", value: "all" },
          ],
        },
      ]}
      emptyState={
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
            <Truck className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold">No shipments yet</p>
          <p className="max-w-md text-xs text-muted-foreground">
            When a released lot lands in a dispatch cell, the wizard steers
            you here to create the outbound record. Rows land as drafts and
            move through Ready → Picked up.
          </p>
        </div>
      }
    />
  );
}
