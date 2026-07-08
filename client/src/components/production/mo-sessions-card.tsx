"use client";

import { Activity } from "lucide-react";
import { useEntityChannel } from "@/lib/realtime/use-entity-channel";
import type { CompanyDefaults } from "@/lib/types";
import type { WorkstationSessionRow } from "@/lib/production/sessions";
import { SessionsTimeline } from "./sessions-timeline";

interface MOSessionsCardProps {
    moUuid: string;
    /** Server-fetched initial rows. Each realtime broadcast triggers
     *  a `router.refresh()` which re-fetches this prop from the
     *  server component that owns the page. Because the page is
     *  `force-dynamic`, the round-trip is fast and idempotent. */
    initialSessions: WorkstationSessionRow[];
    prefs: CompanyDefaults;
}

/**
 * "Production sessions" card for the MO detail page.
 *
 * Subscribes to `entity:workstation_session_mo:<company>:<mo_uuid>`
 * — the topic PSP broadcasts to on every kiosk writeback for a
 * session belonging to this MO. Debounced 250 ms so a burst of
 * simultaneous kiosks doesn't hammer the router.
 */
export function MOSessionsCard({
    moUuid,
    initialSessions,
    prefs,
}: MOSessionsCardProps) {
    useEntityChannel({
        entity: "workstation_session_mo",
        uuid: moUuid,
    });

    const running = initialSessions.filter((s) => s.status === "active").length;

    return (
        <section
            className="rounded-lg border border-border/60 bg-card p-5 shadow-sm"
            aria-label="Production sessions timeline"
        >
            <header className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Activity className="size-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold tracking-tight">
                        Production sessions
                    </h2>
                    <span className="text-xs text-muted-foreground">
                        · {initialSessions.length} total
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
            </header>

            <SessionsTimeline sessions={initialSessions} prefs={prefs} />
        </section>
    );
}
