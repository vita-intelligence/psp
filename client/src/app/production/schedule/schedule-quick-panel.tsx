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
import { scheduleManufacturingOrderAction } from "@/lib/production/actions";

interface Props {
  mo: BacklogMO;
  data: ProductionScheduleResponse;
  onClose: () => void;
  onScheduled: () => void;
}

interface FreeSlot {
  startMs: number;
  endMs: number;
}

export function QuickSchedulePanel({ mo, data, onClose, onScheduled }: Props) {
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
    const local = new Date(`${dateStr}T${timeStr}:00`);
    if (Number.isNaN(local.getTime())) {
      toast.error("Date / time format isn't valid.");
      return;
    }
    if (local.getTime() < Date.now() - 60_000) {
      toast.error("Pick a time in the future.");
      return;
    }
    startTransition(async () => {
      const res = await scheduleManufacturingOrderAction(
        mo.uuid,
        local.toISOString(),
      );
      if (res.ok) {
        toast.success(`Scheduled ${mo.code ?? "MO"} for ${fmtSlot(local.getTime(), 0).timeLabel}`);
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
            Free slots on{" "}
            <span className="font-medium text-foreground">
              {primaryWsg?.name ?? "no workstation"}
            </span>
          </h3>
          {!primaryWsg ? (
            <div className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-[11px] text-muted-foreground">
              This MO's first step has no workstation assigned. Pick one
              in the BOM / routing first.
            </div>
          ) : slots.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-[11px] text-muted-foreground">
              No free window long enough in the next two weeks. Either
              shorten the MO, reassign its workstation, or extend working
              hours.
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
 * Returns the first `limit` free time windows on the given workstation
 * group that are at least `durationSeconds` long. Walks every working
 * interval the BE sent down and subtracts every op already on that
 * WSG. Only future windows (>= now) are considered.
 */
function computeFreeSlots(
  data: ProductionScheduleResponse,
  wsgId: number,
  durationSeconds: number,
  limit: number,
): FreeSlot[] {
  if (durationSeconds <= 0) return [];

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
  const durationMs = durationSeconds * 1000;
  const free: FreeSlot[] = [];

  for (const interval of intervals) {
    let cursor = Math.max(interval.startMs, minStart);
    if (cursor >= interval.endMs) continue;

    for (const b of busy) {
      if (b.endMs <= cursor) continue;
      if (b.startMs >= interval.endMs) break;
      const gapEnd = Math.min(b.startMs, interval.endMs);
      if (gapEnd - cursor >= durationMs) {
        free.push({ startMs: cursor, endMs: gapEnd });
        if (free.length >= limit) return free;
      }
      cursor = Math.max(cursor, b.endMs);
      if (cursor >= interval.endMs) break;
    }
    if (interval.endMs - cursor >= durationMs) {
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
