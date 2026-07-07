"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ListChecks } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
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

// TanStack Query key — the same key is invalidated by useEntityChannel
// on peer writes, so a fresh count lands automatically. Kept mutable
// (no `as const`) because useEntityChannel's `invalidateQueryKey`
// parameter is typed as `unknown[]`.
const COUNT_QUERY_KEY: unknown[] = ["my-tasks-count"];

// Module-scoped delta trackers. The nav link REMOUNTS on every
// navigation (TopBar is imported per-page, not in the shared root
// layout), so a component-local ref would reset the "we've already
// primed the notifier" flag and re-fire a chime for every existing
// task on every page load. Keeping these at module scope means the
// notifier fires only on true count *increases* across the tab's
// lifetime.
let lastKnownTotal: number | null = null;
let notifierPrimed = false;

/** Top-bar "My tasks" pill with a live count of overdue tasks + a
 *  real-time chime + browser notification the moment a peer's action
 *  creates a new task for the current user.
 *
 *  Backed by a TanStack Query cache under `["my-tasks-count"]` so
 *  navigation between pages is instant — the badge reads from cache
 *  instead of re-fetching. Peer writes still refresh the cache via
 *  `useEntityChannel({ invalidateQueryKey })` so the count stays
 *  fresh in real time.
 *
 *  Always mounted (never hides on `count === 0`) so operators always
 *  have a way to reach the queue and so they know the notifier is
 *  live. Zero-task state is the base "My tasks" label with no badge.
 *
 *  Detection heuristic: `total` increased since the last observed
 *  value. Missed cases (a task closed AND a new one opened between
 *  two fetches, net zero) surface next time the user opens
 *  `/my-tasks`; correctness of the badge itself is guaranteed by
 *  the server-side count. */
export function MyTasksNavLink({ className }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const { data } = useQuery<MyTasksCount>({
    queryKey: COUNT_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/my-tasks/count", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as MyTasksCount;
    },
    // 30s stale window matches the QueryProvider default; explicit
    // here so a future change to the global default doesn't quietly
    // flip the badge's behaviour.
    staleTime: 30_000,
    // The important one for THIS component — don't refetch just
    // because the component remounted. Navigation between pages
    // remounts TopBar, but the cached count is authoritative until
    // it goes stale or a peer write invalidates it.
    refetchOnMount: false,
  });

  const count = data?.total ?? null;
  const overdue = data?.overdue ?? 0;

  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // Request browser Notification permission on the first user gesture.
  // The helper attaches a one-shot listener; safe to call on every
  // mount since it no-ops when permission is already granted / denied.
  useEffect(() => {
    ensureNotificationPermission();
  }, []);

  // Delta detection — fire the chime / toast / browser notification
  // only when total *increases* vs the previously observed value.
  // Skips the first fetch after a fresh tab load so pending tasks
  // that were already in the queue don't spam a chime on arrival.
  useEffect(() => {
    if (!data) return;
    const nextTotal = data.total;
    const prev = lastKnownTotal;
    lastKnownTotal = nextTotal;

    if (!notifierPrimed) {
      notifierPrimed = true;
      return;
    }

    if (prev === null || nextTotal <= prev) return;

    const delta = nextTotal - prev;
    const onTasksPage = pathnameRef.current === "/my-tasks";

    if (!onTasksPage) {
      void playTaskChime();
      toast(
        delta === 1 ? "New task for you" : `${delta} new tasks for you`,
        {
          description:
            data.overdue > 0
              ? `${data.overdue} overdue in total`
              : "Open the queue to review",
          action: {
            label: "Open",
            onClick: () => router.push("/my-tasks"),
          },
        },
      );
    }

    // Browser notification fires regardless of pathname so a peer
    // reviewing the queue in one tab still gets pinged if they've
    // switched to another tab entirely.
    fireBrowserTaskNotification(delta, data.overdue);
  }, [data, router]);

  // Peer writes → invalidate the count cache → useQuery refetches.
  // TanStack Query dedupes concurrent invalidations, so a burst of
  // broadcasts across six entities collapses to (at most) one fetch.
  // No custom throttling needed.
  useEntityChannel({
    entity: "customer-order",
    invalidateQueryKey: COUNT_QUERY_KEY,
  });
  useEntityChannel({
    entity: "customer-invoice",
    invalidateQueryKey: COUNT_QUERY_KEY,
  });
  useEntityChannel({
    entity: "manufacturing-order",
    invalidateQueryKey: COUNT_QUERY_KEY,
  });
  useEntityChannel({
    entity: "purchase-order",
    invalidateQueryKey: COUNT_QUERY_KEY,
  });
  useEntityChannel({
    entity: "shipment",
    invalidateQueryKey: COUNT_QUERY_KEY,
  });
  useEntityChannel({
    entity: "stock-lot",
    invalidateQueryKey: COUNT_QUERY_KEY,
  });

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
