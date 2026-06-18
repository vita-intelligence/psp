"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type {
  ProductionScheduleResponse,
  ScheduleOperation,
} from "@/lib/production/types";
import {
  ROW_HEIGHT_PX,
  rangeDays as rangeDaysList,
  useScheduleEditor,
  useTimeScale,
} from "./schedule-shared";
import {
  CalendarRow,
  CalendarShell,
  Legend,
  LABEL_GUTTER_PX,
  PausedSegmentsOverlay,
  dayWindowsForSite,
} from "./schedule-view-mo";

interface WorkstationViewProps {
  data: ProductionScheduleResponse;
  canEditSteps: boolean;
}

export function WorkstationView({ data, canEditSteps }: WorkstationViewProps) {
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

  // Detect overlapping ops on the same WSG so we can outline them
  // in red.
  const conflictIds = useMemo(() => {
    const set = new Set<number>();
    const byGroup = new Map<number, ScheduleOperation[]>();
    for (const op of data.operations) {
      const gid = op.workstation_group_id ?? 0;
      const arr = byGroup.get(gid) ?? [];
      arr.push(op);
      byGroup.set(gid, arr);
    }
    for (const arr of byGroup.values()) {
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        if (!a.planned_start || !a.planned_finish) continue;
        const aStart = new Date(a.planned_start).getTime();
        const aEnd = new Date(a.planned_finish).getTime();
        for (let j = i + 1; j < arr.length; j++) {
          const b = arr[j];
          if (!b.planned_start || !b.planned_finish) continue;
          const bStart = new Date(b.planned_start).getTime();
          const bEnd = new Date(b.planned_finish).getTime();
          if (aStart < bEnd && bStart < aEnd) {
            set.add(a.id);
            set.add(b.id);
          }
        }
      }
    }
    return set;
  }, [data.operations]);

  return (
    <CalendarShell
      cornerLabel="Workstation group"
      days={days}
      dayWindows={dayWindows}
      scrollRef={scrollRef}
      legend={
        <Legend>
          Drag an operation to reschedule. Drop it on a different WSG row to
          reassign.
        </Legend>
      }
    >
      {data.workstation_groups.map((group) => {
        const opsHere = data.operations.filter(
          (op) => op.workstation_group_id === group.id,
        );
        return (
          <WSGRow
            key={group.id}
            group={group}
            opsHere={opsHere}
            conflictIds={conflictIds}
            canEditSteps={canEditSteps}
          />
        );
      })}
    </CalendarShell>
  );
}

interface WSGRowProps {
  group: ProductionScheduleResponse["workstation_groups"][number];
  opsHere: ScheduleOperation[];
  conflictIds: Set<number>;
  canEditSteps: boolean;
}

function WSGRow({ group, opsHere, conflictIds, canEditSteps }: WSGRowProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `wsg-${group.id}` });

  return (
    <CalendarRow
      labelWidth={LABEL_GUTTER_PX}
      height={ROW_HEIGHT_PX}
      label={
        <div className="flex h-full items-center gap-2 px-3">
          {group.color && (
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: group.color }}
            />
          )}
          <p className="truncate text-sm font-medium" title={group.name}>
            {group.name}
          </p>
        </div>
      }
      contentRef={setNodeRef}
      contentClassName={cn(
        "transition-colors",
        isOver && "bg-brand/15 ring-2 ring-inset ring-brand/50",
      )}
    >
      {opsHere.map((op) => (
        <OperationBlock
          key={op.id}
          op={op}
          conflict={conflictIds.has(op.id)}
          canEditSteps={canEditSteps}
          groupColor={group.color}
        />
      ))}
    </CalendarRow>
  );
}

interface OperationBlockProps {
  op: ScheduleOperation;
  conflict: boolean;
  canEditSteps: boolean;
  groupColor: string | null;
}

function OperationBlock({
  op,
  conflict,
  canEditSteps,
  groupColor,
}: OperationBlockProps) {
  const scale = useTimeScale();
  const editor = useScheduleEditor();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `op-${op.id}`,
      disabled: !canEditSteps,
    });

  if (!op.planned_start || !op.planned_finish) return null;
  const startMs = new Date(op.planned_start).getTime();
  const endMs = new Date(op.planned_finish).getTime();
  if (endMs <= scale.rangeStart.getTime() || startMs >= scale.rangeEnd.getTime())
    return null;

  const visibleStart = Math.max(startMs, scale.rangeStart.getTime());
  const visibleEnd = Math.min(endMs, scale.rangeEnd.getTime());
  const left = scale.pxAt(new Date(visibleStart));
  const width = Math.max(scale.pxAt(new Date(visibleEnd)) - left, 24);

  const dragStyle: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};
  const mo = op.manufacturing_order;
  const moHref = mo ? `/production/manufacturing-orders/${mo.uuid}` : "#";

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (isDragging) return;
        e.stopPropagation();
        editor?.openEditor({ kind: "step", stepUuid: op.uuid });
      }}
      style={{
        left,
        width,
        top: 4,
        height: ROW_HEIGHT_PX - 8,
        ...dragStyle,
      }}
      className={cn(
        "group absolute z-10 select-none overflow-hidden rounded-md border px-2 py-1 text-[11px] shadow-sm transition-shadow",
        isDragging && "z-30 cursor-grabbing shadow-lg",
        canEditSteps ? "cursor-grab" : "cursor-pointer",
        conflict
          ? "border-destructive bg-destructive/10 text-destructive ring-1 ring-destructive/60"
          : "border-border/70 bg-card text-foreground hover:shadow-md",
      )}
      title={
        canEditSteps
          ? "Drag to reschedule, drop on another workstation to reassign, or click to edit."
          : `${mo?.code ?? `Op #${op.id}`} (click for details)`
      }
    >
      <PausedSegmentsOverlay
        spanStartMs={visibleStart}
        spanEndMs={visibleEnd}
      />
      <div
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-md"
        style={{ backgroundColor: groupColor ?? "var(--brand)" }}
      />
      <div className="ml-1.5 flex h-full flex-col justify-center overflow-hidden">
        <Link
          href={moHref}
          onPointerDown={(e) => e.stopPropagation()}
          className="truncate text-[10px] font-mono font-semibold hover:underline"
        >
          {mo?.code ?? `MO #${op.manufacturing_order_id}`}
        </Link>
        <p className="truncate text-[11px]" title={mo?.item?.name ?? ""}>
          {mo?.item?.name ?? "—"}
        </p>
      </div>
    </div>
  );
}
