"use client";

/**
 * Calendar-style schedule view — the third tab next to MO + Workstation.
 *
 * Unlike the Gantt views (time on X axis, rows = MO/WSG), this view is
 * laid out the way an operator reads a wall calendar: TIME on the Y
 * axis, DAYS on the X axis. Same data, different question being
 * answered.
 *
 *   - Day:   one column, hours 06:00 → 22:00 on left.
 *   - Week:  Mon-Sun columns, hours on left, week label cell top-left.
 *   - Month: standard 5-6 row month grid with MO chips stacked in each
 *            day cell (no hour axis).
 *
 * Read-only for now: click an op (timed views) or chip (month view)
 * to open the existing step / MO editor. Drag-to-reschedule lives on
 * the Gantt views; we can port it here later if there's demand.
 */

import { useEffect, useMemo, useRef } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { AlertTriangle, CalendarOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ProductionScheduleResponse,
  ScheduleOperation,
} from "@/lib/production/types";
import {
  type ZoomLevel,
  useScheduleEditor,
} from "./schedule-shared";

interface Props {
  data: ProductionScheduleResponse;
  zoom: ZoomLevel;
  anchor: Date;
  canEditSteps: boolean;
}

export const CALENDAR_HOUR_HEIGHT_PX = 56;
export const CALENDAR_DAY_START_HOUR = 6;
export const CALENDAR_DAY_END_HOUR = 22;
const HOUR_HEIGHT_PX = CALENDAR_HOUR_HEIGHT_PX;
const DAY_START_HOUR = CALENDAR_DAY_START_HOUR;
const DAY_END_HOUR = CALENDAR_DAY_END_HOUR;
const TIME_GUTTER_PX = 64;

export const CALENDAR_DAY_DROPPABLE_PREFIX = "calendar-day-";

export function CalendarView({ data, zoom, anchor, canEditSteps }: Props) {
  if (zoom === "month") {
    return <MonthCalendar data={data} anchor={anchor} />;
  }
  return (
    <TimedCalendar
      data={data}
      zoom={zoom}
      anchor={anchor}
      canEditSteps={canEditSteps}
    />
  );
}

// ---------- Timed (Day / Week) -----------------------------------------

