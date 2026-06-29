"use client";

/**
 * Quick-schedule side panel. Opens between the Backlog rail and the
 * Gantt canvas when an operator clicks "Quick schedule" on a backlog
 * MO. Lets them type a start date + time and pick from the next 5
 * free windows on the MO's primary workstation, then fires the same
 * scheduleManufacturingOrderAction the drag-from-backlog path uses.
 *
 * No BE call for free slots — everything's derived client-side from
 * `data.working_windows` + `data.operations` already loaded for the
 * Gantt views.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { Calendar as CalendarIcon, Clock, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  BacklogMO,
  ProductionScheduleResponse,
} from "@/lib/production/types";
import {
  scheduleManufacturingOrderAction,
  scheduleProjectAction,
} from "@/lib/production/actions";

interface Props {
  mo: BacklogMO;
  /** True when this row is the root of a multi-MO project (has
   *  descendants in the backlog). Routes the action to
   *  scheduleProjectAction so the whole chain walks. */
  isProject: boolean;
  data: ProductionScheduleResponse;
  onClose: () => void;
  onScheduled: () => void;
}

interface FreeSlot {
  startMs: number;
  endMs: number;
}

export function QuickSchedulePanel({
  mo,
  isProject,
  data,
  onClose,
  onScheduled,
}: Props) {
  const primaryWsg = mo.steps_summary[0]?.workstation_group ?? null;
  const totalDurationSeconds = mo.planned_duration_seconds;

  const slots = useMemo(
    () =>
      primaryWsg
        ? computeFreeSlots(
            data,
            primaryWsg.id,
            totalDurationSeconds,
            5,
          )
        : [],
    [data, primaryWsg, totalDurationSeconds],
  );

  const initialDefault = slots[0]?.startMs ?? roundUpTo5Min(Date.now());
  const [dateStr, setDateStr] = useState(() => fmtDateInput(initialDefault));
  const [timeStr, setTimeStr] = useState(() => fmtTimeInput(initialDefault));
  const [pending, startTransition] = useTransition();

  // Lower bounds for the inputs — date can't be earlier than today,
  // and when the user has today selected, time can't be earlier than
  // the next 5-min slot after 'now'. Re-derived from a state ticker
  // so the bound moves forward as time passes.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const minDate = fmtDateInput(nowMs);
  const isToday = dateStr === minDate;
  const minTime = isToday ? fmtTimeInput(roundUpTo5Min(nowMs)) : "00:00";

  // Re-default the inputs when the panel opens for a new MO.
  useEffect(() => {
    const first = slots[0]?.startMs ?? roundUpTo5Min(Date.now());
    setDateStr(fmtDateInput(first));
    setTimeStr(fmtTimeInput(first));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mo.uuid]);

  function fillFromSlot(slot: FreeSlot) {
    setDateStr(fmtDateInput(slot.startMs));
    setTimeStr(fmtTimeInput(slot.startMs));
  }

  function handleSchedule() {
    if (!dateStr || !timeStr) {
      toast.error("Pick a start date and time first.");
      return;
    }
    let local = new Date(`${dateStr}T${timeStr}:00`);
    if (Number.isNaN(local.getTime())) {
      toast.error("Date / time format isn't valid.");
      return;
    }
    // Soft-clamp instead of error if the user typed a past time
    // manually (browsers don't always respect min on the inputs).
    if (local.getTime() < Date.now()) {
      local = new Date(roundUpTo5Min(Date.now()));
      setDateStr(fmtDateInput(local.getTime()));
      setTimeStr(fmtTimeInput(local.getTime()));
      toast.info("Snapped to the next 5-min slot — can't start in the past.");
    }
    startTransition(async () => {
      const res = isProject
        ? await scheduleProjectAction(mo.uuid, local.toISOString())
        : await scheduleManufacturingOrderAction(
            mo.uuid,
            local.toISOString(),
          );
      if (res.ok) {
        toast.success(
          isProject
            ? `Scheduled project ${mo.code ?? "MO"} for ${fmtSlot(local.getTime(), 0).timeLabel}`
            : `Scheduled ${mo.code ?? "MO"} for ${fmtSlot(local.getTime(), 0).timeLabel}`,
        );
        if (res.outsideHoursSeconds && res.outsideHoursSeconds > 0) {
          toast.info(
            `Walker bumped your start past ${Math.round(res.outsideHoursSeconds / 60)} min of closed hours.`,
          );
        }
        onScheduled();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-border/60 bg-card">
      <header className="flex items-start justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {mo.code ?? `MO #${mo.id}`}
          </p>
          <p className="truncate text-sm font-semibold">
            {mo.item?.name ?? "Unknown item"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {mo.quantity} ·{" "}
            <span className="font-medium text-foreground">
              {fmtDuration(totalDurationSeconds)}
            </span>{" "}
            ·{" "}
            <span
              className="font-medium"
              style={{ color: primaryWsg?.color ?? undefined }}
            >
              {primaryWsg?.name ?? "no workstation"}
            </span>
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="size-7 shrink-0"
          aria-label="Close quick-schedule panel"
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Type a start time */}
        <section className="space-y-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Type a start time
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <CalendarIcon className="size-3" />
                Date
              </span>
              <Input
                type="date"
                value={dateStr}
                min={minDate}
                onChange={(e) => setDateStr(e.target.value)}
                className="h-9 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="size-3" />
                Time
              </span>
              <Input
                type="time"
                value={timeStr}
                min={minTime}
                onChange={(e) => setTimeStr(e.target.value)}
                className="h-9 text-sm"
                step={300}
              />
            </label>
          </div>
        </section>

        {/* Free slot suggestions */}
        <section className="space-y-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {isProject ? (
              <>Free slots on the project's first step</>
            ) : (
              <>
                Free slots on{" "}
                <span className="font-medium text-foreground">
                  {primaryWsg?.name ?? "no workstation"}
                </span>
              </>
            )}
          </h3>
          {isProject && (
            <p className="text-[11px] text-muted-foreground">
              The walker cascades the chain from your start time — every
              child MO falls into place behind the first one.
            </p>
          )}
          {!primaryWsg ? (
            <div className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-[11px] text-muted-foreground">
              {isProject
                ? "The project root has no first-step workstation. Type a start time below — the walker will route each child MO via its routing."
                : "This MO's first step has no workstation assigned. Pick one in the BOM / routing first."}
            </div>
          ) : slots.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-[11px] text-muted-foreground">
              No working hours configured for this workstation in the
              next two weeks. Set up the working schedule for{" "}
              <span className="font-medium">{primaryWsg.name}</span>{" "}
              or type a start time manually below.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {slots.map((slot) => (
                <li key={slot.startMs}>
                  <button
                    type="button"
                    onClick={() => fillFromSlot(slot)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-left text-xs transition-colors",
                      "hover:border-brand/60 hover:bg-brand/10",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Sparkles className="size-3 text-amber-500" />
                      <span className="font-medium">
                        {fmtSlot(slot.startMs, slot.endMs).label}
                      </span>
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {fmtDuration((slot.endMs - slot.startMs) / 1000)} free
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="border-t border-border/60 p-3">
        <Button
          type="button"
          onClick={handleSchedule}
          disabled={pending || !dateStr || !timeStr}
          className="w-full"
        >
          {pending ? "Scheduling…" : "Schedule"}
        </Button>
      </footer>
    </aside>
  );
}

// ---------- Helpers ----------------------------------------------------

/**
 * Returns the first `limit` free starting points on the given
 * workstation group within the next ~2 weeks of working windows.
 *
 * Crucially this does NOT require the gap to fit the MO's full
 * duration — the walker spreads work across multiple working
 * windows automatically, so a 10-hour MO on an 8-hour working day
 * still has plenty of valid start times. Each suggestion is just:
 * 'here's a free open-window minute that isn't already occupied'.
 *
 * Minimum gap of 15 minutes so we don't spam the list with tiny
 * useless slivers between back-to-back ops.
 */
function computeFreeSlots(
  data: ProductionScheduleResponse,
  wsgId: number,
  _durationSeconds: number,
  limit: number,
): FreeSlot[] {
  const windowsGroup = data.working_windows.find((w) => w.group_id === wsgId);
  if (!windowsGroup) return [];

  const intervals: { startMs: number; endMs: number }[] = [];
  for (const day of windowsGroup.days) {
    for (const slot of day.intervals) {
      intervals.push({
        startMs: new Date(slot.open).getTime(),
        endMs: new Date(slot.close).getTime(),
      });
    }
  }
  intervals.sort((a, b) => a.startMs - b.startMs);

  const busy = data.operations
    .filter(
      (op) =>
        op.workstation_group_id === wsgId &&
        op.planned_start &&
        op.planned_finish,
    )
    .map((op) => ({
      startMs: new Date(op.planned_start!).getTime(),
      endMs: new Date(op.planned_finish!).getTime(),
    }))
    .sort((a, b) => a.startMs - b.startMs);

  const minStart = Date.now();
  const minGapMs = 15 * 60_000;
  const free: FreeSlot[] = [];

  for (const interval of intervals) {
    let cursor = Math.max(interval.startMs, minStart);
    if (cursor >= interval.endMs) continue;

    for (const b of busy) {
      if (b.endMs <= cursor) continue;
      if (b.startMs >= interval.endMs) break;
      const gapEnd = Math.min(b.startMs, interval.endMs);
      if (gapEnd - cursor >= minGapMs) {
        free.push({ startMs: cursor, endMs: gapEnd });
        if (free.length >= limit) return free;
      }
      cursor = Math.max(cursor, b.endMs);
      if (cursor >= interval.endMs) break;
    }
    if (interval.endMs - cursor >= minGapMs) {
      free.push({ startMs: cursor, endMs: interval.endMs });
      if (free.length >= limit) return free;
    }
  }

  return free;
}

function roundUpTo5Min(ms: number): number {
  const fiveMin = 5 * 60_000;
  return Math.ceil(ms / fiveMin) * fiveMin;
}

function fmtDateInput(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtTimeInput(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function fmtSlot(
  startMs: number,
  endMs: number,
): { label: string; timeLabel: string } {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const dayLabel = start.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const startTime = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
  const endTime = endMs
    ? ` – ${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`
    : "";
  return {
    label: `${dayLabel} ${startTime}${endTime}`,
    timeLabel: `${dayLabel} ${startTime}`,
  };
}
