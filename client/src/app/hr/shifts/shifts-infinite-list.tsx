"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LiveTimer } from "@/components/production/live-timer";
import { formatCompanyDate } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type { HREmployeeShift } from "@/lib/hr/types";
import type { TimelinePage } from "@/lib/hr/use-infinite-timeline";
import { useInfiniteTimeline } from "@/lib/hr/use-infinite-timeline";

interface Props {
  initialItems: HREmployeeShift[];
  initialCursor: string | null;
  employeeUuid: string | null;
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

async function fetchPage(
  employeeUuid: string | null,
  cursor: string,
): Promise<TimelinePage<HREmployeeShift>> {
  const params = new URLSearchParams({ limit: "50", cursor });
  if (employeeUuid) params.set("employee_uuid", employeeUuid);
  const res = await fetch(`/api/hr/shifts?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load page (${res.status})`);
  return (await res.json()) as TimelinePage<HREmployeeShift>;
}

export function ShiftsInfiniteList({
  initialItems,
  initialCursor,
  employeeUuid,
}: Props) {
  const prefs = useFormatPrefs();
  const { items, sentinelRef, loading, cursor, error, retry } =
    useInfiniteTimeline<HREmployeeShift>({
      initialItems,
      initialCursor,
      fetchPage: (c) => fetchPage(employeeUuid, c),
    });

  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        No shifts have been logged
        {employeeUuid ? " for this worker" : " yet"}.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="py-2 pr-3 font-semibold">Employee</th>
              <th className="py-2 pr-3 font-semibold">Date</th>
              <th className="py-2 pr-3 font-semibold">Clock in</th>
              <th className="py-2 pr-3 font-semibold">Clock out</th>
              <th className="py-2 pr-3 font-semibold">Duration</th>
              <th className="py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {items.map((s) => {
              const open = s.ended_at === null;
              const name = s.employee?.name ?? "—";
              const href = s.employee ? `/hr/employees/${s.employee.uuid}` : null;
              return (
                <tr key={s.uuid}>
                  <td className="py-2 pr-3">
                    {href ? (
                      <Link
                        href={href}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      <span className="font-medium">{name}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {formatCompanyDate(s.started_at, prefs)}
                  </td>
                  <td className="py-2 pr-3 font-mono tabular-nums">
                    {formatClock(s.started_at)}
                  </td>
                  <td className="py-2 pr-3 font-mono tabular-nums">
                    {open ? "—" : formatClock(s.ended_at)}
                  </td>
                  <td className="py-2 pr-3 font-mono tabular-nums">
                    {open ? (
                      <LiveTimer
                        startedAt={s.started_at}
                        finishedAt={s.ended_at}
                      />
                    ) : (
                      formatDurationSeconds(s.duration_seconds)
                    )}
                  </td>
                  <td className="py-2">
                    {open ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                        <span
                          className="size-1.5 animate-pulse rounded-full bg-emerald-500"
                          aria-hidden
                        />
                        Running
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Completed
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {cursor !== null && (
        <div
          ref={sentinelRef}
          className="flex items-center justify-center py-4 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {loading && (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" aria-hidden /> Loading
              more…
            </span>
          )}
          {!loading && error && (
            <span className="inline-flex items-center gap-3">
              <span className="text-red-600 dark:text-red-400">{error}</span>
              <Button size="sm" variant="outline" onClick={retry}>
                Retry
              </Button>
            </span>
          )}
        </div>
      )}
      {cursor === null && (
        <p className="border-t border-border/60 pt-4 text-center text-[11px] text-muted-foreground">
          End of history · {items.length} total
        </p>
      )}
    </div>
  );
}
