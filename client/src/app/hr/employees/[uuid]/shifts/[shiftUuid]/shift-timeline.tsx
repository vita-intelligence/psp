"use client";

import { LiveTimer } from "@/components/production/live-timer";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import type {
  ShiftActivityKind,
  ShiftDetail,
  ShiftDetailSession,
} from "@/lib/hr/types";

/** Copy per activity kind — matches the labels in ``page.tsx``. */
const ACTIVITY_LABEL: Record<ShiftActivityKind, string> = {
  mo: "Production",
  cleaning: "Cleaning",
  maintenance: "Maintenance",
  other: "Other",
};

/** Colour tokens per activity kind — same set as ``page.tsx``. Kept
 *  local so the timeline component can render standalone. */
const ACTIVITY_DOT: Record<ShiftActivityKind, string> = {
  mo: "bg-sky-500 ring-sky-500/30",
  cleaning: "bg-amber-500 ring-amber-500/30",
  maintenance: "bg-violet-500 ring-violet-500/30",
  other: "bg-slate-400 ring-slate-500/30",
};

function formatClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 0) return "—";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${rem}s`;
  return `${s}s`;
}

/** Only surface gaps that break past a floor — 30-second stretches
 *  aren't "idle", they're the operator swapping between two stations.
 *  Everything above is a real hole in the shift worth showing. */
const IDLE_GAP_FLOOR_SECONDS = 60;

type TimelineRow =
  | { kind: "session"; session: ShiftDetailSession; startMs: number }
  | { kind: "idle"; seconds: number; startMs: number };

function buildRows(detail: ShiftDetail): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const sessions = detail.sessions;
  const clockedInMs = detail.shift.clocked_in_at
    ? new Date(detail.shift.clocked_in_at).getTime()
    : null;
  const clockedOutMs = detail.shift.clocked_out_at
    ? new Date(detail.shift.clocked_out_at).getTime()
    : Date.now();

  if (sessions.length === 0) {
    // No sessions at all — one big idle from clock-in to now (or
    // clock-out). Skipped when the shift itself is empty/invalid.
    if (clockedInMs !== null) {
      const total = Math.max(0, (clockedOutMs - clockedInMs) / 1000);
      if (total >= IDLE_GAP_FLOOR_SECONDS) {
        rows.push({ kind: "idle", seconds: total, startMs: clockedInMs });
      }
    }
    return rows;
  }

  // Leading idle — clock-in → first session start.
  const firstStartMs = sessions[0].start_time
    ? new Date(sessions[0].start_time).getTime()
    : null;
  if (clockedInMs !== null && firstStartMs !== null) {
    const gap = (firstStartMs - clockedInMs) / 1000;
    if (gap >= IDLE_GAP_FLOOR_SECONDS) {
      rows.push({ kind: "idle", seconds: gap, startMs: clockedInMs });
    }
  }

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const startMs = s.start_time ? new Date(s.start_time).getTime() : 0;
    rows.push({ kind: "session", session: s, startMs });

    const endMs = s.end_time
      ? new Date(s.end_time).getTime()
      : clockedOutMs;
    const next = sessions[i + 1];
    if (next && next.start_time) {
      const nextStartMs = new Date(next.start_time).getTime();
      const gap = (nextStartMs - endMs) / 1000;
      if (gap >= IDLE_GAP_FLOOR_SECONDS) {
        rows.push({ kind: "idle", seconds: gap, startMs: endMs });
      }
    }
  }

  // Trailing idle — last session end → clock-out (if closed).
  const last = sessions[sessions.length - 1];
  const lastEndMs = last.end_time ? new Date(last.end_time).getTime() : null;
  if (
    detail.shift.clocked_out_at &&
    lastEndMs !== null &&
    clockedOutMs > lastEndMs
  ) {
    const gap = (clockedOutMs - lastEndMs) / 1000;
    if (gap >= IDLE_GAP_FLOOR_SECONDS) {
      rows.push({ kind: "idle", seconds: gap, startMs: lastEndMs });
    }
  }

  return rows;
}

interface Props {
  detail: ShiftDetail;
  prefs: FormatPrefs | null;
}

/**
 * Vertical event-list timeline. Each session is one row with the
 * activity-kind dot, the workstation + item label, and the duration
 * on the right. Idle gaps > ``IDLE_GAP_FLOOR_SECONDS`` are inserted
 * between sessions as thin muted rows so the operator can see where
 * the worker went dark.
 *
 * The vertical rail on the left is drawn once behind the whole list
 * — dots ride on top so they read like a subway line.
 */
export function ShiftTimeline({ detail, prefs: _prefs }: Props) {
  const rows = buildRows(detail);

  if (rows.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        No sessions recorded on this shift.
      </p>
    );
  }

  return (
    <ol className="relative space-y-3 pl-6">
      <span
        className="absolute left-2 top-2 bottom-2 w-px bg-border/60"
        aria-hidden
      />
      {rows.map((row, idx) => {
        if (row.kind === "idle") {
          return (
            <li key={`idle-${idx}-${row.startMs}`} className="relative">
              <span
                className="absolute -left-4 top-1/2 size-2 -translate-y-1/2 rounded-full border border-border/60 bg-background"
                aria-hidden
              />
              <div className="flex items-baseline justify-between gap-3 border-y border-dashed border-border/40 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                <span>Idle · from {formatClock(new Date(row.startMs).toISOString())}</span>
                <span className="font-mono tabular-nums">
                  {formatDuration(row.seconds)}
                </span>
              </div>
            </li>
          );
        }
        return (
          <SessionRow
            key={`sess-${row.session.id}`}
            session={row.session}
          />
        );
      })}
    </ol>
  );
}

function SessionRow({ session }: { session: ShiftDetailSession }) {
  const cls = ACTIVITY_DOT[session.activity_kind] ?? ACTIVITY_DOT.other;
  const running = session.status === "active" && !session.end_time;

  const producedNum = session.quantity_produced
    ? Number.parseFloat(session.quantity_produced)
    : null;
  const rejectedNum = session.quantity_rejected
    ? Number.parseFloat(session.quantity_rejected)
    : null;
  const showQty =
    session.activity_kind === "mo" &&
    ((producedNum !== null && !Number.isNaN(producedNum) && producedNum > 0) ||
      (rejectedNum !== null && !Number.isNaN(rejectedNum) && rejectedNum > 0));

  return (
    <li className="relative">
      <span
        className={`absolute -left-[18px] top-2 size-3 rounded-full ring-4 ${cls}`}
        aria-hidden
      />
      <div className="rounded-md border border-border/60 bg-background/60 px-3 py-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {ACTIVITY_LABEL[session.activity_kind]}
              </span>
              {running && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  <span
                    className="size-1 animate-pulse rounded-full bg-emerald-500"
                    aria-hidden
                  />
                  Running
                </span>
              )}
              {session.status === "completed" && (
                <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Completed
                </span>
              )}
            </div>
            <div className="text-xs font-medium">
              {session.activity_label || "—"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {session.workstation_name ?? "Unknown station"}
              {session.item_name && session.item_name !== session.activity_label
                ? ` · ${session.item_name}`
                : ""}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {formatClock(session.start_time)}
              {" → "}
              {running ? "now" : formatClock(session.end_time)}
            </div>
            <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums">
              {running ? (
                <LiveTimer
                  startedAt={session.start_time ?? new Date().toISOString()}
                  finishedAt={null}
                />
              ) : (
                formatDuration(session.duration_seconds)
              )}
            </div>
          </div>
        </div>
        {(showQty || typeof session.performance_percentage === "number") && (
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
            {showQty && (
              <span>
                Produced{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {session.quantity_produced}
                </span>
                {rejectedNum && rejectedNum > 0 ? (
                  <>
                    {" · rejected "}
                    <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400">
                      {session.quantity_rejected}
                    </span>
                  </>
                ) : null}
              </span>
            )}
            {typeof session.performance_percentage === "number" && (
              <span>
                Performance{" "}
                <span
                  className={
                    session.performance_percentage >= 100
                      ? "font-mono tabular-nums text-emerald-600 dark:text-emerald-400"
                      : session.performance_percentage >= 70
                        ? "font-mono tabular-nums text-foreground"
                        : "font-mono tabular-nums text-amber-600 dark:text-amber-400"
                  }
                >
                  {Math.round(session.performance_percentage)}%
                </span>
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