function TimedCalendar({
  data,
  zoom,
  anchor,
  canEditSteps,
}: {
  data: ProductionScheduleResponse;
  zoom: "day" | "week";
  anchor: Date;
  canEditSteps: boolean;
}) {
  const days = useMemo(() => visibleDays(zoom, anchor), [zoom, anchor]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Scroll so the working day's start is roughly at the top of the
  // viewport. Falls back to 06:00 anchor when there's no live "now"
  // in the visible range.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const now = new Date();
    const isToday = days.some(
      (d) =>
        d.getUTCFullYear() === now.getUTCFullYear() &&
        d.getUTCMonth() === now.getUTCMonth() &&
        d.getUTCDate() === now.getUTCDate(),
    );
    const targetHour = isToday
      ? Math.max(DAY_START_HOUR, now.getHours() - 1)
      : DAY_START_HOUR;
    el.scrollTop = (targetHour - DAY_START_HOUR) * HOUR_HEIGHT_PX;
  }, [days]);

  const hours = useMemo(() => {
    const list: number[] = [];
    for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) list.push(h);
    return list;
  }, []);

  const opsByDay = useMemo(
    () => groupOpsByDay(data.operations, days),
    [data.operations, days],
  );

  // Same-WSG overlap detection. Different-WSG overlaps are NOT
  // conflicts (parallel work) — they just get laid out side-by-side
  // via the lane algorithm without a red outline.
  const conflictIds = useMemo(
    () => detectSameWsgConflicts(data.operations),
    [data.operations],
  );

  const totalHeight = (DAY_END_HOUR - DAY_START_HOUR + 1) * HOUR_HEIGHT_PX;
  const weekNumber = isoWeek(days[0]);
  const gridTemplate = `${TIME_GUTTER_PX}px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border/60 bg-card">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-auto"
        >
          {/* Sticky day-header row — inside the scroll container so it
              stays visible at the top as the body scrolls past. */}
          <div
            className="sticky top-0 z-30 grid border-b border-border/60 bg-muted/30"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div className="flex items-center justify-center px-2 py-2 text-[11px] font-semibold text-muted-foreground">
              W{weekNumber}
            </div>
            {days.map((day) => (
              <DayHeader key={day.toISOString()} day={day} />
            ))}
          </div>

          {/* Time-grid body */}
          <div
            className="relative grid"
            style={{
              gridTemplateColumns: gridTemplate,
              height: totalHeight,
            }}
          >
            {/* Hour gutter */}
            <div className="relative">
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-border/60 pl-2 pt-1 text-[11px] text-muted-foreground"
                  style={{
                    top: (h - DAY_START_HOUR) * HOUR_HEIGHT_PX,
                    height: HOUR_HEIGHT_PX,
                  }}
                >
                  {h.toString().padStart(2, "0")}:00
                </div>
              ))}
            </div>

            {/* Day columns */}
            {days.map((day, idx) => (
              <DayColumn
                key={day.toISOString()}
                day={day}
                hours={hours}
                ops={opsByDay.get(dayKey(day)) ?? []}
                workstationGroups={data.workstation_groups}
                isLast={idx === days.length - 1}
                canEditSteps={canEditSteps}
                conflictIds={conflictIds}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DayHeader({ day }: { day: Date }) {
  const isToday = isSameUtcDay(day, new Date());
  return (
    <div
      className={cn(
        "border-l border-border/60 px-3 py-2 text-center text-xs font-semibold",
        isToday ? "text-primary" : "text-foreground",
      )}
    >
      {day.toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "2-digit",
      })}
    </div>
  );
}

function DayColumn({
  day,
  hours,
  ops,
  workstationGroups,
  isLast,
  canEditSteps,
  conflictIds,
}: {
  day: Date;
  hours: number[];
  ops: ScheduleOperation[];
  workstationGroups: ProductionScheduleResponse["workstation_groups"];
  isLast: boolean;
  canEditSteps: boolean;
  conflictIds: Set<number>;
}) {
  const isToday = isSameUtcDay(day, new Date());
  const { setNodeRef, isOver } = useDroppable({
    id: `${CALENDAR_DAY_DROPPABLE_PREFIX}${day.toISOString()}`,
    data: { dayMs: day.getTime() },
  });

  // Layout overlapping ops side-by-side: each op gets a (lane, cluster)
  // pair where 'cluster' is the total parallel tracks needed in this
  // group of overlapping ops. Mirrors Google Calendar's day view.
  const laneByOp = useMemo(() => assignLanes(ops), [ops]);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative border-l border-border/60",
        isLast && "border-r-0",
        isToday && "bg-primary/[0.04]",
        isOver && "bg-brand/10 ring-2 ring-inset ring-brand/40",
      )}
    >
      {/* Hour gridlines */}
      {hours.map((h) => (
        <div
          key={h}
          className="absolute left-0 right-0 border-t border-border/40"
          style={{ top: (h - DAY_START_HOUR) * HOUR_HEIGHT_PX, height: HOUR_HEIGHT_PX }}
        />
      ))}

      {/* Now-line if today */}
      {isToday && <NowLine />}

      {/* Operations */}
      {ops.map((op) => {
        const lane = laneByOp.get(op.id) ?? { lane: 0, cluster: 1 };
        return (
          <OperationBlock
            key={op.id}
            op={op}
            day={day}
            workstationGroups={workstationGroups}
            canEditSteps={canEditSteps}
            lane={lane.lane}
            cluster={lane.cluster}
            conflict={conflictIds.has(op.id)}
          />
        );
      })}
    </div>
  );
}

function NowLine() {
  const now = new Date();
  const minutesFromStart =
    (now.getHours() - DAY_START_HOUR) * 60 + now.getMinutes();
  if (minutesFromStart < 0) return null;
  const top = (minutesFromStart / 60) * HOUR_HEIGHT_PX;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 right-0 z-20"
      style={{ top }}
    >
      <div className="relative">
        <div className="absolute -left-1.5 -top-1 size-3 rounded-full bg-red-500" />
        <div className="h-px bg-red-500" />
      </div>
    </div>
  );
}

function OperationBlock({
  op,
  day,
  workstationGroups,
  canEditSteps,
  lane,
  cluster,
  conflict,
}: {
  op: ScheduleOperation;
  day: Date;
  workstationGroups: ProductionScheduleResponse["workstation_groups"];
  canEditSteps: boolean;
  lane: number;
  cluster: number;
  conflict: boolean;
}) {
  const editor = useScheduleEditor();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `op-${op.id}`,
      disabled: !canEditSteps,
    });

  if (!op.planned_start || !op.planned_finish) return null;
  const start = new Date(op.planned_start);
  const finish = new Date(op.planned_finish);
  const layout = layoutForDay(start, finish, day);
  if (!layout) return null;

  const wsg =
    workstationGroups.find((g) => g.id === op.workstation_group_id) ?? null;
  const wsgColor = wsg?.color ?? null;
  const mo = op.manufacturing_order;
  const blockers =
    (mo?.broken_bookings_count ?? 0) +
    (mo?.under_booked_count ?? 0) +
    (mo?.lines_awaiting_child_output?.length ?? 0) +
    (mo?.bookings_lot_off_warehouse?.length ?? 0);
  const qcPending = mo?.qc_pending_count ?? 0;

  const dragStyle: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};

  // Side-by-side layout: each parallel lane gets 1/cluster of the
  // column width, with a 2px gap between lanes for breathing room.
  const widthPct = 100 / cluster;
  const leftPct = lane * widthPct;
  const laneStyle: React.CSSProperties = {
    left: `calc(${leftPct}% + 2px)`,
    width: `calc(${widthPct}% - 4px)`,
  };

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      type="button"
      onClick={(e) => {
        if (isDragging) return;
        e.stopPropagation();
        editor?.openEditor({ kind: "step", stepUuid: op.uuid });
      }}
      style={{
        top: layout.top,
        height: Math.max(layout.height, 18),
        ...laneStyle,
        ...dragStyle,
      }}
      className={cn(
        "absolute z-10 flex flex-col gap-0.5 overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] shadow-sm transition-shadow",
        conflict
          ? "border-destructive bg-destructive/5 ring-1 ring-destructive/50 text-destructive"
          : "border-border/70 bg-card",
        isDragging
          ? "z-30 cursor-grabbing shadow-lg"
          : canEditSteps
            ? "cursor-grab hover:shadow-md"
            : "cursor-pointer hover:shadow-md",
      )}
      title={
        conflict
          ? `${mo?.code ?? `Op #${op.id}`} — ${formatHm(start)} → ${formatHm(finish)}\nConflict: another operation on the same workstation overlaps this time.${canEditSteps ? "\nDrag to reschedule." : ""}`
          : `${mo?.code ?? `Op #${op.id}`} — ${formatHm(start)} → ${formatHm(finish)}${canEditSteps ? "\nDrag to reschedule, click to edit." : ""}`
      }
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-md"
        style={{ backgroundColor: wsgColor ?? "var(--brand)" }}
      />
      <div className="ml-1.5 flex min-w-0 items-center gap-1">
        <p className="truncate font-mono text-[10px] font-semibold">
          {mo?.code ?? `MO #${op.manufacturing_order_id}`}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {formatHm(start)}–{formatHm(finish)}
        </p>
      </div>
      <p className="ml-1.5 truncate text-[11px] leading-tight">
        {mo?.item?.name ?? op.operation_description ?? "—"}
      </p>
      {(blockers > 0 || qcPending > 0) && (
        <div className="ml-1.5 mt-auto flex items-center gap-1">
          {blockers > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-red-500/20 px-1 py-0.5 text-[9px] font-semibold text-red-900 dark:text-red-200">
              <AlertTriangle className="size-2.5" />
              {blockers}
            </span>
          )}
          {qcPending > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/20 px-1 py-0.5 text-[9px] font-semibold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="size-2.5" />
              QC
            </span>
          )}
        </div>
      )}
    </button>
  );
}

