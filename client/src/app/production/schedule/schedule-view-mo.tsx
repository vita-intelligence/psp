"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type {
  ProductionScheduleResponse,
  ScheduleOperation,
} from "@/lib/production/types";
import {
  ROW_HEIGHT_PX,
  dayLabel,
  isoDate,
  rangeDays as rangeDaysList,
  useTimeScale,
  type DayWindow,
} from "./schedule-shared";

export interface MORow {
  moId: number;
  moUuid: string;
  moCode: string | null;
  itemName: string;
  status: string;
  start: string;
  finish: string;
  qty: string;
  steps: ScheduleOperation[];
}

export function rowsFromOps(operations: ScheduleOperation[]): MORow[] {
  const byMo = new Map<number, ScheduleOperation[]>();
  for (const op of operations) {
    const k = op.manufacturing_order_id;
    const arr = byMo.get(k) ?? [];
    arr.push(op);
    byMo.set(k, arr);
  }

  return Array.from(byMo.entries())
    .map(([_, steps]) => {
      const sorted = [...steps].sort(
        (a, b) =>
          new Date(a.planned_start ?? 0).getTime() -
          new Date(b.planned_start ?? 0).getTime(),
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const mo = first?.manufacturing_order;
      return {
        moId: mo?.id ?? 0,
        moUuid: mo?.uuid ?? "",
        moCode: mo?.code ?? null,
        itemName: mo?.item?.name ?? "—",
        status: mo?.status ?? "draft",
        start: first?.planned_start ?? "",
        finish: last?.planned_finish ?? "",
        qty: mo?.quantity ?? "0",
        steps: sorted,
      } as MORow;
    })
    .filter((r) => r.start && r.finish)
    .sort(
      (a, b) =>
        new Date(a.start).getTime() - new Date(b.start).getTime() ||
        a.moId - b.moId,
    );
}

export function dayWindowsForSite(
  windows: ProductionScheduleResponse["working_windows"],
  days: Date[],
): DayWindow[] {
  if (windows.length === 0) {
    return days.map((d) => ({
      date: isoDate(d),
      holiday_label: null,
      intervals: [],
    }));
  }
  return days.map((d) => {
    const dIso = isoDate(d);
    const groupDays = windows
      .map((gw) => gw.days.find((day) => day.date === dIso))
      .filter((x): x is NonNullable<typeof x> => x != null);

    const allHoliday =
      groupDays.length > 0 && groupDays.every((g) => g.holiday_label != null);

    const intervals = groupDays.flatMap((g) => g.intervals);
    const holiday_label = allHoliday
      ? (groupDays.find((g) => g.holiday_label)?.holiday_label ?? null)
      : null;

    return { date: dIso, holiday_label, intervals };
  });
}

interface MOViewProps {
  data: ProductionScheduleResponse;
  rows: MORow[];
  canEditSteps: boolean;
  onEdit: (moUuid: string) => void;
}

export function MOView({
  data,
  rows,
  canEditSteps,
  onEdit,
}: MOViewProps) {
  const scale = useTimeScale();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Auto-scroll to roughly 06:00 on the first day in the range — most
  // production floors start there. Recomputes when zoom/range changes.
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
          <CornerLabel>Manufacturing order</CornerLabel>
          <DayHeaderStrip days={days} dayWindows={dayWindows} />

          {rows.map((row) => (
            <MOrow
              key={row.moId}
              row={row}
              dayWindows={dayWindows}
              canEditSteps={canEditSteps}
              workstationGroups={data.workstation_groups}
              onEdit={onEdit}
            />
          ))}
        </div>
      </div>
      <Legend>
        Drag a block to reschedule. Click to edit step durations.
      </Legend>
    </div>
  );
}

export function CornerLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky left-0 z-30 border-b border-r border-border/60 bg-card px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground shadow-[1px_0_0_0_rgba(0,0,0,0.06)]">
      {children}
    </div>
  );
}

