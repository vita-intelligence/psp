"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, GitBranch } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type {
  ProductionScheduleResponse,
  ScheduleOperation,
} from "@/lib/production/types";
import {
  anyOpHasManualSegments,
  pausesFromWorkSpans,
  rangeDays as rangeDaysList,
  useScheduleEditor,
  useTimeScale,
  useWorkingIntervals,
  workSpansForOps,
} from "./schedule-shared";
import {
  CalendarRow,
  CalendarShell,
  LABEL_GUTTER_PX,
  Legend,
  PausedSegmentsOverlay,
  dayWindowsForSite,
} from "./schedule-view-mo";

const PROJECT_ROW_HEIGHT_PX = 76;

export interface ProjectRow {
  rootMoId: number;
  rootMoUuid: string;
  rootMoCode: string | null;
  itemName: string;
  start: string;
  finish: string;
  status: string;
  qty: string;
  moCount: number;
  /** Sum of `qc_pending_count` across every MO in the chain that has
   *  steps in the current view. Drives the amber "N QC pending" badge
   *  on the project block. */
  qcPending: number;
  /** Sum of `broken_bookings_count` across every MO in the chain.
   *  Drives the urgent red "N broken" badge — planner needs to pull
   *  back + re-book before this MO can run. */
  brokenCount: number;
  /** Every operation in this chain — used by the block overlay to
   *  derive manual pause gaps when any step has stored segments. */
  ops: ScheduleOperation[];
}

export function projectRowsFromOps(
  operations: ScheduleOperation[],
  parentIdByMoId: Map<number, number | null>,
  moMetaByMoId: Map<
    number,
    {
      code: string | null;
      uuid: string;
      itemName: string;
      status: string;
      qty: string;
      qcPending: number;
      brokenCount: number;
    }
  >,
): ProjectRow[] {
  function rootOf(moId: number): number {
    let cur = moId;
    const seen = new Set<number>();
    while (true) {
      if (seen.has(cur)) return cur;
      seen.add(cur);
      const pid = parentIdByMoId.get(cur);
      // Real root — parent_mo_id is null. Walk stops here.
      if (pid == null) return cur;
      // Parent isn't in this schedule response (e.g. user is in
      // Day zoom and the parent's steps fall on a different day).
      // Treat the current MO as the visible root of THIS slice of
      // the chain — otherwise we'd return the invisible parent's
      // id and end up with a "MO #X — 0" placeholder because we
      // don't have metadata for it.
      if (!parentIdByMoId.has(pid)) return cur;
      cur = pid;
    }
  }

  const byRoot = new Map<
    number,
    { ops: ScheduleOperation[]; moIds: Set<number> }
  >();
  for (const op of operations) {
    const root = rootOf(op.manufacturing_order_id);
    const entry = byRoot.get(root) ?? { ops: [], moIds: new Set<number>() };
    entry.ops.push(op);
    entry.moIds.add(op.manufacturing_order_id);
    byRoot.set(root, entry);
  }

  const rows: ProjectRow[] = [];
  for (const [rootId, { ops, moIds }] of byRoot.entries()) {
    if (ops.length === 0) continue;
    const starts = ops
      .map((o) => o.planned_start)
      .filter((x): x is string => !!x)
      .map((s) => new Date(s).getTime());
    const finishes = ops
      .map((o) => o.planned_finish)
      .filter((x): x is string => !!x)
      .map((s) => new Date(s).getTime());
    if (starts.length === 0 || finishes.length === 0) continue;

    const meta = moMetaByMoId.get(rootId);
    let qcPending = 0;
    let brokenCount = 0;
    // Roll-up status across every MO in the project row so a project
    // whose root is completed but still has live children reads as
    // "in progress" (or the root's plain status), not a stale
    // "completed" that hides remaining floor work. Rule: any child
    // in_progress → in_progress; else every child completed →
    // completed; otherwise fall through to the root's status.
    let anyInProgress = false;
    let allCompleted = true;
    for (const moId of moIds) {
      const m = moMetaByMoId.get(moId);
      // Only tally blockers / QC for MOs that can still be acted
      // on. A broken booking on a done MO isn't actionable — it's
      // historical noise, don't propagate it into the row badge.
      const stillActive =
        m?.status !== "completed" && m?.status !== "cancelled";
      if (stillActive) {
        qcPending += m?.qcPending ?? 0;
        brokenCount += m?.brokenCount ?? 0;
      }
      if (m?.status === "in_progress") anyInProgress = true;
      if (m?.status !== "completed") allCompleted = false;
    }
    const rollupStatus = anyInProgress
      ? "in_progress"
      : allCompleted
        ? "completed"
        : (meta?.status ?? "draft");
    rows.push({
      rootMoId: rootId,
      rootMoUuid: meta?.uuid ?? "",
      rootMoCode: meta?.code ?? null,
      itemName: meta?.itemName ?? "—",
      start: new Date(Math.min(...starts)).toISOString(),
      finish: new Date(Math.max(...finishes)).toISOString(),
      status: rollupStatus,
      qty: meta?.qty ?? "0",
      moCount: moIds.size,
      qcPending,
      brokenCount,
      ops,
    });
  }
  return rows.sort(
    (a, b) =>
      new Date(a.start).getTime() - new Date(b.start).getTime() ||
      a.rootMoId - b.rootMoId,
  );
}

