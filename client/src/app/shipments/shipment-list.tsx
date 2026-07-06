"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import type {
  ColumnFilterValue,
  DataTableColumn,
  FilterDef,
  FilterValue,
  PageResult,
  SortSpec,
} from "@/components/data-table/types";
import { serializeColumnFilters } from "@/lib/data-table/serialize";
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
  /** Location filters built server-side via `buildLocationFilters()`. */
  locationFilters?: FilterDef[];
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
    label: "In transit",
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  },
  delivered: {
    label: "Delivered",
    className:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  },
  cancelled: {
    label: "Cancelled",
    className:
      "border-destructive/40 bg-destructive/5 text-destructive",
  },
};

const STATUS_OPTIONS = (
  Object.keys(STATUS_TONE) as ShipmentStatus[]
).map((s) => ({ label: STATUS_TONE[s].label, value: s }));

async function fetchPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: FilterValue;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<Shipment>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  const status = params.filters.status;
  if (typeof status === "string" && status.length > 0) qs.set("status", status);
  const warehouseId = params.filters.warehouse_id;
  if (warehouseId !== undefined && warehouseId !== "") {
    qs.set("warehouse_id", String(warehouseId));
  }
  if (params.search) qs.set("search", params.search);
  serializeColumnFilters(qs, params.columnFilters);

  const res = await fetch(`/api/shipments?${qs.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) return { items: [], next_cursor: null };
  return (await res.json()) as PageResult<Shipment>;
}

export function ShipmentList({
  initialPage,
  companyDefaults,
  locationFilters,
}: Props) {
  const router = useRouter();

  const filters = useMemo<FilterDef[]>(
    () => [
      {
        field: "status",
        label: "Status",
        options: [
          ...STATUS_OPTIONS,
          { label: "All statuses", value: "all" },
        ],
      },
      ...(locationFilters ?? []),
    ],
    [locationFilters],
  );

  const columns = useMemo<DataTableColumn<Shipment>[]>(
    () => [
      {
        id: "lot",
        header: "Lot",
        widthClassName: "min-w-[14rem]",
        group: "Identity",
        description: "The stock lot being shipped.",
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
        widthClassName: "min-w-[12rem]",
        filterField: "customer",
        filterKind: "text",
        filterPlaceholder: "Customer name…",
        group: "Identity",
        description: "Customer receiving this shipment. Filter by customer name.",
        cell: (s) => (
          <p className="truncate text-sm">{s.customer?.name ?? "—"}</p>
        ),
      },
      {
        id: "qty",
        header: "Qty",
        align: "right",
        widthClassName: "w-24",
        filterField: "qty",
        filterKind: "number-range",
        group: "Amounts",
        description: "Quantity leaving the warehouse.",
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
        widthClassName: "w-40",
        filterField: "carrier",
        filterKind: "text",
        filterPlaceholder: "Carrier…",
        group: "Meta",
        description: "Haulier + vehicle registration for pickup.",
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
        widthClassName: "w-32",
        filterField: "consignment_note_ref",
        filterKind: "text",
        filterPlaceholder: "Waybill…",
        group: "Compliance",
        description: "Consignment note / waybill reference.",
        cell: (s) => (
          <span className="font-mono text-[11px]">
            {s.consignment_note_ref ?? "—"}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        widthClassName: "w-28",
        filterField: "status",
        filterKind: "select",
        filterOptions: STATUS_OPTIONS,
        group: "Status",
        description: "Draft → ready → picked-up lifecycle.",
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
        widthClassName: "w-32",
        group: "Dates",
        description: "When the draft shipment was raised.",
        cell: (s) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(s.created_at, companyDefaults)}
          </span>
        ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "recipient_name",
        header: "Recipient",
        widthClassName: "min-w-[12rem]",
        defaultHidden: true,
        filterField: "recipient_name",
        filterKind: "text",
        filterPlaceholder: "Recipient…",
        group: "Identity",
        description: "Person / desk receiving the goods on the customer side.",
        cell: (s) =>
          s.recipient_name ? (
            <span className="truncate text-xs">{s.recipient_name}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "ship_to_address",
        header: "Ship to",
        widthClassName: "min-w-[16rem]",
        defaultHidden: true,
        filterField: "ship_to_address",
        filterKind: "text",
        filterPlaceholder: "Address…",
        group: "Location",
        description: "Delivery address.",
        cell: (s) =>
          s.ship_to_address ? (
            <span className="line-clamp-1 text-xs text-muted-foreground">
              {s.ship_to_address}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "ship_to_country",
        header: "Country",
        widthClassName: "w-24",
        defaultHidden: true,
        filterField: "ship_to_country",
        filterKind: "text",
        filterPlaceholder: "GB…",
        group: "Location",
        description: "ISO 3166-1 alpha-2 destination country.",
        cell: (s) =>
          s.ship_to_country ? (
            <span className="font-mono text-xs">{s.ship_to_country}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "driver_name",
        header: "Driver",
        widthClassName: "min-w-[10rem]",
        defaultHidden: true,
        filterField: "driver_name",
        filterKind: "text",
        filterPlaceholder: "Driver…",
        group: "Meta",
        description: "Driver name captured at pickup.",
        cell: (s) =>
          s.driver_name ? (
            <span className="truncate text-xs">{s.driver_name}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "vehicle_registration",
        header: "Vehicle reg.",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "vehicle_registration",
        filterKind: "text",
        filterPlaceholder: "Plate…",
        group: "Meta",
        description: "Truck plate captured at pickup.",
        cell: (s) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {s.vehicle_registration ?? "—"}
          </span>
        ),
      },
      {
        id: "seal_number",
        header: "Seal",
        widthClassName: "w-28",
        defaultHidden: true,
        filterField: "seal_number",
        filterKind: "text",
        filterPlaceholder: "Seal number…",
        group: "Compliance",
        description: "Seal / tamper-evident closure number.",
        cell: (s) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {s.seal_number ?? "—"}
          </span>
        ),
      },
      {
        id: "temperature_c",
        header: "Temp (°C)",
        widthClassName: "w-24",
        align: "right",
        defaultHidden: true,
        filterField: "temperature_c",
        filterKind: "number-range",
        group: "Compliance",
        description: "Vehicle temperature captured at loading (cold chain).",
        cell: (s) =>
          s.temperature_c ? (
            <span className="font-mono text-xs">{s.temperature_c}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "planned_ship_at",
        header: "Planned ship",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "planned_ship_at",
        filterKind: "date-range",
        group: "Dates",
        description: "Planned dispatch date/time.",
        cell: (s) =>
          s.planned_ship_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(s.planned_ship_at, companyDefaults)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "ready_at",
        header: "Ready at",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "ready_at",
        filterKind: "date-range",
        group: "Dates",
        description: "When the paperwork was marked ready-for-pickup.",
        cell: (s) =>
          s.ready_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(s.ready_at, companyDefaults)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "picked_up_at",
        header: "Picked up at",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "picked_up_at",
        filterKind: "date-range",
        group: "Dates",
        description: "When the truck actually left with the goods.",
        cell: (s) =>
          s.picked_up_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(s.picked_up_at, companyDefaults)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "cancelled_at",
        header: "Cancelled at",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "cancelled_at",
        filterKind: "date-range",
        group: "Dates",
        description: "When the shipment was cancelled (if applicable).",
        cell: (s) =>
          s.cancelled_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(s.cancelled_at, companyDefaults)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "warehouse",
        header: "Warehouse",
        widthClassName: "min-w-[10rem]",
        defaultHidden: true,
        group: "Location",
        description: "Warehouse the lot was picked from.",
        cell: (s) =>
          s.stock_lot?.placement?.warehouse_name ? (
            <span className="truncate text-xs">
              {s.stock_lot.placement.warehouse_name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
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
      filters={filters}
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
