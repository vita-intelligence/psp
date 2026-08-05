"use client";

import { CalendarDays } from "lucide-react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCompanyDate } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type { HREmployeeShift } from "@/lib/hr/types";
import { LiveTimer } from "@/components/production/live-timer";

interface Props {
  initial: HREmployeeShift[];
  /** Optional "View all →" link when the backend indicated more rows
   *  exist beyond the sidebar preview. */
  viewAllHref?: string;
}

function formatClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDurationSeconds(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "—";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/**
 * Clock-in / clock-out history sidebar card. Rows are mirrored from
 * vita-performance's personal kiosk — vp pushes each shift on close.
 * Open shifts show a live-updating timer so a supervisor viewing the
 * profile mid-shift sees the running counter tick up.
 */
export function ShiftsCard({ initial, viewAllHref }: Props) {
  const prefs = useFormatPrefs();

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="size-4 text-muted-foreground" />
              Shift history
            </CardTitle>
            <CardDescription>
              Kiosk clock-in / clock-out windows synced from
              vita-performance. Open shifts show a live counter.
            </CardDescription>
          </div>
          {viewAllHref && (
            <Link
              href={viewAllHref}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              View all →
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {initial.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No shifts logged yet — this worker hasn&apos;t clocked in at the
            kiosk.
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {initial.map((s) => {
              const open = s.ended_at === null;
              return (
                <li key={s.uuid} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-medium">
                      {formatCompanyDate(s.started_at, prefs)}
                    </span>
                    <span
                      className={
                        open
                          ? "inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400"
                          : "text-[10px] font-medium text-muted-foreground"
                      }
                    >
                      {open ? (
                        <>
                          <span
                            className="size-1.5 animate-pulse rounded-full bg-emerald-500"
                            aria-hidden
                          />
                          Running
                        </>
                      ) : (
                        "Completed"
                      )}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>
                      {formatClock(s.started_at)}
                      {" → "}
                      {open ? "now" : formatClock(s.ended_at)}
                    </span>
                    {open ? (
                      <LiveTimer
                        startedAt={s.started_at}
                        finishedAt={s.ended_at}
                        className="text-[11px] font-medium tabular-nums text-foreground"
                      />
                    ) : (
                      <span className="font-mono tabular-nums">
                        {formatDurationSeconds(s.duration_seconds)}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
