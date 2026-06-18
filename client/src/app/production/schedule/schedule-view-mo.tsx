"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type {
  ProductionScheduleResponse,
  ScheduleOperation,
} from "@/lib/production/types";
import {
  ROW_HEIGHT_PX,
  WorkingIntervalsContext,
  closedSegmentsWithin,
  dayLabel,
  isoDate,
  rangeDays as rangeDaysList,
  useDragBounds,
  useTimeScale,
  useWorkingIntervals,
  type DayWindow,
  type TimeScale,
} from "./schedule-shared";

// Layout constants — kept in this file so every view stacks
// consistently. Day header sticks to the top, label gutter
// sticks to the left, every other layer derives from these.
export const DAY_HEADER_HEIGHT_PX = 56;
export const LABEL_GUTTER_PX = 224; // 14rem — used by all views

export interface MORow {
  moId: number;
  moUuid: string;
  moCode: string | null;
  itemName: string;
  qty: string;
  status: string;
  start: string;
  finish: string;
  steps: ScheduleOperation[];
}

export function rowsFromOps(operations: ScheduleOperation[]): MORow[] {
  const grouped = new Map<number, MORow>();
  for (const op of operations) {
    const mo = op.manufacturing_order;
    if (!mo || !op.planned_start || !op.planned_finish) continue;

    const cur = grouped.get(mo.id);
    if (!cur) {
      grouped.set(mo.id, {
        moId: mo.id,
        moUuid: mo.uuid,
        moCode: mo.code,
        itemName: mo.item?.name ?? "—",
        qty: mo.quantity,
        status: mo.status,
        start: op.planned_start,
        finish: op.planned_finish,
        steps: [op],
      });
    } else {
      cur.steps.push(op);
      if (new Date(op.planned_start).getTime() < new Date(cur.start).getTime()) {
        cur.start = op.planned_start;
      }
      if (new Date(op.planned_finish).getTime() > new Date(cur.finish).getTime()) {
        cur.finish = op.planned_finish;
      }
    }
  }
  return Array.from(grouped.values()).sort(
    (a, b) =>
      new Date(a.start).getTime() - new Date(b.start).getTime() ||
      a.moId - b.moId,
  );
}

/** Build per-day windows for the SITE (warehouse-level). Used by
 *  MO + project views which don't differentiate per-WSG hours. */
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

// ────────────────────────────────────────────────────────────────
// Shared overlays — positioned by the parent (no grid placement)
// ────────────────────────────────────────────────────────────────

/** Green working-hours bands + gray closed-time stripes for every
 *  day in the visible range. Renders absolute children that fill
 *  their nearest positioned ancestor; place inside a div sized to
 *  `rangeWidthPx` × full row stack height. */
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
              className="pointer-events-none absolute top-0 bottom-0 bg-destructive/[0.04]"
              style={{
                left: dayLeft,
                width: dayWidth,
                backgroundImage:
                  "repeating-linear-gradient(135deg, transparent 0 6px, rgba(220,38,38,0.08) 6px 12px)",
              }}
            />
          );
        }

        // Closed-time base + green working-hour bands on top.
        return (
          <div key={day.date} className="pointer-events-none">
            <div
              className="absolute top-0 bottom-0 bg-muted/25"
              style={{
                left: dayLeft,
                width: dayWidth,
                backgroundImage:
                  "repeating-linear-gradient(135deg, transparent 0 6px, rgba(100,116,139,0.08) 6px 12px)",
              }}
            />
            {day.intervals.map((iv, ii) => {
              const left = scale.pxAt(iv.open);
              const width = scale.pxAt(iv.close) - left;
              if (width <= 0) return null;
              return (
                <div
                  key={`${day.date}-${ii}`}
                  className="absolute top-0 bottom-0 bg-emerald-50/80 dark:bg-emerald-950/20"
                  style={{ left, width }}
                />
              );
            })}
          </div>
        );
      })}
    </>
  );
}

/** Faint vertical lines at every minor tick of the time scale.
 *  Place inside the same absolute container as WorkingHoursOverlay. */
