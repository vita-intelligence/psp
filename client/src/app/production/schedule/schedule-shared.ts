// Time-scale presets + helpers shared by all three schedule view
// components.
//
// Three discrete zoom levels — each one trades range for granularity:
//
//   - Day:   1 day visible, 15-min ticks (operator-level detail)
//   - Week:  7 days visible, hourly ticks (the planner's default)
//   - Month: 28 days visible, daily ticks (capacity / look-ahead)
//
// Zooming in walks toward Day; zooming out walks toward Month. The
// workspace owns the zoom state + the visible date range and passes
// them down through context so every nested grid component picks up
// the same scale without prop drilling.

import { createContext, useContext } from "react";

export const ROW_HEIGHT_PX = 56;

export type ZoomLevel = "day" | "week" | "month";

export const ZOOM_LEVELS: ZoomLevel[] = ["day", "week", "month"];

export const ZOOM_LABELS: Record<ZoomLevel, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

export interface ZoomPreset {
  /** How many days the visible range spans. */
  rangeDays: number;
  /** Pixels per millisecond — the density of the time axis. */
  pxPerMs: number;
  /** Minor tick interval in ms (faint gridline + dense ticks). */
  minorTickMs: number;
  /** Major tick interval in ms (stronger gridline + label). */
  majorTickMs: number;
}

const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export const ZOOM_PRESETS: Record<ZoomLevel, ZoomPreset> = {
  // 1 day visible → 1920 px wide. Hourly major labels, 15-min minor
  // ticks for floor-level scheduling.
  day: {
    rangeDays: 1,
    pxPerMs: 1920 / MS_PER_DAY,
    minorTickMs: 15 * MS_PER_MIN,
    majorTickMs: MS_PER_HOUR,
  },
  // 14 days × 240 px/day = 3360 px wide. Two weeks of horizontal
  // scroll inside one view — feels like a continuous strip rather
  // than a single page. Day-level majors, 6-hour minors.
  week: {
    rangeDays: 14,
    pxPerMs: 240 / MS_PER_DAY,
    minorTickMs: 6 * MS_PER_HOUR,
    majorTickMs: MS_PER_DAY,
  },
  // 84 days (≈ 3 months) × 60 px/day = 5040 px wide. Wide enough
  // that horizontal scroll covers a whole quarter; week boundaries
  // are the natural major guides.
  month: {
    rangeDays: 84,
    pxPerMs: 60 / MS_PER_DAY,
    minorTickMs: MS_PER_DAY,
    majorTickMs: 7 * MS_PER_DAY,
  },
};

export interface TimeScale {
  zoom: ZoomLevel;
  rangeStart: Date;
  rangeEnd: Date;
  rangeMs: number;
  rangeWidthPx: number;
  preset: ZoomPreset;
  /** Position (in pixels from the left edge) of a UTC datetime. */
  pxAt: (iso: string | Date) => number;
}

export const ScheduleScaleContext = createContext<TimeScale | null>(null);

export function useTimeScale(): TimeScale {
  const ctx = useContext(ScheduleScaleContext);
  if (!ctx) {
    throw new Error(
      "useTimeScale must be used inside a <ScheduleScaleContext.Provider>",
    );
  }
  return ctx;
}

/** The valid drop window for the actively-dragged MO. null when
 *  nothing is being dragged or the drag has no chain constraints. */
export interface DragBounds {
  minStartMs: number;
  maxFinishMs: number | null;
}

export const DragBoundsContext = createContext<DragBounds | null>(null);

export function useDragBounds(): DragBounds | null {
  return useContext(DragBoundsContext);
}

/** Live walker-aware preview of where the currently-dragged block
 *  will land — recomputed on every pointermove by the workspace.
 *  Renders as a dashed ghost overlay in the calendar so the planner
 *  sees the actual drop position (respecting working hours) BEFORE
 *  they release the mouse. */
export interface LivePreview {
  rowMatcher: string;
  segments: Array<{ startMs: number; finishMs: number }>;
  outsideHoursSeconds: number;
}

export const LivePreviewContext = createContext<LivePreview | null>(null);

