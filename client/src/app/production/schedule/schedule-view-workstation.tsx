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
  isoDate,
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

interface WorkstationViewProps {
  data: ProductionScheduleResponse;
  canEditSteps: boolean;
  onEdit: (moUuid: string) => void;
}

export function WorkstationView({
  data,
  canEditSteps,
  onEdit,
}: WorkstationViewProps) {
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
    <div className="rounded-lg border border-border/60 bg-card shadow-sm">
      <div className="overflow-x-auto" ref={scrollRef}>
        <div
          className="relative grid"
          style={{ gridTemplateColumns: `14rem ${scale.rangeWidthPx}px` }}
        >
          <CornerLabel>Workstation group</CornerLabel>
          <DayHeaderStrip
            days={days}
            dayWindows={dayWindowsForSite([], days)}
          />

          {data.workstation_groups.map((g) => {
            const groupDays =
              data.working_windows.find((w) => w.group_id === g.id)?.days ?? [];
            const dayWindows =
              groupDays.length > 0
                ? groupDays
                : dayWindowsForSite([], days);

            const opsHere = data.operations.filter(
              (op) => op.workstation_group_id === g.id,
            );

            return (
              <WSGrowPair
                key={g.id}
                group={g}
                opsHere={opsHere}
                dayWindows={dayWindows}
                conflictIds={conflictIds}
                canEditSteps={canEditSteps}
                onEdit={onEdit}
              />
            );
          })}
        </div>
      </div>
      <Legend>
        Drag an operation to reschedule. Drop it on a different WSG row to
        reassign.
      </Legend>
    </div>
  );
}

interface WSGrowPairProps {
  group: ProductionScheduleResponse["workstation_groups"][number];
  opsHere: ScheduleOperation[];
  dayWindows: DayWindow[];
  conflictIds: Set<number>;
  canEditSteps: boolean;
  onEdit: (moUuid: string) => void;
}

function WSGrowPair({
  group,
  opsHere,
  dayWindows,
  conflictIds,
  canEditSteps,
  onEdit,
}: WSGrowPairProps) {
  const scale = useTimeScale();
  const { setNodeRef, isOver } = useDroppable({ id: `wsg-${group.id}` });
  return (
    <>
      <div
        className="sticky left-0 z-20 border-b border-r border-border/60 bg-card px-3 py-2 shadow-[1px_0_0_0_rgba(0,0,0,0.06)]"
        style={{ height: ROW_HEIGHT_PX }}
      >
        <div className="flex h-full items-center gap-2">
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
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "relative border-b border-border/60",
          isOver && "bg-brand/[0.04]",
        )}
        style={{ width: scale.rangeWidthPx, height: ROW_HEIGHT_PX }}
      >
        <WorkingHoursOverlay dayWindows={dayWindows} />
        <Gridlines />
        {opsHere.map((op) => (
          <OperationBlock
            key={op.id}
            op={op}
            conflict={conflictIds.has(op.id)}
            canEditSteps={canEditSteps}
            groupColor={group.color}
            onEdit={onEdit}
          />
        ))}
      </div>
    </>
  );
}

interface OperationBlockProps {
  op: ScheduleOperation;
  conflict: boolean;
  canEditSteps: boolean;
  groupColor: string | null;
  onEdit: (moUuid: string) => void;
}

function OperationBlock({
  op,
  conflict,
  canEditSteps,
  groupColor,
  onEdit,
}: OperationBlockProps) {
  const scale = useTimeScale();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `op-${op.id}`,
      disabled: !canEditSteps,
    });
  const dragMoved = useRef(false);

  if (!op.planned_start || !op.planned_finish) return null;

  const startMs = new Date(op.planned_start).getTime();
  const endMs = new Date(op.planned_finish).getTime();
  const rangeStartMs = scale.rangeStart.getTime();
  const rangeEndMs = scale.rangeEnd.getTime();
  if (endMs <= rangeStartMs || startMs >= rangeEndMs) return null;

  const visibleStart = Math.max(startMs, rangeStartMs);
  const visibleEnd = Math.min(endMs, rangeEndMs);
  const left = scale.pxAt(new Date(visibleStart));
  const width = Math.max(scale.pxAt(new Date(visibleEnd)) - left, 24);

  const dragStyle: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};

  const mo = op.manufacturing_order;
  const moHref = mo ? `/production/manufacturing-orders/${mo.uuid}` : "#";

  function onPointerDownCapture() {
    dragMoved.current = false;
  }
  function onPointerMoveCapture(e: React.PointerEvent) {
    if (e.buttons === 1) dragMoved.current = true;
  }
  function onClick(e: React.MouseEvent) {
    if (dragMoved.current) return;
    e.stopPropagation();
    if (mo) onEdit(mo.uuid);
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
        "group absolute select-none rounded-md border px-2 py-1 text-[11px] shadow-sm transition-shadow",
        isDragging && "z-30 cursor-grabbing shadow-lg",
        canEditSteps ? "cursor-grab" : "cursor-pointer",
        conflict
          ? "border-destructive bg-destructive/10 text-destructive ring-1 ring-destructive/60"
          : "border-border/70 bg-card text-foreground hover:shadow-md",
      )}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMoveCapture={onPointerMoveCapture}
      onClick={onClick}
    >
      <div
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-md"
        style={{ backgroundColor: groupColor ?? "var(--brand)" }}
      />
      <div className="ml-1.5 flex h-full flex-col justify-center overflow-hidden">
        <Link
          href={moHref}
          onClick={(e) => e.stopPropagation()}
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
