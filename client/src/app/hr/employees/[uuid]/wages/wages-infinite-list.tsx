"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCompanyDate, formatCompanyMoney } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type { HREmployeeWage } from "@/lib/hr/types";
import type { TimelinePage } from "@/lib/hr/use-infinite-timeline";
import { useInfiniteTimeline } from "@/lib/hr/use-infinite-timeline";

interface Props {
  employeeUuid: string;
  initialItems: HREmployeeWage[];
  initialCursor: string | null;
}

async function fetchPage(
  employeeUuid: string,
  cursor: string,
): Promise<TimelinePage<HREmployeeWage>> {
  const params = new URLSearchParams({ limit: "50", cursor });
  const res = await fetch(
    `/api/hr/employees/${encodeURIComponent(
      employeeUuid,
    )}/wages?${params.toString()}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`Failed to load page (${res.status})`);
  }
  const data: TimelinePage<HREmployeeWage> = await res.json();
  return {
    items: data.items ?? [],
    next_cursor: data.next_cursor ?? null,
  };
}

/**
 * Infinite-scroll wage history for one employee. Row markup mirrors
 * `WagesCard`'s inner rendering. Pagination lives in the shared
 * `useInfiniteTimeline` hook.
 */
export function WagesInfiniteList({
  employeeUuid,
  initialItems,
  initialCursor,
}: Props) {
  const prefs = useFormatPrefs();
  const { items, sentinelRef, loading, cursor, error, retry } =
    useInfiniteTimeline<HREmployeeWage>({
      initialItems,
      initialCursor,
      fetchPage: (c) => fetchPage(employeeUuid, c),
    });

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border/60 px-4 py-12 text-center text-sm text-muted-foreground">
        No wage history recorded yet.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <ol className="relative space-y-4 border-l border-border/60 pl-6">
        {items.map((w) => {
          const active = w.effective_to === null;
          return (
            <li key={w.id} className="relative">
              <span
                aria-hidden
                className={`absolute -left-[26px] top-1.5 flex size-3 items-center justify-center rounded-full ring-4 ring-background ${
                  active ? "bg-emerald-500" : "bg-muted-foreground/50"
                }`}
              />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-semibold">
                    {formatCompanyMoney(w.hourly_rate, {
                      ...prefs,
                      currency_code:
                        w.currency_code ?? prefs.currency_code,
                    })}
                  </span>
                  <span className="text-xs text-muted-foreground">/hour</span>
                  {active && (
                    <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                      Current
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {formatCompanyDate(w.effective_from, prefs)}
                  {w.effective_to && (
                    <>
                      <span aria-hidden> → </span>
                      {formatCompanyDate(w.effective_to, prefs)}
                    </>
                  )}
                </span>
              </div>
              {w.reason && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {w.reason}
                </p>
              )}
              {w.approved_by && (
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                  Approved by {w.approved_by.name}
                </p>
              )}
            </li>
          );
        })}
      </ol>

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
