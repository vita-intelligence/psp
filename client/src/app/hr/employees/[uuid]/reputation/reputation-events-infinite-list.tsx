"use client";

import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCompanyDate } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type {
  HREmployeeReputationEvent,
  ReputationEventType,
} from "@/lib/hr/types";
import type { TimelinePage } from "@/lib/hr/use-infinite-timeline";
import { useInfiniteTimeline } from "@/lib/hr/use-infinite-timeline";

interface Props {
  employeeUuid: string;
  initialItems: HREmployeeReputationEvent[];
  initialCursor: string | null;
}

const EVENT_LABEL: Record<ReputationEventType, string> = {
  auto_perf_excellent: "Excellent performance (auto)",
  auto_perf_high: "High performance (auto)",
  auto_perf_low: "Low performance (auto)",
  auto_perf_very_low: "Very low performance (auto)",
  manual_positive: "Positive recognition",
  manual_negative: "Negative incident",
};

function tone(delta: number): "emerald" | "rose" | "muted" {
  if (delta > 0) return "emerald";
  if (delta < 0) return "rose";
  return "muted";
}

async function fetchPage(
  employeeUuid: string,
  cursor: string,
): Promise<TimelinePage<HREmployeeReputationEvent>> {
  const params = new URLSearchParams({ limit: "50", cursor });
  const res = await fetch(
    `/api/hr/employees/${encodeURIComponent(
      employeeUuid,
    )}/reputation-events?${params.toString()}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`Failed to load page (${res.status})`);
  }
  const data: TimelinePage<HREmployeeReputationEvent> = await res.json();
  return {
    items: data.items ?? [],
    next_cursor: data.next_cursor ?? null,
  };
}

/**
 * Infinite-scroll list of reputation events for one employee. Row
 * markup mirrors `ReputationCard`'s inner rendering so the dedicated
 * page feels like a continuation, not a redesign. Pagination
 * mechanics live in the shared `useInfiniteTimeline` hook.
 */
export function ReputationEventsInfiniteList({
  employeeUuid,
  initialItems,
  initialCursor,
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
      <p className="rounded-md border border-dashed border-border/60 px-4 py-12 text-center text-sm text-muted-foreground">
        No reputation events recorded yet.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <ol className="relative space-y-4 border-l border-border/60 pl-6">
        {items.map((ev) => {
          const t = tone(ev.score_delta);
          return (
            <li key={ev.id} className="relative">
              <span
                aria-hidden
                className={`absolute -left-[26px] top-1.5 flex size-3 items-center justify-center rounded-full ring-4 ring-background ${
                  t === "emerald"
                    ? "bg-emerald-500"
                    : t === "rose"
                      ? "bg-rose-500"
                      : "bg-muted-foreground/50"
                }`}
              >
                {ev.score_delta > 0 ? (
                  <ThumbsUp className="size-2 text-white" />
                ) : ev.score_delta < 0 ? (
                  <ThumbsDown className="size-2 text-white" />
                ) : null}
              </span>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">
                    {EVENT_LABEL[ev.event_type] ?? ev.event_type}
                  </span>
                  <span
                    className={`font-mono text-sm ${
                      t === "emerald"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : t === "rose"
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-muted-foreground"
                    }`}
                  >
                    {ev.score_delta > 0 ? "+" : ""}
                    {ev.score_delta}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {formatCompanyDate(ev.inserted_at, prefs)}
                </span>
              </div>
              {ev.reason && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {ev.reason}
                </p>
              )}
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                {ev.session_external_id ? (
                  <>Session {ev.session_external_id}</>
                ) : ev.created_by_user ? (
                  <>Recorded by {ev.created_by_user.name}</>
                ) : null}
              </p>
            </li>
          );
        })}
      </ol>

      {/* Sentinel + status footer. The sentinel only renders while
          there's more to load; the footer stays put so the operator
          always sees where they are in the stream. */}
      {cursor !== null && (
        <div
          ref={sentinelRef}
          className="flex items-center justify-center py-6 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {loading && (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              Loading more…
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
