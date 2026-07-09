"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Printer, Wrench } from "lucide-react";
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
import { formatCompanyDate, formatCompanyMoney } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type {
  MachineLedgerPage,
  MachineSummary,
} from "@/lib/production/types";
import { PrintMachineLabelDialog } from "./print-machine-label-dialog";

interface Props {
  initialPage: MachineLedgerPage;
}

const DEFAULT_SORT: SortSpec = { field: "inserted_at", direction: "desc" };

const IS_ACTIVE_FILTER: FilterDef = {
  field: "is_active",
  label: "Active",
  options: [
    { label: "Active only", value: "true" },
    { label: "Archived only", value: "false" },
  ],
};

const BOOL_OPTIONS = [
  { label: "Yes", value: true },
  { label: "No", value: false },
];

async function fetchPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<MachineSummary>> {
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
  const res = await fetch(
    `/api/production/machines?${qs.toString()}`,
    { cache: "no-store" },
  );
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
  return (await res.json()) as PageResult<MachineSummary>;
}

/**
 * Renders a compact "in 42 days" / "3 days overdue" hint next to the
 * calibration due date. The BE-computed `calibration_overdue` flag is
 * the source of truth for the badge tone; this helper is only there
 * to give the operator a numeric anchor without hunting for today's
 * date.
 */
function calibrationDaysHint(dueIso: string | null): string | null {
  if (!dueIso) return null;
  const due = new Date(dueIso);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffMs = dueDay.getTime() - today.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days > 0) return `in ${days}d`;
  return `${Math.abs(days)}d overdue`;
}

