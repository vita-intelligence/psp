"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  CheckCircle2,
  CircleDashed,
  Cog,
  PowerOff,
  Trash2,
  Wrench,
} from "lucide-react";
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
import type { Equipment, EquipmentStatus } from "@/lib/equipment/types";
import { formatCompanyDate } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

interface Props {
  initialPage: PageResult<Equipment>;
}

const DEFAULT_SORT: SortSpec = { field: "inserted_at", direction: "desc" };

const STATUS_LABEL: Record<EquipmentStatus, string> = {
  expected: "Expected",
  received: "Received",
  in_service: "In service",
  under_maintenance: "Under maintenance",
  out_for_repair: "Out for repair",
  awaiting_calibration: "Awaiting calibration",
  retired: "Retired",
  disposed: "Disposed",
  canceled: "Cancelled",
};

const STATUS_TONE: Record<
  EquipmentStatus,
  "muted" | "indigo" | "emerald" | "amber" | "destructive" | "brand" | "sky"
> = {
  expected: "indigo",
  received: "indigo",
  in_service: "emerald",
  under_maintenance: "amber",
  out_for_repair: "amber",
  awaiting_calibration: "amber",
  retired: "muted",
  disposed: "muted",
  canceled: "muted",
};

const STATUS_ICON: Record<EquipmentStatus, typeof CircleDashed> = {
  expected: CircleDashed,
  received: CircleDashed,
  in_service: CheckCircle2,
  under_maintenance: Wrench,
  out_for_repair: Wrench,
  awaiting_calibration: Wrench,
  retired: PowerOff,
  disposed: Trash2,
  canceled: Trash2,
};

const STATUS_OPTIONS = (
  Object.keys(STATUS_LABEL) as EquipmentStatus[]
).map((s) => ({ label: STATUS_LABEL[s], value: s }));

const STATUS_FILTER: FilterDef = {
  field: "status",
  label: "Status",
  options: STATUS_OPTIONS,
};

