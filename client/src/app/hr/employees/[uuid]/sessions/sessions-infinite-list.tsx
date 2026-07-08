"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import { SessionsTimeline } from "@/components/production/sessions-timeline";
import type { CompanyDefaults } from "@/lib/types";
import type { WorkstationSessionRow } from "@/lib/production/sessions";
import type { TimelinePage } from "@/lib/hr/use-infinite-timeline";
import { useInfiniteTimeline } from "@/lib/hr/use-infinite-timeline";

interface Props {
  employeeUuid: string;
  initialItems: WorkstationSessionRow[];
  initialCursor: string | null;
}

async function fetchPage(
  employeeUuid: string,
  cursor: string,
): Promise<TimelinePage<WorkstationSessionRow>> {
  const params = new URLSearchParams({ limit: "50", cursor });
  const res = await fetch(
    `/api/hr/employees/${encodeURIComponent(
      employeeUuid,
    )}/sessions?${params.toString()}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`Failed to load page (${res.status})`);
  }
  // Sessions envelope from the same-origin proxy comes back as
  // `{ sessions: [...], next_cursor }` (the FE-side proxy forwards
  // Phoenix's shape verbatim). Normalise to the shared TimelinePage
  // shape the hook expects.
  const data = (await res.json()) as {
    sessions?: WorkstationSessionRow[];
    items?: WorkstationSessionRow[];
    next_cursor: string | null;
  };
  return {
    items: data.sessions ?? data.items ?? [],
    next_cursor: data.next_cursor ?? null,
  };
}

/**
 * Infinite-scroll workstation-sessions history for one employee.
 * Wraps `<SessionsTimeline>` so the row visual matches every other
 * sessions-showing surface (MO detail, CO wizard). Pagination lives
 * in the shared `useInfiniteTimeline` hook.
 */
export function SessionsInfiniteList({
  employeeUuid,
  initialItems,
  initialCursor,
}: Props) {
  const prefs = useFormatPrefs() as CompanyDefaults;
  const { items, sentinelRef, loading, cursor, error, retry } =
    useInfiniteTimeline<WorkstationSessionRow>({
      initialItems,
      initialCursor,
      fetchPage: (c) => fetchPage(employeeUuid, c),
    });

  return (
    <div className="space-y-6">
      <SessionsTimeline sessions={items} prefs={prefs} showMOContext />

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
      {cursor === null && items.length > 0 && (
        <p className="border-t border-border/60 pt-4 text-center text-[11px] text-muted-foreground">
          End of history · {items.length} total
        </p>
      )}
    </div>
  );
}
