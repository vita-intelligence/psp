"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEntityChannel } from "@/lib/realtime/use-entity-channel";
import type { MyTasksCount } from "@/lib/my-tasks/types";

interface Props {
  className?: string;
}

// Minimum interval between count refreshes — collapses bursts of CO
// broadcasts into a single fetch, so a bulk import doesn't fire N
// count queries in a heartbeat.
const REFRESH_MIN_MS = 5000;

/** Top-bar "My tasks" pill with a live count of overdue tasks.
 *
 * Client-side because the count needs to reflect peer writes without
 * a full page reload. Hits `/api/my-tasks/count` (a lean summary
 * endpoint, not the full task list) on mount and whenever a peer
 * writes a CO — throttled to at most one fetch per `REFRESH_MIN_MS`
 * so a bulk import doesn't hammer the pipe.
 *
 * Hidden entirely when the user has zero tasks so it doesn't shout
 * about a feature they aren't using. */
export function MyTasksNavLink({ className }: Props) {
  const [count, setCount] = useState<number | null>(null);
  const [overdue, setOverdue] = useState(0);

  // Throttle state — refuse to fire more than once per REFRESH_MIN_MS.
  const lastFetchRef = useRef(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFetch = useCallback(async () => {
    lastFetchRef.current = Date.now();
    try {
      const res = await fetch("/api/my-tasks/count", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as MyTasksCount;
      setCount(body.total);
      setOverdue(body.overdue);
    } catch {
      // Silent — the badge is best-effort. The dedicated page will
      // surface the real state.
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    const elapsed = Date.now() - lastFetchRef.current;
    if (elapsed >= REFRESH_MIN_MS) {
      void doFetch();
      return;
    }
    // Another refresh is already queued — let it fire.
    if (pendingRef.current) return;
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null;
      void doFetch();
    }, REFRESH_MIN_MS - elapsed);
  }, [doFetch]);

  useEffect(() => {
    void doFetch();
    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
  }, [doFetch]);

  useEntityChannel({
    entity: "customer-order",
    onEvent: () => scheduleRefresh(),
  });

  // Hide the link when there's genuinely nothing to do — no CTA
  // clutter in the header for users who don't own any of these
  // actions. Once at least one task exists it stays visible so
  // the operator can drill in from any page.
  if (count === 0) return null;

  return (
    <Link
      href="/my-tasks"
      className={cn(
        "relative inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60 focus-visible:outline-hidden",
        className,
      )}
      title="My tasks"
      aria-label={
        overdue > 0
          ? `My tasks (${overdue} overdue)`
          : count !== null
            ? `My tasks (${count})`
            : "My tasks"
      }
    >
      <ListChecks className="size-4" />
      <span className="hidden sm:inline">My tasks</span>
      {count !== null && count > 0 && (
        <span
          className={cn(
            "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold",
            overdue > 0
              ? "bg-destructive text-destructive-foreground"
              : "bg-muted text-foreground",
          )}
        >
          {overdue > 0 ? overdue : count}
        </span>
      )}
    </Link>
  );
}
