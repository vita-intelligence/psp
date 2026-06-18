"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
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
import type { PickupQueueResponse } from "@/lib/warehouse-pickup/server";

interface Props {
  initialResponse: PickupQueueResponse | null;
  companyDateFormat: FormatPrefs | null;
}

const POLL_INTERVAL_MS = 30_000;

/**
 * Mobile pickup queue. Chronological by pickup_by; cards show urgency
 * via a colored badge (overdue = red, due now = amber, scheduled = neutral).
 * Cards lock when another picker has already started (head-of-picker).
 *
 * Tap a card → routes to /m/pickup/<mo_uuid> for the scan flow.
 */
export function MobilePickupList({ initialResponse, companyDateFormat }: Props) {
  const router = useRouter();
  const [response, setResponse] = useState<PickupQueueResponse | null>(
    initialResponse,
  );
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) setIsRefreshing(true);
      try {
        const res = await fetch("/api/m/pickup-queue", { cache: "no-store" });
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
    [],
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh(true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const counts = useMemo(() => {
    let inProgress = 0;
    let overdue = 0;
    const now = Date.now();
    for (const entry of response?.items ?? []) {
      if (entry.pickup_started_at) inProgress += 1;
      if (entry.pickup_by && new Date(entry.pickup_by).getTime() < now) overdue += 1;
    }
    return { inProgress, overdue };
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
              {response?.items.length ?? 0} ready
              {counts.inProgress > 0
                ? ` · ${counts.inProgress} in progress`
                : ""}
              {counts.overdue > 0 ? ` · ${counts.overdue} overdue` : ""}
            </p>
          </div>
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
          <EmptyState />
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
  const { mo, pickup_by, pickup_started_by } = entry;
  const badge = computeBadge(entry);
  const startedByMe = pickup_started_by !== null;

  return (
    <li>
      <button
        type="button"
        onClick={onTap}
        className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 text-left active:bg-muted"
      >
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                badge.className,
              )}
            >
              {badge.label}
            </span>
            {startedByMe && pickup_started_by && (
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
            {mo.start_at && (
              <span className="inline-flex items-center gap-1">
                <Truck className="size-3" />
                MO starts {formatCompanyDate(mo.start_at, companyDateFormat)}
              </span>
            )}
          </div>
        </div>

        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
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

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
      <CheckCheck className="size-7 text-emerald-500/70" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">Nothing to pick</p>
        <p className="text-xs text-muted-foreground">
          Released MOs will appear here as their pickup window opens.
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href="/m">
          <Truck className="mr-1.5 size-3.5" />
          Back to mobile home
        </Link>
      </Button>
    </div>
  );
}
