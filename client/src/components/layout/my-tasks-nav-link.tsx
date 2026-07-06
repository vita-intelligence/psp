"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ListChecks } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEntityChannel } from "@/lib/realtime/use-entity-channel";
import type { MyTasksCount } from "@/lib/my-tasks/types";
import {
  ensureNotificationPermission,
  fireBrowserTaskNotification,
  playTaskChime,
} from "@/lib/notifications/task-chime";

interface Props {
  className?: string;
}

// Minimum interval between count refreshes — collapses bursts of
// entity broadcasts into a single fetch, so a bulk import doesn't
// fire N count queries in a heartbeat.
const REFRESH_MIN_MS = 5000;

/** Top-bar "My tasks" pill with a live count of overdue tasks + a
 *  real-time chime + browser notification the moment a peer's action
 *  creates a new task for the current user.
 *
 *  Always mounted (never hides on `count === 0`) so operators always
 *  have a way to reach the queue and so they know the notifier is
 *  live. Zero-task state is the base "My tasks" label with no badge.
 *
 *  Detection heuristic: `total` increased since the last fetch. Missed
 *  cases (a task closed AND a new one opened between two fetches, net
 *  zero) surface next time the user opens `/my-tasks`; correctness of
 *  the badge itself is guaranteed by the server-side count. */
export function MyTasksNavLink({ className }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const [count, setCount] = useState<number | null>(null);
  const [overdue, setOverdue] = useState(0);

  // Throttle state — refuse to fire more than once per REFRESH_MIN_MS.
  const lastFetchRef = useRef(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Delta detection state.
  const previousTotalRef = useRef<number | null>(null);
  // We skip the notification on the *first* successful fetch — otherwise
  // "you opened a tab and had 3 pending tasks" fires a chime, which is
  // noise, not signal. Only true increases post-mount trigger.
  const primedRef = useRef(false);

  // Keep pathname in a ref so the fetch callback can read it without
  // re-creating on every route change.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const doFetch = useCallback(async () => {
    lastFetchRef.current = Date.now();
    try {
      const res = await fetch("/api/my-tasks/count", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as MyTasksCount;
      const prev = previousTotalRef.current;
      const nextTotal = body.total;

      setCount(nextTotal);
      setOverdue(body.overdue);
      previousTotalRef.current = nextTotal;

      if (!primedRef.current) {
        primedRef.current = true;
        return;
      }

      // Suppress the in-tab toast + chime while the user is already
      // staring at the queue — the row itself will surface via the
      // live channel. Browser notification still fires so a peer
      // reviewing the list in one tab still gets pinged if they've
      // switched tabs.
      const onTasksPage = pathnameRef.current === "/my-tasks";

      if (prev !== null && nextTotal > prev) {
        const delta = nextTotal - prev;
        if (!onTasksPage) {
          void playTaskChime();
          toast(
            delta === 1 ? "New task for you" : `${delta} new tasks for you`,
            {
              description:
                body.overdue > 0
                  ? `${body.overdue} overdue in total`
                  : "Open the queue to review",
              action: {
                label: "Open",
                onClick: () => router.push("/my-tasks"),
              },
            },
          );
        }
        fireBrowserTaskNotification(delta, body.overdue);
      }
    } catch {
      // Silent — the badge is best-effort. The dedicated page will
      // surface the real state.
    }
  }, [router]);

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
    ensureNotificationPermission();
    // Fetch-on-mount is the whole point of this effect — the setState
    // it triggers is exactly how the badge becomes populated. The
    // lint rule assumes we're syncing external → React inline, which
    // isn't this case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void doFetch();
    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
  }, [doFetch]);

  // One subscription per task-relevant entity — any change on one
  // could add a task to the current user's queue. Unrolled explicitly
  // so rules-of-hooks stays happy.
  useEntityChannel({ entity: "customer-order", onEvent: scheduleRefresh });
  useEntityChannel({ entity: "customer-invoice", onEvent: scheduleRefresh });
  useEntityChannel({ entity: "manufacturing-order", onEvent: scheduleRefresh });
  useEntityChannel({ entity: "purchase-order", onEvent: scheduleRefresh });
  useEntityChannel({ entity: "shipment", onEvent: scheduleRefresh });
  useEntityChannel({ entity: "stock-lot", onEvent: scheduleRefresh });

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
          : count !== null && count > 0
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
