"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, Radio } from "lucide-react";
import type { CompanyDefaults } from "@/lib/types";
import { formatCompanyDate } from "@/lib/format/company";
import { useEntityChannel } from "@/lib/realtime/use-entity-channel";
import { cn } from "@/lib/utils";
import type { COTimeBreakdown } from "@/lib/customer-orders/time";

/**
 * Wall-clock time so far — the wizard's "how long has this project
 * been alive" card. Companion to `<ProjectCostCard>`; identical
 * structural rhythm (big total, segmented bar, per-row breakdown,
 * live pill) but the numerator is seconds not money.
 *
 * Realtime strategy:
 *
 *   1. Subscribe to the `workstation_session_co` channel scoped to
 *      the CO UUID — same channel the sessions card uses. Any kiosk
 *      event bumps a `router.refresh()`, which re-runs the server
 *      component and threads a fresh snapshot in via `initial`.
 *   2. When any phase is still open (`is_live: true`), schedule a
 *      periodic `router.refresh()` every 30s so the current-phase
 *      duration ticks up visibly.
 */
export interface ProjectTimeCardProps {
  coUuid: string;
  initial: COTimeBreakdown | null;
  prefs: CompanyDefaults;
}

const PHASE_TONE: Record<COTimeBreakdown["phases"][number]["key"], string> = {
  setup: "bg-slate-400",
  approval: "bg-amber-400",
  preparing_production: "bg-indigo-400",
  in_production: "bg-emerald-500",
  post_production_pre_dispatch: "bg-cyan-400",
  awaiting_pickup: "bg-sky-400",
  dispatched: "bg-violet-500",
  delivered: "bg-primary",
  cancelled: "bg-destructive",
};

export function ProjectTimeCard({ coUuid, initial, prefs }: ProjectTimeCardProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<COTimeBreakdown | null>(initial);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setSnapshot(initial);
  }, [initial]);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  useEntityChannel({
    entity: "workstation_session_co",
    uuid: coUuid,
    onEvent: refresh,
  });

  const isLive = snapshot?.is_live ?? false;

  useEffect(() => {
    if (!isLive) return;
    const handle = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(handle);
  }, [isLive, refresh]);

  const phases = snapshot?.phases ?? [];
  const trackedPhases = useMemo(() => phases.filter((p) => p.is_tracked), [phases]);
  const totalSeconds = snapshot?.total_elapsed_seconds ?? 0;

  const trackedTotal = useMemo(
    () =>
      trackedPhases.reduce(
        (acc, p) => acc + (p.duration_seconds ?? 0),
        0,
      ),
    [trackedPhases],
  );

  if (!snapshot) return null;

  return (
    <section
      data-phase="production"
      className="rounded-lg border border-border/60 bg-card p-5 shadow-sm"
    >
      <header className="mb-4 flex items-start gap-2">
        <Clock className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight">
            Project time so far
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Wall-clock since the order was drafted, split by wizard
            phase. Ticks live while any phase is still open.
          </p>
        </div>
        {isLive && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-400"
            title="This project is still moving through its phases."
          >
            <Radio className="size-3 animate-pulse" aria-hidden />
            live
          </span>
        )}
      </header>

      <div className="space-y-1">
        <div className="text-3xl font-semibold tracking-tight tabular-nums">
          {formatDurationLong(totalSeconds)}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Since{" "}
          <span className="font-medium text-foreground">
            {formatCompanyDate(snapshot.started_at, prefs)}
          </span>
          {snapshot.labour_seconds > 0 && (
            <>
              {" "}·{" "}
              <span className="font-medium text-foreground">
                {formatDurationShort(snapshot.labour_seconds)}
              </span>{" "}
              of active labour across{" "}
              <span className="font-medium text-foreground">
                {snapshot.session_count}
              </span>{" "}
              session{snapshot.session_count === 1 ? "" : "s"}
              {snapshot.active_session_count > 0 && (
                <>
                  {" "}
                  ({snapshot.active_session_count} running)
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Segmented bar — proportional to the tracked total (not the
          wall-clock total: the elapsed time may include gaps between
          phases where nothing was tracked, so the bar segments would
          be sparse if we used the wall-clock denominator). */}
      {trackedTotal > 0 && (
        <div className="mt-4">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
            {trackedPhases.map((p) => {
              const share = ((p.duration_seconds ?? 0) / trackedTotal) * 100;
              if (share <= 0) return null;
              return (
                <div
                  key={p.key}
                  className={cn(PHASE_TONE[p.key])}
                  style={{ width: `${share}%` }}
                  aria-label={`${p.label} ${share.toFixed(0)}%`}
                />
              );
            })}
          </div>
        </div>
      )}

      <ul className="mt-4 space-y-2 text-xs">
        {phases.map((p) => (
          <PhaseRow
            key={p.key}
            swatch={PHASE_TONE[p.key]}
            label={p.label}
            durationSeconds={p.duration_seconds}
            isCurrent={p.is_current}
            isTracked={p.is_tracked}
            trackedTotal={trackedTotal}
          />
        ))}
      </ul>
    </section>
  );
}

function PhaseRow({
  swatch,
  label,
  durationSeconds,
  isCurrent,
  isTracked,
  trackedTotal,
}: {
  swatch: string;
  label: string;
  durationSeconds: number | null;
  isCurrent: boolean;
  isTracked: boolean;
  trackedTotal: number;
}) {
  const share =
    isTracked && durationSeconds != null && trackedTotal > 0
      ? (durationSeconds / trackedTotal) * 100
      : 0;

  return (
    <li className="flex items-center gap-3">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          isTracked ? swatch : "bg-muted-foreground/30",
        )}
        aria-hidden
      />
      <span
        className={cn(
          "text-muted-foreground",
          isCurrent && "font-medium text-foreground",
        )}
      >
        {label}
        {isCurrent && (
          <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400">
            current
          </span>
        )}
      </span>
      <span className="ml-auto font-semibold tabular-nums">
        {isTracked && durationSeconds != null
          ? formatDurationShort(durationSeconds)
          : "—"}
      </span>
      <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">
        {isTracked && share > 0 ? `${share.toFixed(0)}%` : "—"}
      </span>
    </li>
  );
}

// ---------- duration formatting ----------
//
// Two flavours. `Long` shows "3d 4h 12m" — the big top number. `Short`
// shows the same for phase rows. Both are locale-agnostic per the
// CLAUDE.md rendering rule.

function formatDurationLong(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0m";
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (days === 0 && minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) {
    // Less than a minute total.
    return `${totalSeconds}s`;
  }
  return parts.join(" ");
}

function formatDurationShort(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0m";
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}