export function MachinesLedger({ initialPage }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();
  const [printMachine, setPrintMachine] = useState<MachineSummary | null>(null);

  const filters = useMemo<FilterDef[]>(() => [IS_ACTIVE_FILTER], []);

  const columns = useMemo<DataTableColumn<MachineSummary>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        sortField: "name",
        filterField: "name",
        filterKind: "text",
        filterPlaceholder: "Encapsulator #3…",
        widthClassName: "min-w-[16rem]",
        group: "Identity",
        description: "Human-readable machine name.",
        cell: (m) => (
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm font-medium">{m.name}</span>
            {!m.is_active && <Badge tone="muted">Archived</Badge>}
          </div>
        ),
      },
      {
        id: "workstation",
        header: "Workstation",
        widthClassName: "min-w-[14rem]",
        filterField: "workstation_id",
        filterKind: "text",
        filterPlaceholder: "Workstation id…",
        group: "Attachment",
        description:
          "Parent workstation this asset is attached to. Machine hourly rates roll up into the workstation total.",
        cell: (m) =>
          m.workstation ? (
            <div className="min-w-0">
              <p className="truncate text-sm">{m.workstation.name}</p>
              {m.workstation.workstation_group && (
                <p className="truncate text-[11px] text-muted-foreground">
                  {m.workstation.workstation_group.name}
                </p>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "hourly_rate",
        header: "Machine cost / h",
        widthClassName: "w-32",
        group: "Amounts",
        description:
          "Per-hour machinery cost (energy, depreciation, upkeep). Sums into the parent workstation's rate when enabled. NOT worker wages.",
        cell: (m) =>
          m.hourly_rate_enabled && m.hourly_rate ? (
            <span className="font-mono text-xs">
              {formatCompanyMoney(m.hourly_rate, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "asset_tag",
        header: "Asset tag",
        widthClassName: "w-32",
        filterField: "asset_tag",
        filterKind: "text",
        filterPlaceholder: "AT-00042…",
        group: "Traceability",
        description: "Company-unique asset tag. Used for audit + fixed-asset ledgers.",
        cell: (m) =>
          m.asset_tag ? (
            <span className="font-mono text-xs">{m.asset_tag}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "manufacturer_model",
        header: "Make / model",
        widthClassName: "min-w-[12rem]",
        group: "Traceability",
        description: "Manufacturer + model — informational only.",
        cell: (m) => {
          const parts = [m.manufacturer, m.model].filter(Boolean);
          return parts.length > 0 ? (
            <span className="truncate text-xs text-muted-foreground">
              {parts.join(" · ")}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          );
        },
      },
      {
        id: "next_calibration_due_at",
        header: "Calibration due",
        widthClassName: "w-40",
        sortField: "next_calibration_due_at",
        filterField: "next_calibration_due_at",
        filterKind: "date-range",
        group: "Calibration",
        description:
          "Next calibration due date. Red badge = overdue (server-computed). Numeric hint counts days from today.",
        cell: (m) => {
          if (!m.next_calibration_due_at) {
            return <span className="text-xs text-muted-foreground/50">—</span>;
          }
          const hint = calibrationDaysHint(m.next_calibration_due_at);
          return (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs">
                {formatCompanyDate(m.next_calibration_due_at, prefs)}
              </span>
              {m.calibration_overdue ? (
                <Badge tone="destructive">
                  Overdue{hint ? ` · ${hint}` : ""}
                </Badge>
              ) : (
                hint && (
                  <span className="text-[10px] text-muted-foreground">
                    {hint}
                  </span>
                )
              )}
            </div>
          );
        },
      },
      {
        id: "is_active",
        header: "Active",
        widthClassName: "w-20",
        align: "center",
        filterField: "is_active",
        filterKind: "select",
        filterOptions: BOOL_OPTIONS,
        group: "Status",
        description: "Archived machines are hidden from the workstation-cost cascade.",
        cell: (m) =>
          m.is_active ? (
            <Badge tone="emerald">Yes</Badge>
          ) : (
            <Badge tone="muted">No</Badge>
          ),
      },
      {
        id: "print_label",
        header: "",
        widthClassName: "w-10",
        align: "center",
        group: "Actions",
        description: "Print a stick-on QR label for this machine.",
        cell: (m) => (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              // Row clicks route to the detail page; suppress that
              // when the operator only wants to print.
              e.stopPropagation();
              setPrintMachine(m);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setPrintMachine(m);
              }
            }}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Print label for ${m.name}`}
            title="Print label"
          >
            <Printer className="size-3.5" />
          </span>
        ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "last_calibrated_at",
        header: "Last calibrated",
        widthClassName: "w-32",
        defaultHidden: true,
        sortField: "last_calibrated_at",
        filterField: "last_calibrated_at",
        filterKind: "date-range",
        group: "Calibration",
        description: "Date of the most recent calibration event (Recalibrate action).",
        cell: (m) =>
          m.last_calibrated_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(m.last_calibrated_at, prefs)}
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
        description: "When this machine record was created.",
        cell: (m) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(m.inserted_at, prefs)}
          </span>
        ),
      },
      {
        id: "updated_at",
        header: "Updated",
        widthClassName: "w-32",
        defaultHidden: true,
        sortField: "updated_at",
        filterField: "updated_at",
        filterKind: "date-range",
        group: "Meta",
        description: "When this machine was last modified.",
        cell: (m) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(m.updated_at, prefs)}
          </span>
        ),
      },
    ],
    [prefs],
  );

  return (
    <>
    <DataTable<MachineSummary>
      tableId="production-machines"
      realtimeEntity="machine"
      columns={columns}
      rowKey={(m) => String(m.id)}
      fetchPage={fetchPage}
      initialPage={{
        items: initialPage.items,
        next_cursor: initialPage.next_cursor,
      }}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search machines…"
      filters={filters}
      onRowClick={(m) => {
        router.push(`/production/machines/${m.uuid}`);
      }}
      renderMobileCard={(m) => (
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.name}</p>
              {m.workstation && (
                <p className="truncate text-[11px] text-muted-foreground">
                  {m.workstation.name}
                </p>
              )}
            </div>
            {m.calibration_overdue ? (
              <Badge tone="destructive">Overdue</Badge>
            ) : (
              !m.is_active && <Badge tone="muted">Archived</Badge>
            )}
          </div>
          {m.asset_tag && (
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {m.asset_tag}
            </p>
          )}
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <Wrench className="mx-auto size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No machines yet</p>
          <p className="text-xs text-muted-foreground">
            Attach the first physical asset — it&apos;ll need to live on
            an existing workstation and can carry its own hourly cost +
            calibration schedule.
          </p>
        </div>
      }
    />
    <PrintMachineLabelDialog
      machine={printMachine}
      open={printMachine !== null}
      onOpenChange={(open) => !open && setPrintMachine(null)}
    />
    </>
  );
}