// ---------- Month --------------------------------------------------------

function MonthCalendar({
  data,
  anchor,
}: {
  data: ProductionScheduleResponse;
  anchor: Date;
}) {
  const monthGrid = useMemo(() => buildMonthGrid(anchor), [anchor]);
  const opsByDay = useMemo(
    () => groupOpsByDay(data.operations, monthGrid.flat()),
    [data.operations, monthGrid],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border/60 bg-card">
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 overflow-auto">
          <div className="sticky top-0 z-30 grid grid-cols-[64px_repeat(7,_1fr)] border-b border-border/60 bg-muted/30">
            <div className="flex items-center justify-center text-[11px] font-semibold text-muted-foreground">
              {/* week-number gutter */}
            </div>
            {weekdayHeaders().map((label) => (
              <div
                key={label}
                className="border-l border-border/60 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {label}
              </div>
            ))}
          </div>
          {monthGrid.map((week) => (
            <div
              key={week[0].toISOString()}
              className="grid min-h-[88px] grid-cols-[64px_repeat(7,_1fr)] border-b border-border/60 last:border-b-0"
            >
              <div className="flex items-center justify-center text-[11px] font-semibold text-muted-foreground">
                W{isoWeek(week[0])}
              </div>
              {week.map((day) => (
                <MonthDayCell
                  key={day.toISOString()}
                  day={day}
                  anchorMonth={anchor.getUTCMonth()}
                  ops={opsByDay.get(dayKey(day)) ?? []}
                  workstationGroups={data.workstation_groups}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthDayCell({
  day,
  anchorMonth,
  ops,
  workstationGroups,
}: {
  day: Date;
  anchorMonth: number;
  ops: ScheduleOperation[];
  workstationGroups: ProductionScheduleResponse["workstation_groups"];
}) {
  const editor = useScheduleEditor();
  const inMonth = day.getUTCMonth() === anchorMonth;
  const isToday = isSameUtcDay(day, new Date());

  // Dedupe — month view shows one chip per MO per day (not per step).
  const moBuckets = useMemo(() => {
    const map = new Map<
      string,
      {
        op: ScheduleOperation;
        earliestStart: Date;
      }
    >();
    for (const op of ops) {
      if (!op.planned_start) continue;
      const start = new Date(op.planned_start);
      const moKey = op.manufacturing_order?.uuid ?? `op-${op.id}`;
      const existing = map.get(moKey);
      if (!existing || start.getTime() < existing.earliestStart.getTime()) {
        map.set(moKey, { op, earliestStart: start });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => a.earliestStart.getTime() - b.earliestStart.getTime(),
    );
  }, [ops]);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col gap-1 border-l border-border/60 p-1.5",
        !inMonth && "bg-muted/30 text-muted-foreground/60",
        isToday && "bg-primary/[0.08] ring-1 ring-inset ring-primary/30",
      )}
    >
      <div className="flex items-center justify-end">
        <span
          className={cn(
            "text-[10px] font-medium tabular-nums",
            isToday
              ? "rounded-full bg-primary px-1.5 py-0.5 text-primary-foreground"
              : inMonth
                ? "text-foreground/70"
                : "text-muted-foreground/50",
          )}
        >
          {day.getUTCDate()}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {moBuckets.map(({ op, earliestStart }) => (
          <MonthChip
            key={`${op.uuid}-${op.id}`}
            op={op}
            start={earliestStart}
            workstationGroups={workstationGroups}
            onClick={() =>
              editor?.openEditor({ kind: "step", stepUuid: op.uuid })
            }
          />
        ))}
      </div>
    </div>
  );
}

function MonthChip({
  op,
  start,
  workstationGroups,
  onClick,
}: {
  op: ScheduleOperation;
  start: Date;
  workstationGroups: ProductionScheduleResponse["workstation_groups"];
  onClick: () => void;
}) {
  const wsg = workstationGroups.find((g) => g.id === op.workstation_group_id);
  const mo = op.manufacturing_order;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="group relative flex flex-col overflow-hidden rounded border border-border/50 bg-card px-1 py-0.5 pl-2 text-left text-[10px] leading-[1.15] hover:bg-muted"
      title={`${mo?.code ?? `Op #${op.id}`} ${mo?.item?.name ?? ""}`}
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-[3px]"
        style={{ backgroundColor: wsg?.color ?? "var(--brand)" }}
      />
      <span className="flex items-center gap-1 font-mono tabular-nums">
        <span className="font-semibold text-foreground">{formatHm(start)}</span>
        <span className="truncate text-muted-foreground">
          {mo?.code ?? `OP#${op.id}`}
        </span>
      </span>
      <span className="truncate text-muted-foreground">
        {mo?.item?.name ?? op.operation_description ?? "—"}
      </span>
    </button>
  );
}

// ---------- Helpers ------------------------------------------------------

function visibleDays(zoom: "day" | "week", anchor: Date): Date[] {
  if (zoom === "day") {
    return [startOfDayUTC(anchor)];
  }
  const monday = startOfMondayUTC(anchor);
  return Array.from({ length: 7 }, (_, i) => addDaysUTC(monday, i));
}

function buildMonthGrid(anchor: Date): Date[][] {
  const first = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1),
  );
  const gridStart = startOfMondayUTC(first);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const days: Date[] = [];
    for (let d = 0; d < 7; d++) {
      days.push(addDaysUTC(gridStart, w * 7 + d));
    }
    weeks.push(days);
    const lastInWeek = days[6];
    // Stop after we've passed the month and at least one full week is rendered
    if (
      lastInWeek.getUTCMonth() !== anchor.getUTCMonth() &&
      lastInWeek.getTime() > first.getTime() + 28 * 86_400_000
    ) {
      break;
    }
  }
  return weeks;
}

function groupOpsByDay(
  ops: ScheduleOperation[],
  days: Date[],
): Map<string, ScheduleOperation[]> {
  const keys = new Set(days.map(dayKey));
  const out = new Map<string, ScheduleOperation[]>();
  for (const op of ops) {
    if (!op.planned_start) continue;
    const start = new Date(op.planned_start);
    const key = dayKey(start);
    if (!keys.has(key)) continue;
    const arr = out.get(key) ?? [];
    arr.push(op);
    out.set(key, arr);
  }
  return out;
}

function layoutForDay(
  start: Date,
  finish: Date,
  day: Date,
): { top: number; height: number } | null {
  // Clamp the op to the day's visible window (DAY_START_HOUR → DAY_END_HOUR + 1).
  const dayStart = new Date(day);
  dayStart.setHours(DAY_START_HOUR, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(DAY_END_HOUR + 1, 0, 0, 0);

  const visibleStart = start < dayStart ? dayStart : start;
  const visibleFinish = finish > dayEnd ? dayEnd : finish;
  if (visibleFinish <= visibleStart) return null;

  const top =
    ((visibleStart.getTime() - dayStart.getTime()) / 3_600_000) *
    HOUR_HEIGHT_PX;
  const height =
    ((visibleFinish.getTime() - visibleStart.getTime()) / 3_600_000) *
    HOUR_HEIGHT_PX;
  return { top, height };
}

/**
 * Pack overlapping ops into parallel lanes for side-by-side rendering
 * inside a single day column (Google-Calendar style).
 *
 * Algorithm:
 *   - Sort ops by start time.
 *   - Walk through; maintain the set of "active lanes" — lanes whose
 *     current op hasn't ended yet by this op's start.
 *   - Each op takes the lowest-numbered free lane (re-using a lane
 *     once its previous occupant finishes).
 *   - Group ops into "clusters" of mutually-overlapping ops; every op
 *     in a cluster gets the same `cluster` value (= max lane index in
 *     the cluster + 1), which is the divisor used to compute the
 *     width of each block. This is what keeps the cluster's blocks
 *     equally narrow even when only two of three lanes are active at
 *     a given vertical position.
 */
function assignLanes(
  ops: ScheduleOperation[],
): Map<number, { lane: number; cluster: number }> {
  const result = new Map<number, { lane: number; cluster: number }>();
  const usable = ops
    .filter((o) => o.planned_start && o.planned_finish)
    .map((o) => ({
      op: o,
      start: new Date(o.planned_start!).getTime(),
      end: new Date(o.planned_finish!).getTime(),
    }))
    .sort((a, b) => a.start - b.start);

  let active: { lane: number; end: number }[] = [];
  let clusterIds: number[] = [];
  let clusterMaxLane = 0;

  function flushCluster() {
    const width = clusterMaxLane + 1;
    for (const opId of clusterIds) {
      const prev = result.get(opId);
      if (prev) result.set(opId, { lane: prev.lane, cluster: width });
    }
    clusterIds = [];
    clusterMaxLane = 0;
  }

  for (const { op, start, end } of usable) {
    // Drop lanes whose op already ended before this one starts.
    active = active.filter((l) => l.end > start);

    // No overlap with anything active = end of the previous cluster.
    if (active.length === 0) flushCluster();

    // Find the lowest lane index not currently in use.
    const used = new Set(active.map((l) => l.lane));
    let lane = 0;
    while (used.has(lane)) lane++;

    active.push({ lane, end });
    clusterIds.push(op.id);
    if (lane > clusterMaxLane) clusterMaxLane = lane;
    result.set(op.id, { lane, cluster: 1 });
  }
  flushCluster();
  return result;
}

/**
 * Same-WSG overlap = a real conflict (one workstation can't run two
 * ops in parallel). Returns the set of op ids that share at least one
 * second of overlap with another op on the same workstation_group_id.
 * Ops with no WSG (unassigned steps) never conflict.
 */
function detectSameWsgConflicts(
  ops: ScheduleOperation[],
): Set<number> {
  const out = new Set<number>();
  const byWsg = new Map<number, ScheduleOperation[]>();
  for (const op of ops) {
    if (!op.workstation_group_id || !op.planned_start || !op.planned_finish) continue;
    const arr = byWsg.get(op.workstation_group_id) ?? [];
    arr.push(op);
    byWsg.set(op.workstation_group_id, arr);
  }
  for (const arr of byWsg.values()) {
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      const aStart = new Date(a.planned_start!).getTime();
      const aEnd = new Date(a.planned_finish!).getTime();
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        const bStart = new Date(b.planned_start!).getTime();
        const bEnd = new Date(b.planned_finish!).getTime();
        if (aStart < bEnd && bStart < aEnd) {
          out.add(a.id);
          out.add(b.id);
        }
      }
    }
  }
  return out;
}

function dayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

function startOfDayUTC(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function startOfMondayUTC(d: Date): Date {
  const s = startOfDayUTC(d);
  const dow = s.getUTCDay(); // 0 = Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  return new Date(s.getTime() + diff * 86_400_000);
}

function addDaysUTC(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

function formatHm(d: Date): string {
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function weekdayHeaders(): string[] {
  // Monday-first; localised via toLocaleDateString.
  const base = startOfMondayUTC(new Date());
  return Array.from({ length: 7 }, (_, i) =>
    addDaysUTC(base, i).toLocaleDateString(undefined, { weekday: "short" }),
  );
}

function isoWeek(d: Date): number {
  // ISO-8601 week number — Thursday-based.
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayOfWeek = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
}

export function CalendarEmpty() {
  return (
    <div className="m-6 flex flex-col items-center gap-2 rounded-md border border-dashed border-border/60 bg-muted/30 px-6 py-12 text-center text-sm text-muted-foreground">
      <CalendarOff className="size-6 opacity-50" />
      <p>Nothing scheduled in this range.</p>
    </div>
  );
}
