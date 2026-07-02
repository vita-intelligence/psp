"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { CheckCircle2, PauseCircle, ShieldCheck, XCircle } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { DataTable } from "@/components/data-table/data-table";
import type {
  DataTableColumn,
  FilterValue,
  PageResult,
  SortSpec,
} from "@/components/data-table/types";
import { cn } from "@/lib/utils";
import {
  FINAL_RELEASE_FILE_KINDS,
  type FinalRelease,
  type FinalReleaseStatus,
} from "@/lib/production-final-release/types";

interface Props {
  initialPage: PageResult<FinalRelease>;
}

const DEFAULT_SORT: SortSpec = { field: "inserted_at", direction: "asc" };

async function fetchPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: FilterValue;
  search: string;
}): Promise<PageResult<FinalRelease>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  const status = params.filters.status;
  if (typeof status === "string" && status.length > 0) {
    qs.set("status", status);
  }
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.search) qs.set("search", params.search);

  const res = await fetch(
    `/api/production/final-releases/queue?${qs.toString()}`,
    { cache: "no-store" },
  );
  if (!res.ok) return { items: [], next_cursor: null };
  return (await res.json()) as PageResult<FinalRelease>;
}

const STATUS_META: Record<
  FinalReleaseStatus,
  { label: string; Icon: typeof ShieldCheck; className: string }
> = {
  pending: {
    label: "Pending",
    Icon: ShieldCheck,
    className: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  released: {
    label: "Released",
    Icon: CheckCircle2,
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  on_hold: {
    label: "On hold",
    Icon: PauseCircle,
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  rejected: {
    label: "Rejected",
    Icon: XCircle,
    className: "bg-destructive/15 text-destructive",
  },
};

export function FinalReleaseWorklist({ initialPage }: Props) {
  const router = useRouter();

  const columns: DataTableColumn<FinalRelease>[] = useMemo(
    () => [
      {
        id: "lot",
        header: "Lot",
        cell: (r) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {r.stock_lot?.item?.name ?? "—"}
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {r.stock_lot?.code ?? "—"}
            </p>
          </div>
        ),
      },
      {
        id: "mo",
        header: "MO",
        cell: (r) => (
          <span className="font-mono text-xs">
            {r.manufacturing_order?.code ?? "—"}
          </span>
        ),
      },
      {
        id: "qty",
        header: "Qty",
        align: "right",
        cell: (r) => (
          <span className="font-mono text-xs">
            {r.stock_lot?.qty_received ?? "—"}
          </span>
        ),
      },
      {
        id: "location",
        header: "Location",
        cell: (r) => {
          const p = r.stock_lot?.placement;
          if (!p) return <span className="text-xs text-muted-foreground">—</span>;
          const purpose = p.cell_purpose;
          const purposeChip =
            purpose === "finished_quarantine" ? (
              <span className="inline-flex rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                In quarantine
              </span>
            ) : (
              <span className="inline-flex rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Move required
              </span>
            );

          // Build the crumb from every non-null segment. Named cell
          // wins; when it's null the derived "Level N" from the
          // ordinal keeps the crumb legible. Same fallback chain the
          // rest of the app uses.
          const rack =
            p.location?.code ?? p.location?.name ?? null;
          const cellLabel =
            p.cell_name ??
            (typeof p.cell_ordinal === "number"
              ? `Level ${p.cell_ordinal + 1}`
              : null);

          const crumb = [
            p.warehouse?.name,
            p.floor?.name,
            rack,
            cellLabel,
          ]
            .filter((x): x is string => !!x)
            .join(" · ");

          return (
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-xs">{crumb || "—"}</p>
              {purposeChip}
            </div>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        cell: (r) => {
          const meta = STATUS_META[r.status];
          const Icon = meta.Icon;
          return (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                meta.className,
              )}
            >
              <Icon className="size-2.5" />
              {meta.label}
            </span>
          );
        },
      },
      {
        id: "signatures",
        header: "Signatures",
        cell: (r) => {
          const releaser = r.releaser_id ? 1 : 0;
          const approver = r.approver_id ? 1 : 0;
          const both = releaser + approver;
          return (
            <div className="min-w-0 text-[11px]">
              <span
                className={cn(
                  "font-medium",
                  both === 2 ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground",
                )}
              >
                {both}/2
              </span>
              {both === 2 && r.releaser_id === r.approver_id && (
                <span className="ml-1 text-destructive">(same user)</span>
              )}
              {r.releaser && (
                <p className="truncate text-muted-foreground">
                  R: {r.releaser.name ?? r.releaser.email}
                </p>
              )}
              {r.approver && (
                <p className="truncate text-muted-foreground">
                  A: {r.approver.name ?? r.approver.email}
                </p>
              )}
            </div>
          );
        },
      },
      {
        id: "files",
        header: "Files",
        cell: (r) => {
          const kinds = new Set(r.files.map((f) => f.kind));
          const attached = FINAL_RELEASE_FILE_KINDS.filter((k) => kinds.has(k))
            .length;
          const total = r.required_file_kinds.length;
          return (
            <span
              className={cn(
                "font-mono text-[11px]",
                attached === total
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-muted-foreground",
              )}
            >
              {attached}/{total}
            </span>
          );
        },
      },
      {
        id: "age",
        header: "Awaiting since",
        sortField: "inserted_at",
        cell: (r) => (
          <span className="text-[11px] text-muted-foreground">
            {formatDistanceToNowStrict(new Date(r.inserted_at), {
              addSuffix: true,
            })}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable<FinalRelease>
      tableId="production.final-releases"
      initialPage={{
        items: initialPage.items,
        next_cursor: initialPage.next_cursor,
      }}
      columns={columns}
      rowKey={(r) => r.uuid}
      defaultSort={DEFAULT_SORT}
      fetchPage={fetchPage}
      onRowClick={(r) => {
        const lot = r.stock_lot?.uuid;
        if (lot) router.push(`/production/final-releases/${lot}`);
      }}
      searchPlaceholder="Search by product, MO, or lot code…"
      filters={[
        {
          field: "status",
          label: "Status",
          options: [
            { label: "Pending", value: "pending" },
            { label: "Released", value: "released" },
            { label: "On hold", value: "on_hold" },
            { label: "Rejected", value: "rejected" },
            { label: "All statuses", value: "all" },
          ],
        },
      ]}
      emptyState={
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <ShieldCheck className="size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No releases match</p>
          <p className="text-xs text-muted-foreground">
            Finished lots that pass output QC show up here awaiting QA sign-off.
          </p>
        </div>
      }
    />
  );
}
