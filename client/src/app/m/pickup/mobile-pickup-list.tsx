"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCheck,
  ChevronRight,
  Clock,
  PackageOpen,
  RefreshCw,
  Truck,
  UserCircle2,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/forms/error-banner";
import { cn } from "@/lib/utils";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import type {
  PickupQueueEntry,
} from "@/lib/production/types";
import { useEntityChannel } from "@/lib/realtime/use-entity-channel";
import type { PickupQueueResponse } from "@/lib/warehouse-pickup/server";

interface Props {
  initialResponse: PickupQueueResponse | null;
  companyDateFormat: FormatPrefs | null;
}

const UPCOMING_STORAGE_KEY = "psp:m:pickup:show-upcoming";

/**
 * Mobile pickup queue. Chronological by pickup_by; cards show urgency
 * via a colored badge (overdue = red, due now = amber, scheduled = neutral).
 * Cards lock when another picker has already started (head-of-picker).
 *
 * Tap a card → routes to /m/pickup/<mo_uuid> for the scan flow.
 *
 * Freshness is driven by the ``manufacturing-order`` entity channel —
 * any MO write (pickup_started_at, completed, released) fans out
 * through ``Backend.Broadcasts.entity_changed/4`` and the hook re-runs
 * the refresh. No polling interval, no client-side timer — the queue
 * updates within ~250ms of any cross-picker action.
 */
