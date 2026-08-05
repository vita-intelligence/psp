"use client";

import Link from "next/link";
import { Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCompanyDate } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import { cn } from "@/lib/utils";
import type {
  HREmployeeReputationEvent,
  ReputationEventType,
} from "@/lib/hr/types";
import type { TimelinePage } from "@/lib/hr/use-infinite-timeline";
import { useInfiniteTimeline } from "@/lib/hr/use-infinite-timeline";

interface Props {
  initialItems: HREmployeeReputationEvent[];
  initialCursor: string | null;
  employeeUuid: string | null;
}

const KIND_LABEL: Record<ReputationEventType, string> = {
  auto_perf_excellent: "Auto · Excellent",
  auto_perf_high: "Auto · High",
  auto_perf_low: "Auto · Low",
  auto_perf_very_low: "Auto · Very low",
  manual_positive: "Manual · Positive",
  manual_negative: "Manual · Negative",
};

async function fetchPage(
  employeeUuid: string | null,
  cursor: string,
): Promise<TimelinePage<HREmployeeReputationEvent>> {
  const params = new URLSearchParams({ limit: "50", cursor });
  if (employeeUuid) params.set("employee_uuid", employeeUuid);
  const res = await fetch(`/api/hr/reputation-events?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load page (${res.status})`);
  return (await res.json()) as TimelinePage<HREmployeeReputationEvent>;
}

export function ReputationInfiniteList({
  initialItems,
  initialCursor,
  employeeUuid,
}: Props) {
  const prefs = useFormatPrefs();
  const { items, sentinelRef, loading, cursor, error, retry } =
    useInfiniteTimeline<HREmployeeReputationEvent>({
      initialItems,
      initialCursor,
      fetchPage: (c) => fetchPage(employeeUuid, c),
    });

  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        No reputation events
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
              <th className="py-2 pr-3 font-semibold">When</th>
              <th className="py-2 pr-3 font-semibold">Event</th>
              <th className="py-2 pr-3 font-semibold">Delta</th>
              <th className="py-2 pr-3 font-semibold">Reason</th>
              <th className="py-2 font-semibold">By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {items.map((ev) => {
              const name = ev.employee?.name ?? "—";
              const href = ev.employee ? `/hr/employees/${ev.employee.uuid}` : null;
              const positive = ev.score_delta >= 0;
              const Icon = positive ? TrendingUp : TrendingDown;
              const author =
                ev.created_by_user?.name ??
                ev.created_by_employee?.name ??
                "System";
              return (
                <tr key={ev.uuid}>
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
                    {formatCompanyDate(ev.inserted_at, prefs)}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {KIND_LABEL[ev.event_type] ?? ev.event_type}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 font-mono tabular-nums",
                        positive
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-red-700 dark:text-red-400",
                      )}
                    >
                      <Icon className="size-3" aria-hidden />
                      {positive ? "+" : ""}
                      {ev.score_delta}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {ev.reason ? (
                      <span className="line-clamp-2">{ev.reason}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 text-muted-foreground">{author}</td>
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