async function fetchPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<Equipment>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort) qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  for (const [k, v] of Object.entries(params.filters)) qs.set(k, String(v));
  serializeColumnFilters(qs, params.columnFilters);

  const res = await fetch(`/api/equipment?${qs.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      /* leave */
    }
    throw new Error(detail);
  }
  return (await res.json()) as PageResult<Equipment>;
}

export function EquipmentTable({ initialPage }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();

  const filters = useMemo<FilterDef[]>(() => [STATUS_FILTER], []);

  const columns = useMemo<DataTableColumn<Equipment>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        widthClassName: "w-24",
        filterField: "id",
        filterKind: "text",
        filterPlaceholder: "EQ00001…",
        group: "Identity",
        description: "Auto-numbered equipment code.",
        cell: (e) => (
          <span className="font-mono text-xs text-muted-foreground">
            {e.code ?? `#${e.id}`}
          </span>
        ),
      },
      {
        id: "item_name",
        header: "Item",
        hideable: false,
        widthClassName: "min-w-[16rem]",
        group: "Identity",
        description: "Item this unit is an instance of.",
        cell: (e) => (
          <div className="min-w-0">
            <Link
              href={`/equipment/${e.uuid}`}
              className="block truncate text-sm font-medium hover:underline"
            >
              {e.item?.name ?? "—"}
            </Link>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              SN {e.serial_number}
            </p>
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        sortField: "status",
        widthClassName: "w-44",
        filterField: "status",
        filterKind: "select",
        filterOptions: STATUS_OPTIONS,
        group: "Status",
        description: "Current lifecycle state.",
        cell: (e) => {
          const Icon = STATUS_ICON[e.status];
          return (
            <span className="inline-flex items-center gap-1.5">
              <Icon className="size-3.5 text-muted-foreground" />
              <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
            </span>
          );
        },
      },
      {
        id: "cell",
        header: "Cell",
        widthClassName: "w-28",
        group: "Location",
        description: "Current cell.",
        cell: (e) => (
          <span className="text-xs text-muted-foreground">
            {e.current_cell?.name ?? "—"}
          </span>
        ),
      },
      {
        id: "manufacturer",
        header: "Make / model",
        widthClassName: "w-40",
        group: "Identity",
        description: "Manufacturer + model.",
        cell: (e) => (
          <span className="text-xs">
            {e.manufacturer ?? "—"}
            {e.model ? ` · ${e.model}` : ""}
          </span>
        ),
      },
      {
        id: "next_calibration_at",
        header: "Next cal",
        sortField: "next_calibration_at",
        widthClassName: "w-32",
        filterField: "next_calibration_at",
        filterKind: "date-range",
        group: "Cadence",
        description: "Next scheduled calibration.",
        cell: (e) =>
          e.next_calibration_at ? (
            <DueCell iso={e.next_calibration_at} prefs={prefs} />
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "next_maintenance_at",
        header: "Next maint",
        sortField: "next_maintenance_at",
        widthClassName: "w-32",
        filterField: "next_maintenance_at",
        filterKind: "date-range",
        group: "Cadence",
        description: "Next planned maintenance.",
        cell: (e) =>
          e.next_maintenance_at ? (
            <DueCell iso={e.next_maintenance_at} prefs={prefs} />
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "serial_number",
        header: "Serial",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "serial_number",
        filterKind: "text",
        filterPlaceholder: "SN…",
        group: "Identity",
        description: "Our serial number for this unit.",
        cell: (e) => (
          <span className="font-mono text-xs">{e.serial_number}</span>
        ),
      },
      {
        id: "manufacturer_serial",
        header: "OEM serial",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Identity",
        description: "Manufacturer's own SN (when it differs).",
        cell: (e) => (
          <span className="font-mono text-xs">
            {e.manufacturer_serial ?? "—"}
          </span>
        ),
      },
      {
        id: "acquired_at",
        header: "Acquired",
        sortField: "acquired_at",
        widthClassName: "w-28",
        defaultHidden: true,
        filterField: "acquired_at",
        filterKind: "date-range",
        group: "Dates",
        description: "When we took ownership.",
        cell: (e) => (
          <span className="text-xs text-muted-foreground">
            {e.acquired_at ? formatCompanyDate(e.acquired_at, prefs) : "—"}
          </span>
        ),
      },
      {
        id: "warranty_end_at",
        header: "Warranty ends",
        sortField: "warranty_end_at",
        widthClassName: "w-28",
        defaultHidden: true,
        filterField: "warranty_end_at",
        filterKind: "date-range",
        group: "Dates",
        description: "Warranty end date.",
        cell: (e) => (
          <span className="text-xs text-muted-foreground">
            {e.warranty_end_at
              ? formatCompanyDate(e.warranty_end_at, prefs)
              : "—"}
          </span>
        ),
      },
      {
        id: "assigned_to",
        header: "Assigned to",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Location",
        description: "Person responsible.",
        cell: (e) => (
          <span className="text-xs">
            {e.assigned_to?.name ?? "—"}
          </span>
        ),
      },
      {
        id: "inserted_at",
        header: "Added",
        sortField: "inserted_at",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "inserted_at",
        filterKind: "date-range",
        group: "Meta",
        description: "When this unit was added.",
        cell: (e) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(e.inserted_at, prefs)}
          </span>
        ),
      },
    ],
    [prefs],
  );

  return (
    <DataTable<Equipment>
      tableId="equipment"
      realtimeEntity="equipment"
      columns={columns}
      rowKey={(e) => String(e.id)}
      fetchPage={fetchPage}
      initialPage={initialPage}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search by serial, manufacturer, model, notes…"
      filters={filters}
      onRowClick={(e) => router.push(`/equipment/${e.uuid}`)}
      renderMobileCard={(e) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {e.item?.name ?? "—"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {e.code ?? `#${e.id}`} · SN {e.serial_number}
              </p>
            </div>
            <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
          </div>
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No equipment yet</p>
          <p className="text-xs text-muted-foreground">
            Create an item with type = Equipment at Settings → Items, then add
            the first unit.
          </p>
        </div>
      }
    />
  );
}

function DueCell({
  iso,
  prefs,
}: {
  iso: string;
  prefs: ReturnType<typeof useFormatPrefs>;
}) {
  const due = new Date(iso).getTime();
  const days = Math.round((due - Date.now()) / (24 * 60 * 60 * 1000));
  const overdue = days < 0;
  const soon = days >= 0 && days <= 14;
  return (
    <span
      className={
        overdue
          ? "text-xs font-medium text-destructive"
          : soon
            ? "text-xs font-medium text-amber-700 dark:text-amber-400"
            : "text-xs text-muted-foreground"
      }
    >
      {formatCompanyDate(iso, prefs)}
    </span>
  );
}