export function MobilePickupList({ initialResponse, companyDateFormat }: Props) {
  const router = useRouter();
  const [response, setResponse] = useState<PickupQueueResponse | null>(
    initialResponse,
  );
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Include upcoming — MOs already released but whose pickup window
  // hasn't opened yet. Off by default (the queue stays focused on
  // rows the picker should walk NOW); persisted so the picker's
  // choice survives navigation into an MO and back.
  const [showUpcoming, setShowUpcoming] = useState(false);

  useEffect(() => {
    // Restore the toggle from localStorage on mount. If the user
    // opted into "show upcoming" in a previous session, we ALSO need
    // to refetch with the flag — the SSR response used the default
    // (no flag), so the initial payload is missing any upcoming
    // rows. Without this refetch, the button initialises to "on" but
    // the page reads empty; tapping it then flips it to "off" (the
    // opposite of what the user intended).
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(UPCOMING_STORAGE_KEY) === "1") {
      setShowUpcoming(true);
      void refresh(true, true);
    }
    // Intentionally exclude `refresh` from deps — we only want this
    // to run once on mount. Including it would re-fire every time
    // showUpcoming changes (refresh's dep list) which is undesired.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(
    async (silent = false, upcoming = showUpcoming) => {
      if (!silent) setIsRefreshing(true);
      try {
        const url = upcoming
          ? "/api/m/pickup-queue?include_upcoming=1"
          : "/api/m/pickup-queue";
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          if (!silent) {
            setErrorDetail(
              `Couldn't refresh the queue (${res.status}). Pull down again in a moment.`,
            );
            setErrorCode(`http_${res.status}`);
          }
          return;
        }
        const body = (await res.json()) as PickupQueueResponse;
        setResponse(body);
        if (!silent) {
          setErrorDetail(null);
          setErrorCode(null);
        }
      } catch (err) {
        if (!silent) {
          setErrorDetail(
            err instanceof Error
              ? err.message
              : "Network blip — try again in a moment.",
          );
          setErrorCode("network_error");
        }
      } finally {
        if (!silent) setIsRefreshing(false);
      }
    },
    [showUpcoming],
  );

  // Live push — refresh whenever the MO ledger changes for this
  // tenant. Covers cross-picker starts, closeouts, released lots,
  // and manual overrides via the desktop app. Debounced ~250 ms
  // inside the hook so a burst of writes collapses.
  useEntityChannel({
    entity: "manufacturing-order",
    onEvent: () => void refresh(true),
  });

  const toggleUpcoming = useCallback(() => {
    setShowUpcoming((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(UPCOMING_STORAGE_KEY, next ? "1" : "0");
      }
      void refresh(true, next);
      return next;
    });
  }, [refresh]);

  const counts = useMemo(() => {
    let inProgress = 0;
    let overdue = 0;
    let upcoming = 0;
    const now = Date.now();
    for (const entry of response?.items ?? []) {
      if (entry.pickup_started_at) inProgress += 1;
      if (entry.pickup_by && new Date(entry.pickup_by).getTime() < now) overdue += 1;
      if (
        entry.visible_from &&
        new Date(entry.visible_from).getTime() > now &&
        !entry.pickup_started_at
      ) {
        upcoming += 1;
      }
    }
    return { inProgress, overdue, upcoming };
  }, [response]);

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center justify-between gap-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
          >
            <Link href="/m" aria-label="Back to mobile home">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-tight">
              Pickup queue
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {(response?.items.length ?? 0) - counts.upcoming} ready
              {counts.inProgress > 0
                ? ` · ${counts.inProgress} in progress`
                : ""}
              {counts.overdue > 0 ? ` · ${counts.overdue} overdue` : ""}
              {showUpcoming && counts.upcoming > 0
                ? ` · ${counts.upcoming} upcoming`
                : ""}
            </p>
          </div>
          <Button
            type="button"
            variant={showUpcoming ? "secondary" : "ghost"}
            size="sm"
            onClick={toggleUpcoming}
            disabled={isRefreshing}
            aria-pressed={showUpcoming}
            aria-label={
              showUpcoming
                ? "Hide MOs whose pickup window hasn't opened yet"
                : "Also show MOs whose pickup window hasn't opened yet"
            }
            title={
              showUpcoming
                ? "Showing all released MOs"
                : "Show upcoming MOs (window not open yet)"
            }
          >
            <CalendarClock className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void refresh(false)}
            disabled={isRefreshing}
            aria-label="Refresh queue"
          >
            <RefreshCw
              className={cn(
                "size-4",
                isRefreshing && "animate-spin text-muted-foreground",
              )}
            />
          </Button>
        </div>
      </header>

      <main className="flex-1 space-y-2 px-3 py-3">
        {errorDetail && (
          <ErrorBanner
            tone="warning"
            detail={errorDetail}
            code={errorCode ?? undefined}
          />
        )}

        {(response?.items?.length ?? 0) === 0 ? (
          <EmptyState showUpcoming={showUpcoming} onToggleUpcoming={toggleUpcoming} />
        ) : (
          <ul className="space-y-2">
            {response!.items.map((entry) => (
              <PickupCard
                key={entry.mo.uuid}
                entry={entry}
                onTap={() => router.push(`/m/pickup/${entry.mo.uuid}`)}
                companyDateFormat={companyDateFormat}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

interface PickupCardProps {
  entry: PickupQueueEntry;
  onTap: () => void;
  companyDateFormat: FormatPrefs | null;
}

function PickupCard({ entry, onTap, companyDateFormat }: PickupCardProps) {
  const { mo, pickup_by, pickup_started_by, visible_from } = entry;
  const brokenCount = mo.broken_bookings_count ?? 0;
  const isBroken = brokenCount > 0;
  const badge = computeBadge(entry);
  const startedByMe = pickup_started_by !== null;
  const isUpcoming =
    !!visible_from &&
    new Date(visible_from).getTime() > Date.now() &&
    !entry.pickup_started_at;

  return (
    <li>
      <button
        type="button"
        onClick={onTap}
        disabled={isBroken}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left",
          isBroken
            ? "border-amber-500/40 bg-amber-500/5 cursor-not-allowed"
            : isUpcoming
              ? "border-dashed border-border/50 bg-muted/20 active:bg-muted"
              : "border-border/60 bg-card active:bg-muted",
        )}
      >
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {isBroken ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-2.5" />
                Planner is fixing
              </span>
            ) : (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  badge.className,
                )}
              >
                {badge.label}
              </span>
            )}
            {startedByMe && pickup_started_by && !isBroken && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                <UserCircle2 className="size-2.5" />
                {pickup_started_by.name}
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-xs font-semibold text-muted-foreground">
              {mo.code ?? `#${mo.id}`}
            </span>
            <span className="truncate text-sm font-medium">
              {mo.item?.name ?? "Unknown item"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <PackageOpen className="size-3" />
              {mo.quantity} units
            </span>
            {pickup_by && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                Pick by {formatCompanyDate(pickup_by, companyDateFormat)}
              </span>
            )}
            {mo.start_at && !isBroken && (
              <span className="inline-flex items-center gap-1">
                <Truck className="size-3" />
                MO starts {formatCompanyDate(mo.start_at, companyDateFormat)}
              </span>
            )}
          </div>
          {isBroken && (
            <p className="text-[11px] text-amber-800 dark:text-amber-300">
              {brokenCount} booked {brokenCount === 1 ? "lot is" : "lots are"}{" "}
              broken — the planner is reviewing. Picking is paused.
            </p>
          )}
        </div>

        {!isBroken && (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>
    </li>
  );
}

interface CardBadge {
  label: string;
  className: string;
}

function computeBadge(entry: PickupQueueEntry): CardBadge {
  if (entry.pickup_started_at) {
    return {
      label: "In progress",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    };
  }
  const now = Date.now();
  const pickupByTime = entry.pickup_by ? new Date(entry.pickup_by).getTime() : null;
  const visibleFromTime = entry.visible_from
    ? new Date(entry.visible_from).getTime()
    : null;
  // Upcoming — window hasn't opened yet. Rendered with a neutral
  // grey badge + a "Opens in X" hint so the picker can still tap
  // and pre-pick without waiting for the window.
  if (visibleFromTime !== null && visibleFromTime > now) {
    return {
      label: `Opens ${formatRelativeFromNow(visibleFromTime - now)}`,
      className: "bg-muted text-muted-foreground",
    };
  }
  if (pickupByTime !== null && pickupByTime < now) {
    return {
      label: "Overdue",
      className: "bg-red-500/15 text-red-700 dark:text-red-300",
    };
  }
  return {
    label: "Ready",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  };
}

// Formats a positive millisecond diff into a short relative-time
// hint ("in 3h", "in 2d") for the "Opens" badge. Rounds to the
// nearest useful unit — sub-hour precision isn't valuable for a
// pickup window that has an implicit ~24h slack anyway.
function formatRelativeFromNow(diffMs: number): string {
  const minutes = Math.max(1, Math.round(diffMs / 60_000));
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

function EmptyState({
  showUpcoming,
  onToggleUpcoming,
}: {
  showUpcoming: boolean;
  onToggleUpcoming: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
      <CheckCheck className="size-7 text-emerald-500/70" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">Nothing to pick</p>
        <p className="text-xs text-muted-foreground">
          {showUpcoming
            ? "No released MOs waiting. Newly released ones will land here immediately."
            : "Released MOs will appear here as their pickup window opens. Show upcoming to see ones released early."}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {!showUpcoming && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onToggleUpcoming}
          >
            <CalendarClock className="mr-1.5 size-3.5" />
            Show upcoming
          </Button>
        )}
        <Button asChild variant="outline" size="sm">
          <Link href="/m">
            <Truck className="mr-1.5 size-3.5" />
            Back to mobile home
          </Link>
        </Button>
      </div>
    </div>
  );
}