export function DayHeaderStrip({
  days,
  dayWindows,
}: {
  days: Date[];
  dayWindows: DayWindow[];
}) {
  const scale = useTimeScale();

  return (
    <div
      className="relative h-12 border-b border-border/60 bg-muted"
      style={{ width: scale.rangeWidthPx }}
    >
      {/* Day boundaries */}
      {days.map((d) => {
        const left = scale.pxAt(d);
        const next = new Date(d);
        next.setUTCDate(next.getUTCDate() + 1);
        const right = scale.pxAt(next);
        const width = right - left;
        const { primary, secondary } = dayLabel(d, scale.zoom);
        const window = dayWindows.find((w) => w.date === isoDate(d));

        return (
          <div
            key={d.toISOString()}
            className={cn(
              "absolute top-0 bottom-0 border-r border-border/60 px-2 py-1.5",
              window?.holiday_label && "bg-destructive/10",
            )}
            style={{ left, width }}
          >
            <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {primary}
              {secondary && (
                <span className="ml-1 font-normal text-muted-foreground/70">
                  · {secondary}
                </span>
              )}
            </p>
            {window?.holiday_label && (
              <p className="mt-0.5 inline-flex items-center gap-1 truncate text-[10px] font-medium text-destructive">
                <AlertTriangle className="size-2.5" />
                {window.holiday_label}
              </p>
            )}
          </div>
        );
      })}

      {/* Hour ticks inside each day, only when zoom is fine enough */}
      {scale.zoom === "day" && (
        <HourTicks topOffset={20} stride={3 * 3600 * 1000} />
      )}
    </div>
  );
}

/** Renders text ticks every `stride` ms along the day-header strip,
 *  positioned by scale.pxAt(). Used only in Day zoom (hours labels). */
function HourTicks({
  topOffset,
  stride,
}: {
  topOffset: number;
  stride: number;
}) {
  const scale = useTimeScale();
  const ticks: { left: number; label: string }[] = [];
  for (
    let t = scale.rangeStart.getTime();
    t < scale.rangeEnd.getTime();
    t += stride
  ) {
    const d = new Date(t);
    const label = d
      .toISOString()
      .slice(11, 16); // HH:MM
    ticks.push({ left: scale.pxAt(d), label });
  }
  return (
    <>
      {ticks.map((t) => (
        <span
          key={t.left}
          className="absolute font-mono text-[9px] text-muted-foreground/70"
          style={{ left: t.left + 2, top: topOffset }}
        >
          {t.label}
        </span>
      ))}
    </>
  );
}

export function Legend({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-2 rounded-sm bg-emerald-200 ring-1 ring-inset ring-emerald-300" />
        Working hours
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-2 rounded-sm bg-destructive/20 ring-1 ring-inset ring-destructive/30" />
        Holiday / closed
      </span>
      <span className="text-[11px] text-muted-foreground">{children}</span>
    </div>
  );
}

export function WorkingHoursOverlay({
  dayWindows,
}: {
  dayWindows: DayWindow[];
}) {
  const scale = useTimeScale();
  return (
    <>
      {dayWindows.map((day) => {
        const d = new Date(`${day.date}T00:00:00Z`);
        const next = new Date(d);
        next.setUTCDate(next.getUTCDate() + 1);
        const dayLeft = scale.pxAt(d);
        const dayWidth = scale.pxAt(next) - dayLeft;

        if (day.holiday_label) {
          return (
            <div
              key={day.date}
              className="absolute top-0 bottom-0 bg-destructive/[0.04]"
              style={{
                left: dayLeft,
                width: dayWidth,
                backgroundImage:
                  "repeating-linear-gradient(135deg, transparent 0 6px, rgba(220,38,38,0.08) 6px 12px)",
              }}
            />
          );
        }
        return day.intervals.map((iv, ii) => {
          const left = scale.pxAt(iv.open);
          const width = scale.pxAt(iv.close) - left;
          if (width <= 0) return null;
          return (
            <div
              key={`${day.date}-${ii}`}
              className="absolute top-0 bottom-0 bg-emerald-50/60 dark:bg-emerald-950/15"
              style={{ left, width }}
            />
          );
        });
      })}
    </>
  );
}

