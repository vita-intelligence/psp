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
}

const HOUR_HEIGHT_PX = 56;
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 22;
const TIME_GUTTER_PX = 64;

export function CalendarView({ data, zoom, anchor }: Props) {
  if (zoom === "month") {
    return <MonthCalendar data={data} anchor={anchor} />;
  }
  return <TimedCalendar data={data} zoom={zoom} anchor={anchor} />;
}

// ---------- Timed (Day / Week) -----------------------------------------

function TimedCalendar({
  data,
  zoom,
  anchor,
}: {
  data: ProductionScheduleResponse;
  zoom: "day" | "week";
  anchor: Date;
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

  const totalHeight = (DAY_END_HOUR - DAY_START_HOUR + 1) * HOUR_HEIGHT_PX;
  const weekNumber = isoWeek(days[0]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col rounded-lg border border-border/60 bg-card">
      {/* Sticky day-header row */}
      <div
        className="grid border-b border-border/60 bg-muted/30"
        style={{
          gridTemplateColumns: `${TIME_GUTTER_PX}px repeat(${days.length}, minmax(0, 1fr))`,
        }}
      >
        <div className="flex items-center justify-center px-2 py-2 text-[11px] font-semibold text-muted-foreground">
          W{weekNumber}
        </div>
        {days.map((day) => (
          <DayHeader key={day.toISOString()} day={day} />
        ))}
      </div>

      {/* Scrollable body */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `${TIME_GUTTER_PX}px repeat(${days.length}, minmax(0, 1fr))`,
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
            />
          ))}
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
}: {
  day: Date;
  hours: number[];
  ops: ScheduleOperation[];
  workstationGroups: ProductionScheduleResponse["workstation_groups"];
  isLast: boolean;
}) {
  const isToday = isSameUtcDay(day, new Date());
  return (
    <div
      className={cn(
        "relative border-l border-border/60",
        isLast && "border-r-0",
        isToday && "bg-primary/[0.03]",
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
      {ops.map((op) => (
        <OperationBlock
          key={op.id}
          op={op}
          day={day}
          workstationGroups={workstationGroups}
        />
      ))}
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
}: {
  op: ScheduleOperation;
  day: Date;
  workstationGroups: ProductionScheduleResponse["workstation_groups"];
}) {
  const editor = useScheduleEditor();
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

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        editor?.openEditor({ kind: "step", stepUuid: op.uuid });
      }}
      style={{
        top: layout.top,
        height: Math.max(layout.height, 18),
        left: 4,
        right: 4,
      }}
      className="absolute z-10 flex flex-col gap-0.5 overflow-hidden rounded-md border border-border/70 bg-card px-1.5 py-1 text-left text-[11px] shadow-sm transition-shadow hover:shadow-md"
      title={`${mo?.code ?? `Op #${op.id}`} — ${formatHm(start)} → ${formatHm(finish)}`}
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
    <div className="flex h-full min-h-0 flex-1 flex-col rounded-lg border border-border/60 bg-card">
      <div className="grid grid-cols-[64px_repeat(7,_1fr)] border-b border-border/60 bg-muted/30">
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
      <div className="flex-1 overflow-auto">
        {monthGrid.map((week) => (
          <div
            key={week[0].toISOString()}
            className="grid min-h-[120px] grid-cols-[64px_repeat(7,_1fr)] border-b border-border/60 last:border-b-0"
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
        !inMonth && "bg-muted/20 text-muted-foreground",
        isToday && "bg-primary/[0.05]",
      )}
    >
      <div className="flex items-center justify-end text-[11px] font-semibold">
        {day.getUTCDate()}
      </div>
      <div className="flex flex-col gap-1">
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
      className="group relative flex flex-col overflow-hidden rounded border border-border/60 bg-card px-1.5 py-0.5 text-left text-[10px] leading-tight hover:bg-muted"
      title={`${mo?.code ?? `Op #${op.id}`} ${mo?.item?.name ?? ""}`}
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1"
        style={{ backgroundColor: wsg?.color ?? "var(--brand)" }}
      />
      <span className="ml-1.5 flex items-center gap-1">
        <span className="font-semibold">{formatHm(start)}</span>
        <span className="truncate font-mono">{mo?.code ?? `OP#${op.id}`}</span>
      </span>
      <span className="ml-1.5 truncate text-muted-foreground">
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