export function useLivePreview(): LivePreview | null {
  return useContext(LivePreviewContext);
}

/** Click-to-edit target dispatcher. Blocks call `openEditor` in
 *  their onClick handler; the workspace mounts the dialog once and
 *  picks up the target via state. Kept in a context so blocks don't
 *  need to be plumbed with the dialog's setter through every view. */
export type ScheduleEditTarget =
  | { kind: "project"; rootMoUuid: string }
  | { kind: "mo"; moUuid: string }
  | { kind: "step"; stepUuid: string };

export interface ScheduleEditDispatch {
  openEditor: (target: ScheduleEditTarget) => void;
}

export const ScheduleEditContext = createContext<ScheduleEditDispatch | null>(
  null,
);

export function useScheduleEditor(): ScheduleEditDispatch | null {
  return useContext(ScheduleEditContext);
}

/** The list of working intervals in the visible range — used by
 *  blocks to compute their own "paused" sub-segments (closed time
 *  that falls inside the block's span). */
export const WorkingIntervalsContext = createContext<
  Array<{ open: Date; close: Date }>
>([]);

export function useWorkingIntervals(): Array<{ open: Date; close: Date }> {
  return useContext(WorkingIntervalsContext);
}

/** Client-side mirror of Backend.Production.ScheduleWalker.walk_forward.
 *  Place `durationSeconds` of work starting at `cursorMs`, walking
 *  through `intervals` (sorted working windows). Steps spill into
 *  later windows when one isn't enough; if we run out of intervals
 *  the remainder lands as overflow (outsideHoursSeconds > 0).
 *
 *  Returned `start_at` is the first interval the work touches —
 *  may be later than `cursorMs` if the cursor lands in closed time
 *  and the walker had to push forward to the next window. */
export function walkForwardClient(
  intervals: Array<{ open: Date; close: Date }>,
  cursorMs: number,
  durationSeconds: number,
): {
  startAt: number;
  finishAt: number;
  segments: Array<{ open: number; close: number }>;
  outsideHoursSeconds: number;
} {
  if (durationSeconds <= 0) {
    return {
      startAt: cursorMs,
      finishAt: cursorMs,
      segments: [],
      outsideHoursSeconds: 0,
    };
  }

  const sorted = intervals
    .map((iv) => ({ open: iv.open.getTime(), close: iv.close.getTime() }))
    .sort((a, b) => a.open - b.open);

  let remainingMs = durationSeconds * 1000;
  let cursor = cursorMs;
  let startAt: number | null = null;
  const segments: Array<{ open: number; close: number }> = [];

  for (const w of sorted) {
    if (w.close <= cursor) continue;
    const effectiveStart = Math.max(w.open, cursor);
    const spanMs = w.close - effectiveStart;

    if (spanMs >= remainingMs) {
      const finish = effectiveStart + remainingMs;
      segments.push({ open: effectiveStart, close: finish });
      return {
        startAt: startAt ?? effectiveStart,
        finishAt: finish,
        segments,
        outsideHoursSeconds: 0,
      };
    }

    segments.push({ open: effectiveStart, close: w.close });
    remainingMs -= spanMs;
    cursor = w.close;
    if (startAt === null) startAt = effectiveStart;
  }

  // Overflow — no more intervals. Place the remainder at `cursor`.
  const overflowFinish = cursor + remainingMs;
  segments.push({ open: cursor, close: overflowFinish });
  return {
    startAt: startAt ?? cursor,
    finishAt: overflowFinish,
    segments,
    outsideHoursSeconds: remainingMs / 1000,
  };
}

/** Intersect a block's span [startMs, endMs] with the working
 *  intervals to find the CLOSED gaps inside it (overnight, weekend,
 *  holiday). Blocks render these as striped overlay strips so the
 *  user sees real work hours vs paused time. */