export function Gridlines() {
  const scale = useTimeScale();
  const lines: { left: number; major: boolean }[] = [];

  for (
    let t = scale.rangeStart.getTime();
    t <= scale.rangeEnd.getTime();
    t += scale.preset.minorTickMs
  ) {
    const major = (t - scale.rangeStart.getTime()) % scale.preset.majorTickMs === 0;
    lines.push({ left: scale.pxAt(new Date(t)), major });
  }

  return (
    <>
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            "pointer-events-none absolute top-0 bottom-0 w-px",
            l.major ? "bg-border" : "bg-border/20",
          )}
          style={{ left: l.left }}
        />
      ))}
    </>
  );
}

interface MOrowProps {
  row: MORow;
  dayWindows: DayWindow[];
  canEditSteps: boolean;
  workstationGroups: ProductionScheduleResponse["workstation_groups"];
  onEdit: (moUuid: string) => void;
}

function MOrow({
  row,
  dayWindows,
  canEditSteps,
  workstationGroups,
  onEdit,
}: MOrowProps) {
  const scale = useTimeScale();
  return (
    <>
      <div
        className="sticky left-0 z-20 border-b border-r border-border/60 bg-card px-3 py-2 shadow-[1px_0_0_0_rgba(0,0,0,0.06)]"
        style={{ height: ROW_HEIGHT_PX }}
      >
        <div className="flex h-full min-w-0 flex-col justify-center">
          <Link
            href={`/production/manufacturing-orders/${row.moUuid}`}
            className="inline-flex min-w-0 items-center gap-1 font-mono text-[10px] font-semibold text-brand hover:underline"
            title={row.moCode ?? `MO #${row.moId}`}
          >
            <span className="truncate">{row.moCode ?? `MO #${row.moId}`}</span>
            <ExternalLink className="size-2.5 shrink-0" />
          </Link>
          <p className="truncate text-xs" title={row.itemName}>
            {row.itemName}
          </p>
        </div>
      </div>

      <div
        className="relative border-b border-border/60"
        style={{ width: scale.rangeWidthPx, height: ROW_HEIGHT_PX }}
      >
        <WorkingHoursOverlay dayWindows={dayWindows} />
        <Gridlines />
        <MOblock
          row={row}
          canEditSteps={canEditSteps}
          workstationGroups={workstationGroups}
          onEdit={onEdit}
        />
      </div>
    </>
  );
}

interface MOblockProps {
  row: MORow;
  canEditSteps: boolean;
  workstationGroups: ProductionScheduleResponse["workstation_groups"];
  onEdit: (moUuid: string) => void;
}

function MOblock({
  row,
  canEditSteps,
  workstationGroups,
  onEdit,
}: MOblockProps) {
  // Hooks before any early returns — React enforces hook order.
  const scale = useTimeScale();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `mo-${row.moUuid}`,
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

  const totalDurationMs = endMs - startMs;

  const dragStyle: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};

  const wsgColor = (id: number | null) =>
    workstationGroups.find((g) => g.id === id)?.color ?? "var(--brand)";

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
    onEdit(row.moUuid);
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
        "group absolute select-none overflow-hidden rounded-md border text-[11px] shadow-sm transition-shadow",
        statusColor,
        canEditSteps ? "cursor-grab" : "cursor-pointer",
        isDragging && "z-30 cursor-grabbing shadow-lg",
      )}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMoveCapture={onPointerMoveCapture}
      onClick={onClick}
    >
      <div className="absolute inset-0 flex" aria-hidden>
        {row.steps.map((step) => {
          const sMs = new Date(step.planned_start ?? row.start).getTime();
          const eMs = new Date(step.planned_finish ?? row.finish).getTime();
          const span = totalDurationMs === 0 ? 0 : (eMs - sMs) / totalDurationMs;
          return (
            <div
              key={step.id}
              style={{
                width: `${Math.max(span * 100, 1)}%`,
                backgroundColor: wsgColor(step.workstation_group_id),
                opacity: 0.18,
              }}
            />
          );
        })}
      </div>
      <div className="relative flex h-full items-center gap-2 px-2 py-1">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[10px] font-semibold">
            {row.moCode ?? `MO #${row.moId}`}
          </p>
          <p className="truncate text-[11px]" title={row.itemName}>
            {row.itemName}
          </p>
        </div>
      </div>
    </div>
  );
}
