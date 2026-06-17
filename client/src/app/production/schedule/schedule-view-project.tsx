"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { ExternalLink, GitBranch } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type {
  ProductionScheduleResponse,
  ScheduleOperation,
} from "@/lib/production/types";
import {
  ROW_HEIGHT_PX,
  rangeDays as rangeDaysList,
  useTimeScale,
  type DayWindow,
} from "./schedule-shared";
import {
  CornerLabel,
  DayHeaderStrip,
  Gridlines,
  Legend,
  WorkingHoursOverlay,
  dayWindowsForSite,
} from "./schedule-view-mo";

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
}

export function projectRowsFromOps(
  operations: ScheduleOperation[],
  parentIdByMoId: Map<number, number | null>,
  moMetaByMoId: Map<
    number,
    { code: string | null; uuid: string; itemName: string; status: string; qty: string }
  >,
): ProjectRow[] {
  function rootOf(moId: number): number {
    let cur = moId;
    const seen = new Set<number>();
    while (true) {
      if (seen.has(cur)) return cur;
      seen.add(cur);
      const pid = parentIdByMoId.get(cur);
      if (pid == null) return cur;
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
    rows.push({
      rootMoId: rootId,
      rootMoUuid: meta?.uuid ?? "",
      rootMoCode: meta?.code ?? null,
      itemName: meta?.itemName ?? "—",
      start: new Date(Math.min(...starts)).toISOString(),
      finish: new Date(Math.max(...finishes)).toISOString(),
      status: meta?.status ?? "draft",
      qty: meta?.qty ?? "0",
      moCount: moIds.size,
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
  onEdit: (moUuid: string) => void;
}

export function ProjectView({
  data,
  rows,
  canEditSteps,
  onEdit,
}: ProjectViewProps) {
  const scale = useTimeScale();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (scale.zoom === "month") {
      el.scrollLeft = 0;
      return;
    }
    const sixAm = new Date(scale.rangeStart);
    sixAm.setUTCHours(6, 0, 0, 0);
    el.scrollLeft = Math.max(0, scale.pxAt(sixAm) - 24);
  }, [scale]);

  const days = useMemo(() => rangeDaysList(scale), [scale]);
  const dayWindows = useMemo(
    () => dayWindowsForSite(data.working_windows, days),
    [data.working_windows, days],
  );

  return (
    <div className="rounded-lg border border-border/60 bg-card shadow-sm">
      <div className="overflow-x-auto" ref={scrollRef}>
        <div
          className="relative grid"
          style={{ gridTemplateColumns: `16rem ${scale.rangeWidthPx}px` }}
        >
          <CornerLabel>Project</CornerLabel>
          <DayHeaderStrip days={days} dayWindows={dayWindows} />

          {rows.map((row) => (
            <ProjectRowEl
              key={row.rootMoId}
              row={row}
              dayWindows={dayWindows}
              canEditSteps={canEditSteps}
              onEdit={onEdit}
            />
          ))}
        </div>
      </div>
      <Legend>
        Drag a project block to shift the whole chain (root + every sub-MO).
      </Legend>
    </div>
  );
}

interface ProjectRowProps {
  row: ProjectRow;
  dayWindows: DayWindow[];
  canEditSteps: boolean;
  onEdit: (moUuid: string) => void;
}

function ProjectRowEl({
  row,
  dayWindows,
  canEditSteps,
  onEdit,
}: ProjectRowProps) {
  const scale = useTimeScale();
  return (
    <>
      <div
        className="sticky left-0 z-20 border-b border-r border-border/60 bg-card px-3 py-2 shadow-[1px_0_0_0_rgba(0,0,0,0.06)]"
        style={{ height: ROW_HEIGHT_PX }}
      >
        <div className="flex h-full min-w-0 flex-col justify-center">
          <Link
            href={`/production/manufacturing-orders/${row.rootMoUuid}`}
            className="inline-flex min-w-0 items-center gap-1 font-mono text-[10px] font-semibold text-brand hover:underline"
            title={row.rootMoCode ?? `MO #${row.rootMoId}`}
          >
            <span className="truncate">
              {row.rootMoCode ?? `MO #${row.rootMoId}`}
            </span>
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
      </div>

      <div
        className="relative border-b border-border/60"
        style={{ width: scale.rangeWidthPx, height: ROW_HEIGHT_PX }}
      >
        <WorkingHoursOverlay dayWindows={dayWindows} />
        <Gridlines />
        <ProjectBlock
          row={row}
          canEditSteps={canEditSteps}
          onEdit={onEdit}
        />
      </div>
    </>
  );
}

interface ProjectBlockProps {
  row: ProjectRow;
  canEditSteps: boolean;
  onEdit: (moUuid: string) => void;
}

function ProjectBlock({
  row,
  canEditSteps,
  onEdit,
}: ProjectBlockProps) {
  const scale = useTimeScale();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `project-${row.rootMoUuid}`,
      disabled: !canEditSteps,
    });
  const dragMoved = useRef(false);

  const startMs = new Date(row.start).getTime();
  const endMs = new Date(row.finish).getTime();
  const rangeStartMs = scale.rangeStart.getTime();
  const rangeEndMs = scale.rangeEnd.getTime();
  if (endMs <= rangeStartMs || startMs >= rangeEndMs) return null;

  const visibleStart = Math.max(startMs, rangeStartMs);
  const visibleEnd = Math.min(endMs, rangeEndMs);
  const left = scale.pxAt(new Date(visibleStart));
  const width = Math.max(scale.pxAt(new Date(visibleEnd)) - left, 48);

  const dragStyle: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};

  const statusColor =
    row.status === "in_progress"
      ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30"
      : "border-indigo-300 bg-indigo-50 dark:bg-indigo-950/30";

  function onPointerDownCapture() {
    dragMoved.current = false;
  }
  function onPointerMoveCapture(e: React.PointerEvent) {
    if (e.buttons === 1) dragMoved.current = true;
  }
  function onClick(e: React.MouseEvent) {
    if (dragMoved.current) return;
    e.stopPropagation();
    onEdit(row.rootMoUuid);
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        left,
        width,
        top: 4,
        height: ROW_HEIGHT_PX - 8,
        ...dragStyle,
      }}
      className={cn(
        "absolute select-none rounded-md border px-2 py-1 text-[11px] shadow-sm",
        statusColor,
        canEditSteps ? "cursor-grab" : "cursor-pointer",
        isDragging && "z-30 cursor-grabbing shadow-lg",
      )}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMoveCapture={onPointerMoveCapture}
      onClick={onClick}
    >
      <div className="flex h-full items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[10px] font-semibold">
            {row.rootMoCode ?? `MO #${row.rootMoId}`}
          </p>
          <p className="truncate text-[11px]" title={row.itemName}>
            {row.itemName} · {row.qty}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-background/60 px-1.5 py-0.5 text-[9px] font-medium">
          <GitBranch className="size-2.5" />
          {row.moCount}
        </span>
      </div>
    </div>
  );
}