interface ProjectViewProps {
  data: ProductionScheduleResponse;
  rows: ProjectRow[];
  canEditSteps: boolean;
}

export function ProjectView({ data, rows, canEditSteps }: ProjectViewProps) {
  const scale = useTimeScale();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (scale.zoom === "month") {
      el.scrollLeft = 0;
      return;
    }
    const now = new Date();
    const inRange =
      now.getTime() >= scale.rangeStart.getTime() &&
      now.getTime() < scale.rangeEnd.getTime();
    const target = inRange
      ? new Date(now)
      : (() => {
          const d = new Date(scale.rangeStart);
          d.setUTCHours(6, 0, 0, 0);
          return d;
        })();
    el.scrollLeft = Math.max(0, scale.pxAt(target) - 48);
  }, [scale]);

  const days = useMemo(() => rangeDaysList(scale), [scale]);
  const dayWindows = useMemo(
    () => dayWindowsForSite(data.working_windows, days),
    [data.working_windows, days],
  );

  return (
    <CalendarShell
      cornerLabel="Project"
      days={days}
      dayWindows={dayWindows}
      scrollRef={scrollRef}
      legend={
        <Legend>
          Drag a project block to shift the whole chain (root + every sub-MO).
        </Legend>
      }
    >
      {rows.map((row) => (
        <CalendarRow
          key={row.rootMoId}
          height={PROJECT_ROW_HEIGHT_PX}
          labelWidth={LABEL_GUTTER_PX}
          label={<ProjectRowLabel row={row} />}
        >
          <ProjectBlock row={row} canEditSteps={canEditSteps} />
        </CalendarRow>
      ))}
    </CalendarShell>
  );
}

function ProjectRowLabel({ row }: { row: ProjectRow }) {
  return (
    <div className="flex h-full min-w-0 flex-col justify-center px-3 py-2">
      <Link
        href={`/production/manufacturing-orders/${row.rootMoUuid}`}
        className="inline-flex min-w-0 items-center gap-1 font-mono text-[10px] font-semibold text-brand hover:underline"
        title={row.rootMoCode ?? `MO #${row.rootMoId}`}
      >
        <span className="truncate">{row.rootMoCode ?? `MO #${row.rootMoId}`}</span>
        <ExternalLink className="size-2.5 shrink-0" />
      </Link>
      <p className="truncate text-xs" title={row.itemName}>
        {row.itemName}
      </p>
      <p className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <GitBranch className="size-2.5" />
        {row.moCount} MO{row.moCount === 1 ? "" : "s"}
      </p>
    </div>
  );
}

