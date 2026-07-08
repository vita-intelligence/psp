"use client";

import Link from "next/link";
import { Activity } from "lucide-react";
import { useEntityChannel } from "@/lib/realtime/use-entity-channel";
import type { CompanyDefaults } from "@/lib/types";
import type { WorkstationSessionRow } from "@/lib/production/sessions";
import { SessionsTimeline } from "@/components/production/sessions-timeline";

interface EmployeeSessionsCardProps {
  employeeUuid: string;
  /** Server-fetched initial rows. A `router.refresh()` fires on every
   *  realtime broadcast so this prop stays fresh without the client
   *  re-fetching. */
  initialSessions: WorkstationSessionRow[];
  prefs: CompanyDefaults;
  /** If set, a subtle "View all →" link renders in the card header
   *  pointing at the dedicated infinite-scroll page. The parent only
   *  passes this when the server reported `next_cursor !== null`. */
  viewAllHref?: string;
}

/**
 * "Sessions" card for the HR employee profile.
 *
 * There is no per-employee session topic in PSP today — sessions are
 * broadcast per-MO and per-workstation. The company-scoped
 * `entity:workstation_session:<company>` topic is a superset: every
 * writeback for any session inside the tenant hits it. The
 * `router.refresh()` on that event re-runs the server component and
 * we get an updated `initialSessions` slice back for this one
 * employee. Debounced 250 ms upstream so bursts collapse to one
 * round-trip. When a per-employee topic exists, swap the `entity`
 * string here — nothing else changes.
 */
export function EmployeeSessionsCard({
  employeeUuid,
  initialSessions,
  prefs,
  viewAllHref,
}: EmployeeSessionsCardProps) {
  useEntityChannel({ entity: "workstation_session", uuid: undefined });

  const running = initialSessions.filter((s) => s.status === "active").length;

  return (
    <section
      className="rounded-lg border border-border/60 bg-card p-5 shadow-sm"
      aria-label={`Workstation sessions for employee ${employeeUuid}`}
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Sessions</h2>
          <span className="text-xs text-muted-foreground">
            {/* "N total" would lie when we're only rendering the top 5.
                Show "recent" instead — the total lives on the dedicated
                "View all" page's end-of-history line. */}
            · {initialSessions.length} shown
            {running > 0 && (
              <>
                {" "}·{" "}
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {running} running
                </span>
              </>
            )}
          </span>
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            View all →
          </Link>
        )}
      </header>

      <SessionsTimeline
        sessions={initialSessions}
        prefs={prefs}
        showMOContext
      />
    </section>
  );
}