export function Gridlines() {
  const scale = useTimeScale();
  const lines: { left: number; major: boolean }[] = [];
  for (
    let t = scale.rangeStart.getTime();
    t <= scale.rangeEnd.getTime();
    t += scale.preset.minorTickMs
  ) {
    const major =
      (t - scale.rangeStart.getTime()) % scale.preset.majorTickMs === 0;
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

/** Render diagonal-stripe overlays INSIDE a block for every
 *  closed-time gap that falls within the block's visible span
 *  (overnight, weekend, holiday). The block itself stays one
 *  continuous rectangle — but the closed portions are visually
 *  dimmed so the operator can read "work · paused · work · paused".
 *  Positioned absolutely inside the block; the block must be
 *  position: relative or absolute, and uses `overflow-hidden` to
 *  clip stripes that overflow the rounded corners. */
export function PausedSegmentsOverlay({
  spanStartMs,
  spanEndMs,
}: {
  spanStartMs: number;
  spanEndMs: number;
}) {
  const scale = useTimeScale();
  const intervals = useWorkingIntervals();
  if (intervals.length === 0) return null;
  if (spanEndMs <= spanStartMs) return null;

  const closed = closedSegmentsWithin(spanStartMs, spanEndMs, intervals);
  if (closed.length === 0) return null;

  const pxPerMs = scale.preset.pxPerMs;

  return (
    <>
      {closed.map((seg, i) => {
        const left = (seg.start - spanStartMs) * pxPerMs;
        const width = (seg.end - seg.start) * pxPerMs;
        if (width <= 0) return null;
        return (
          <div
            key={i}
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 bg-background/55"
            style={{
              left,
              width,
              backgroundImage:
                "repeating-linear-gradient(135deg, transparent 0 5px, rgba(100,116,139,0.35) 5px 10px)",
            }}
          />
        );
      })}
    </>
  );
}

/** Red diagonal-stripe overlay covering the areas where a
 *  currently-dragged MO CAN'T land without breaking chain order
 *  (before scheduled descendants finish, or after the parent's
 *  start). Renders only while a chain-constrained drag is active. */
export function DragBoundsOverlay() {
  const scale = useTimeScale();
  const bounds = useDragBounds();
  if (!bounds) return null;

  const startMs = scale.rangeStart.getTime();
  const endMs = scale.rangeEnd.getTime();
  const minPx = Math.max(scale.pxAt(new Date(bounds.minStartMs)), 0);
  const maxPx =
    bounds.maxFinishMs == null
      ? scale.rangeWidthPx
      : Math.min(scale.pxAt(new Date(bounds.maxFinishMs)), scale.rangeWidthPx);

  const showLeft = bounds.minStartMs > startMs;
  const showRight = bounds.maxFinishMs != null && bounds.maxFinishMs < endMs;

  return (
    <>
      {showLeft && (
        <div
          className="pointer-events-none absolute top-0 bottom-0 left-0 bg-destructive/15"
          style={{
            width: minPx,
            backgroundImage:
              "repeating-linear-gradient(135deg, transparent 0 6px, rgba(220,38,38,0.15) 6px 12px)",
          }}
        />
      )}
      {showRight && (
        <div
          className="pointer-events-none absolute top-0 bottom-0 bg-destructive/15"
          style={{
            left: maxPx,
            right: 0,
            backgroundImage:
              "repeating-linear-gradient(135deg, transparent 0 6px, rgba(220,38,38,0.15) 6px 12px)",
          }}
        />
      )}
      {/* Soft green tint over the valid window — confirms
          "yes, you can drop in here" without being intrusive. */}
      {(showLeft || showRight) && (
        <div
          className="pointer-events-none absolute top-0 bottom-0 bg-emerald-100/20"
          style={{ left: minPx, width: Math.max(maxPx - minPx, 0) }}
        />
      )}
    </>
  );
}

function useNowEveryMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Striped gray overlay covering the PAST portion of the visible
 *  range. Place inside the same absolute container as the working
 *  hours / gridlines overlay (NOT its own grid item). */
export function PastZoneOverlay() {
  const scale = useTimeScale();
  const now = useNowEveryMinute();
  const nowMs = now.getTime();
  const startMs = scale.rangeStart.getTime();
  if (nowMs <= startMs) return null;
  const pastWidth = Math.min(scale.pxAt(now), scale.rangeWidthPx);
  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 left-0 bg-muted/15"
      style={{
        width: pastWidth,
        backgroundImage:
          "repeating-linear-gradient(45deg, transparent 0 8px, rgba(100,116,139,0.10) 8px 14px)",
      }}
    />
  );
}

/** Vertical NOW line + "NOW" pill. Renders on its OWN absolute
 *  layer so callers can position it at a high z-index (above the
 *  day header). */
export function NowLineMarker() {
  const scale = useTimeScale();
  const now = useNowEveryMinute();
  const nowMs = now.getTime();
  const startMs = scale.rangeStart.getTime();
  const endMs = scale.rangeEnd.getTime();
  if (nowMs <= startMs || nowMs >= endMs) return null;
  const left = scale.pxAt(now);
  return (
    <>
      <div
        className="pointer-events-none absolute top-0 bottom-0 w-px bg-destructive"
        style={{ left }}
      />
      {/* Pill at the top of the day header, anchored to the right
          of the NOW line so it doesn't bleed into the sticky label
          column. Sits at z-40 (the NOW container) — sticky labels
          + corner are z-50, so when the user scrolls horizontally
          and "now" drifts behind the labels, the labels cover the
          pill cleanly. */}
      <div
        className="pointer-events-none absolute top-1 ml-0.5 whitespace-nowrap rounded bg-destructive px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-destructive-foreground shadow"
        style={{ left }}
      >
        Now
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// Day header strip — sticky top, draws inside the time-axis area
// ────────────────────────────────────────────────────────────────

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
      className="relative bg-muted"
      style={{ width: scale.rangeWidthPx, height: DAY_HEADER_HEIGHT_PX }}
    >
      {days.map((d) => {
        const left = scale.pxAt(d);
        const next = new Date(d);
        next.setUTCDate(next.getUTCDate() + 1);
        const width = scale.pxAt(next) - left;
        const { primary, secondary } = dayLabel(d, scale.zoom);
        const win = dayWindows.find((w) => w.date === isoDate(d));
        const isDayOff =
          !win?.holiday_label && (win?.intervals.length ?? 0) === 0;
        return (
          <div
            key={d.toISOString()}
            className={cn(
              "absolute top-0 bottom-0 border-r border-border/60 px-2 py-1.5",
              win?.holiday_label && "bg-destructive/10",
              isDayOff && "bg-muted/40",
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
            {win?.holiday_label && (
              <p className="mt-0.5 inline-flex items-center gap-1 truncate text-[10px] font-medium text-destructive">
                <AlertTriangle className="size-2.5" />
                {win.holiday_label}
              </p>
            )}
          </div>
        );
      })}
      {scale.zoom === "day" && (
        <HourTicks topOffset={20} stride={3 * 3600 * 1000} />
      )}
    </div>
  );
}

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
    if (d.getUTCMinutes() !== 0) continue;
    ticks.push({
      left: scale.pxAt(d),
      label: d
        .toISOString()
        .slice(11, 16),
    });
  }
  return (
    <>
      {ticks.map((tk, i) => (
        <span
          key={i}
          className="absolute text-[10px] tabular-nums text-muted-foreground/70"
          style={{ left: tk.left + 2, top: topOffset }}
        >
          {tk.label}
        </span>
      ))}
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// Legend
// ────────────────────────────────────────────────────────────────

export function Legend({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border/60 bg-card px-3 py-2 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-2 rounded-sm bg-emerald-200 ring-1 ring-inset ring-emerald-300" />
        Working hours
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-2 rounded-sm bg-destructive/20 ring-1 ring-inset ring-destructive/30" />
        Holiday
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-2 rounded-sm bg-muted ring-1 ring-inset ring-border" />
        Day off
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-px bg-destructive" />
        Now (past is locked)
      </span>
      {children && (
        <span className="text-[11px] text-muted-foreground">{children}</span>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Reusable calendar shell
// ────────────────────────────────────────────────────────────────

/** The shared layout for every calendar view. Renders:
 *  - sticky day header at top with sticky corner label
 *  - background overlays (working hours + past zone) anchored
 *    behind the rows
 *  - the rows themselves (flex-row layout per row)
 *  - NOW line painted on the very top layer
 *  - footer legend
 *
 *  No CSS Grid — each row is a self-contained flex container with
 *  a sticky-left label and a flex-1 content area. Overlays are
 *  absolute siblings of the row stack so they never fight with
 *  grid auto-placement again. */
export function CalendarShell({
  cornerLabel,
  days,
  dayWindows,
  rowLabelWidth = LABEL_GUTTER_PX,
  scrollRef,
  legend,
  children,
}: {
  cornerLabel: React.ReactNode;
  days: Date[];
  dayWindows: DayWindow[];
  rowLabelWidth?: number;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  legend?: React.ReactNode;
  children: React.ReactNode;
}) {
  const scale = useTimeScale();
  const totalWidth = rowLabelWidth + scale.rangeWidthPx;

  // Flatten the per-day working windows into a single sorted list
  // of intervals — used by blocks to compute their own paused
  // sub-segments (closed time inside the block's span).
  const workingIntervals = useMemo(() => {
    const out: Array<{ open: Date; close: Date }> = [];
    for (const day of dayWindows) {
      for (const iv of day.intervals) {
        out.push({ open: new Date(iv.open), close: new Date(iv.close) });
      }
    }
    return out.sort((a, b) => a.open.getTime() - b.open.getTime());
  }, [dayWindows]);

  return (
    <WorkingIntervalsContext.Provider value={workingIntervals}>
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border/60 bg-card shadow-sm">
      {/* Outer card uses relative positioning so the corner cell
          can be hoisted OUTSIDE the scroll container as an overlay.
          The corner needs its own stacking context above the NOW
          container — nested z-index inside the day header's z-30
          context can't escape that context, which is why earlier
          attempts had the NOW pill bleeding over the corner. */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          data-schedule-scroll
          className="absolute inset-0 overflow-auto"
        >
          <div
            className="relative flex flex-col bg-card"
            style={{ width: totalWidth, minHeight: "100%" }}
          >
            {/* Layer 0 — background overlays. Anchored under the
                day header, behind everything else via DOM order. */}
            <div
              className="pointer-events-none absolute"
              style={{
                top: DAY_HEADER_HEIGHT_PX,
                left: rowLabelWidth,
                width: scale.rangeWidthPx,
                bottom: 0,
              }}
            >
              <WorkingHoursOverlay dayWindows={dayWindows} />
              <Gridlines />
              <PastZoneOverlay />
              <DragBoundsOverlay />
            </div>

            {/* Layer 30 — sticky day header. Empty transparent
                spacer where the corner overlay will sit on top. */}
            <div
              className="sticky top-0 z-30 flex border-b border-border/60 bg-muted"
              style={{ height: DAY_HEADER_HEIGHT_PX }}
            >
              <div
                className="shrink-0"
                style={{ width: rowLabelWidth }}
                aria-hidden
              />
              <DayHeaderStrip days={days} dayWindows={dayWindows} />
            </div>

            {/* Layer 10 — rows. Each row hosts a sticky-left
                label and a flex-1 content area. */}
            {children}

            {/* Tail spacer — flex-1 row that fills the rest of the
                vertical space. Its left cell carries the same
                sticky bg-card as the row labels, so the white
                gutter continues to the bottom of the calendar. */}
            <div className="flex flex-1">
              <div
                className="sticky left-0 z-50 shrink-0 border-r border-border/60 bg-card shadow-[1px_0_0_0_rgba(0,0,0,0.06)]"
                style={{ width: rowLabelWidth }}
              />
              <div className="flex-1" />
            </div>

            {/* Layer 40 — NOW line + pill (inside scroll, scrolls
                with the time axis). pointer-events-none so drag
                events reach the blocks underneath. */}
            <div
              className="pointer-events-none absolute"
              style={{
                top: 0,
                left: rowLabelWidth,
                width: scale.rangeWidthPx,
                bottom: 0,
                zIndex: 40,
              }}
            >
              <NowLineMarker />
            </div>
          </div>
        </div>

        {/* Corner cell — OVERLAY outside the scroll container.
            Always sits at top-left of the card. Doesn't scroll.
            Lives in the outer card's stacking context, so it
            paints above everything inside the scroll — including
            the NOW container's z-40 pill that drifts into the
            label gutter as the user scrolls horizontally. */}
        <div
          className="absolute top-0 left-0 z-50 flex border-b border-r border-border/60 bg-card shadow-[1px_0_0_0_rgba(0,0,0,0.06)]"
          style={{
            width: rowLabelWidth,
            height: DAY_HEADER_HEIGHT_PX,
          }}
        >
          <div className="flex h-full items-center px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {cornerLabel}
          </div>
        </div>
      </div>

      {legend ?? <Legend />}
    </div>
    </WorkingIntervalsContext.Provider>
  );
}

/** Single calendar row — sticky-left label + flex-1 content area.
 *  Children render inside the content area (typically blocks). */
export function CalendarRow({
  labelWidth = LABEL_GUTTER_PX,
  height,
  label,
  contentRef,
  contentClassName,
  children,
}: {
  labelWidth?: number;
  height: number;
  label: React.ReactNode;
  contentRef?: React.RefCallback<HTMLDivElement>;
  contentClassName?: string;
  children?: React.ReactNode;
}) {
  const scale = useTimeScale();
  return (
    <div className="flex border-b border-border/60" style={{ height }}>
      {/* z-50 so the sticky label always covers the NOW line +
          past-zone (z-40) when the user scrolls horizontally and
          the NOW container's anchored position drifts into the
          left gutter. */}
      <div
        className="sticky left-0 z-50 shrink-0 border-r border-border/60 bg-card shadow-[1px_0_0_0_rgba(0,0,0,0.06)]"
        style={{ width: labelWidth }}
      >
        {label}
      </div>
      <div
        ref={contentRef}
        className={cn("relative shrink-0", contentClassName)}
        style={{ width: scale.rangeWidthPx, height }}
      >
        {children}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// MO view
// ────────────────────────────────────────────────────────────────

interface MOViewProps {
  data: ProductionScheduleResponse;
  rows: MORow[];
  canEditSteps: boolean;
}

export function MOView({ data, rows, canEditSteps }: MOViewProps) {
  const scale = useTimeScale();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to "today" (or rangeStart 6am if today is outside
  // the visible range). Otherwise on Week zoom the user lands on
  // Monday and has to scroll right to find current/next-week
  // blocks — making it look like "data didn't load".
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
    // Land a hair before the target so the user can see the
    // adjacent past time too, but mostly forward.
    el.scrollLeft = Math.max(0, scale.pxAt(target) - 48);
  }, [scale]);

  const days = useMemo(() => rangeDaysList(scale), [scale]);
  const dayWindows = useMemo(
    () => dayWindowsForSite(data.working_windows, days),
    [data.working_windows, days],
  );

  return (
    <CalendarShell
      cornerLabel="Manufacturing order"
      days={days}
      dayWindows={dayWindows}
      scrollRef={scrollRef}
      legend={<Legend>Drag a block to reschedule.</Legend>}
    >
      {rows.map((row) => (
        <CalendarRow
          key={row.moId}
          height={ROW_HEIGHT_PX}
          label={<MORowLabel row={row} />}
        >
          <MOblock
            row={row}
            canEditSteps={canEditSteps}
            workstationGroups={data.workstation_groups}
          />
        </CalendarRow>
      ))}
    </CalendarShell>
  );
}

function MORowLabel({ row }: { row: MORow }) {
  return (
    <div className="flex h-full min-w-0 flex-col justify-center px-3 py-2">
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
  );
}

interface MOblockProps {
  row: MORow;
  canEditSteps: boolean;
  workstationGroups: ProductionScheduleResponse["workstation_groups"];
}

function MOblock({ row, canEditSteps, workstationGroups }: MOblockProps) {
  const scale = useTimeScale();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `mo-${row.moUuid}`,
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
  const totalDurationMs = endMs - startMs;

  const dragStyle: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};
  const wsgColor = (id: number | null) =>
    workstationGroups.find((g) => g.id === id)?.color ?? "var(--brand)";
  const statusColor =
    row.status === "in_progress"
      ? "border-amber-500 bg-amber-100/70 dark:bg-amber-950/30"
      : "border-indigo-400 bg-indigo-100/70 dark:bg-indigo-950/30";

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
        "absolute z-10 select-none overflow-hidden rounded-md border-2 text-[11px] shadow-sm transition-shadow",
        statusColor,
        canEditSteps ? "cursor-grab" : "cursor-default",
        isDragging && "z-30 cursor-grabbing shadow-lg",
      )}
      title={`${row.moCode ?? `MO #${row.moId}`} · ${row.itemName}`}
    >
      {/* Per-step color bars — subtle bg hint for the WSGs that
          run this MO. */}
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
                opacity: 0.22,
              }}
            />
          );
        })}
      </div>
      {/* "Paused" cut-outs for closed time inside the MO's span —
          overnight gaps, weekends, holidays. Renders as a darker
          striped overlay so the operator sees "work · paused · work"
          even though the block itself stays one continuous unit. */}
      <PausedSegmentsOverlay
        spanStartMs={visibleStart}
        spanEndMs={visibleEnd}
      />
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