interface ProjectBlockProps {
  row: ProjectRow;
  canEditSteps: boolean;
}

function ProjectBlock({ row, canEditSteps }: ProjectBlockProps) {
  const scale = useTimeScale();
  const editor = useScheduleEditor();
  const workingIntervals = useWorkingIntervals();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `project-${row.rootMoUuid}`,
      disabled: !canEditSteps,
    });

  const startMs = new Date(row.start).getTime();
  const endMs = new Date(row.finish).getTime();
  if (endMs <= scale.rangeStart.getTime() || startMs >= scale.rangeEnd.getTime())
    return null;

  const visibleStart = Math.max(startMs, scale.rangeStart.getTime());
  const visibleEnd = Math.min(endMs, scale.rangeEnd.getTime());
  const left = scale.pxAt(new Date(visibleStart));
  const width = Math.max(scale.pxAt(new Date(visibleEnd)) - left, 48);

  const dragStyle: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};
  const statusColor =
    row.status === "completed"
      ? "border-emerald-500 bg-emerald-100/60 dark:bg-emerald-950/30 opacity-80"
      : row.status === "in_progress"
        ? "border-amber-500 bg-amber-100/75 dark:bg-amber-950/30"
        : "border-indigo-400 bg-indigo-100/75 dark:bg-indigo-950/30";

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (isDragging) return;
        e.stopPropagation();
        editor?.openEditor({ kind: "project", rootMoUuid: row.rootMoUuid });
      }}
      style={{
        left,
        width,
        top: 4,
        height: PROJECT_ROW_HEIGHT_PX - 8,
        ...dragStyle,
      }}
      className={cn(
        "absolute z-10 select-none overflow-hidden rounded-md border-2 px-2 py-1 text-[11px] shadow-sm",
        statusColor,
        canEditSteps ? "cursor-grab" : "cursor-pointer",
        isDragging && "z-30 cursor-grabbing shadow-lg",
      )}
      title={
        canEditSteps
          ? `${row.rootMoCode ?? `MO #${row.rootMoId}`} · ${row.itemName} · ${row.moCount} MO${row.moCount === 1 ? "" : "s"} (drag to shift, click to edit)`
          : `${row.rootMoCode ?? `MO #${row.rootMoId}`} · ${row.itemName} (click for details)`
      }
    >
      <PausedSegmentsOverlay
        spanStartMs={visibleStart}
        spanEndMs={visibleEnd}
        manualPauses={
          anyOpHasManualSegments(row.ops)
            ? pausesFromWorkSpans(
                visibleStart,
                visibleEnd,
                workSpansForOps(row.ops, workingIntervals),
              )
            : undefined
        }
      />
      <div className="relative flex h-full items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[10px] font-semibold">
            {row.rootMoCode ?? `MO #${row.rootMoId}`}
          </p>
          <p className="truncate text-[11px]" title={row.itemName}>
            {row.itemName} · {row.qty}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-background/70 px-1.5 py-0.5 text-[9px] font-medium">
            <GitBranch className="size-2.5" />
            {row.moCount}
          </span>
          {row.qcPending > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-900 dark:text-amber-200"
              title={`${row.qcPending} booked lot${row.qcPending === 1 ? "" : "s"} awaiting QC — Release is blocked until cleared.`}
            >
              <AlertTriangle className="size-2.5" />
              {row.qcPending}
            </span>
          )}
          {row.brokenCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-red-500/25 px-1.5 py-0.5 text-[9px] font-semibold text-red-900 dark:text-red-200"
              title={`${row.brokenCount} bookings or BOM lines can't satisfy this MO — pull back to fix.`}
            >
              <AlertTriangle className="size-2.5" />
              issues
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