export function closedSegmentsWithin(
  startMs: number,
  endMs: number,
  intervals: Array<{ open: Date; close: Date }>,
): Array<{ start: number; end: number }> {
  if (endMs <= startMs) return [];
  const sorted = intervals
    .slice()
    .sort((a, b) => a.open.getTime() - b.open.getTime());

  const closed: Array<{ start: number; end: number }> = [];
  let cursor = startMs;
  for (const iv of sorted) {
    const ivOpen = iv.open.getTime();
    const ivClose = iv.close.getTime();
    if (ivClose <= cursor) continue;
    if (ivOpen >= endMs) break;
    if (ivOpen > cursor) {
      closed.push({
        start: cursor,
        end: Math.min(ivOpen, endMs),
      });
    }
    cursor = Math.max(cursor, ivClose);
    if (cursor >= endMs) return closed;
  }
  if (cursor < endMs) {
    closed.push({ start: cursor, end: endMs });
  }
  return closed;
}

export function startOfMondayUTC(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function startOfDayUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Compute the visible range from a chosen zoom + anchor date. The
 *  anchor is snapped to the appropriate boundary (start of day /
 *  Monday / 4-week block) so prev/next navigation lands on the same
 *  cadence. */
export function rangeForZoom(zoom: ZoomLevel, anchor: Date): {
  rangeStart: Date;
  rangeEnd: Date;
} {
  switch (zoom) {
    case "day": {
      const start = startOfDayUTC(anchor);
      return {
        rangeStart: start,
        rangeEnd: addDays(start, ZOOM_PRESETS.day.rangeDays),
      };
    }
    case "week": {
      // rangeDays MUST come from ZOOM_PRESETS so the API request,
      // the visible calendar width, and the navigation step all
      // agree. Hard-coded 7 here got out of sync after I bumped
      // the Week preset to 14 days, which silently truncated the
      // API to only one week even though the calendar rendered two.
      const start = startOfMondayUTC(anchor);
      return {
        rangeStart: start,
        rangeEnd: addDays(start, ZOOM_PRESETS.week.rangeDays),
      };
    }
    case "month": {
      const start = startOfMondayUTC(anchor);
      return {
        rangeStart: start,
        rangeEnd: addDays(start, ZOOM_PRESETS.month.rangeDays),
      };
    }
  }
}

export function buildTimeScale(zoom: ZoomLevel, rangeStart: Date): TimeScale {
  const preset = ZOOM_PRESETS[zoom];
  const rangeEnd = addDays(rangeStart, preset.rangeDays);
  const rangeMs = rangeEnd.getTime() - rangeStart.getTime();
  const rangeWidthPx = rangeMs * preset.pxPerMs;

  function pxAt(iso: string | Date): number {
    const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
    return (t - rangeStart.getTime()) * preset.pxPerMs;
  }

  return { zoom, rangeStart, rangeEnd, rangeMs, rangeWidthPx, preset, pxAt };
}

/** Inclusive day list across the range — useful for axes that need
 *  one cell per day. */
export function rangeDays(scale: TimeScale): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < scale.preset.rangeDays; i++) {
    days.push(addDays(scale.rangeStart, i));
  }
  return days;
}

export interface DayWindow {
  date: string;
  holiday_label: string | null;
  intervals: { open: string; close: string }[];
}

export function fmtRangeLabel(scale: TimeScale): string {
  const { zoom, rangeStart, rangeEnd } = scale;
  const endShown = new Date(rangeEnd.getTime() - 1);

  if (zoom === "day") {
    return rangeStart.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  const startFmt = rangeStart.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  const endFmt = endShown.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${startFmt} – ${endFmt}`;
}

export function dayLabel(
  date: Date,
  zoom: ZoomLevel,
): { primary: string; secondary?: string } {
  switch (zoom) {
    case "day":
      return {
        primary: date.toLocaleDateString(undefined, {
          weekday: "long",
        }),
        secondary: date.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
        }),
      };
    case "week":
      return {
        primary: date.toLocaleDateString(undefined, { weekday: "short" }),
        secondary: date.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
        }),
      };
    case "month":
      return {
        primary: date.toLocaleDateString(undefined, {
          day: "numeric",
        }),
        secondary: date.toLocaleDateString(undefined, {
          month: "short",
        }),
      };
  }
}

