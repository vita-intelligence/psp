"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCheck,
  ChevronRight,
  Clipboard,
  Clock,
  Loader2,
  PackageOpen,
  RefreshCw,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/forms/error-banner";
import { cn } from "@/lib/utils";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import type { PreflightQueueEntry } from "@/lib/production/types";

const POLL_INTERVAL_MS = 30_000;

interface Props {
  initialQueue: PreflightQueueEntry[];
  companyDateFormat: FormatPrefs | null;
}

/**
 * Desktop list of MOs awaiting pre-production receipt sign-off.
 * Click a row → /production/preflight/<mo_uuid> for the per-booking
 * verification form. Polls every 30s so a supervisor leaving the
 * page open sees new arrivals.
 */
export function PreflightWorkspace({
  initialQueue,
  companyDateFormat,
}: Props) {
  const [queue, setQueue] = useState<PreflightQueueEntry[]>(initialQueue);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const res = await fetch("/api/m/preflight-queue", { cache: "no-store" });
      if (!res.ok) {
        if (!silent) {
          setErrorDetail(`Couldn't refresh the queue (${res.status}).`);
        }
        return;
      }
      const body = (await res.json()) as { items: PreflightQueueEntry[] };
      setQueue(body.items);
      if (!silent) setErrorDetail(null);
    } catch (err) {
      if (!silent) {
        setErrorDetail(
          err instanceof Error ? err.message : "Network blip — try again.",
        );
      }
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh(true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {queue.length === 0
            ? "Nothing awaiting sign-off."
            : `${queue.length} MO${queue.length === 1 ? "" : "s"} awaiting receipt sign-off`}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void refresh(false)}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 size-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {errorDetail && <ErrorBanner detail={errorDetail} />}

      {queue.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card">
          {queue.map((entry) => (
            <PreflightRow
              key={entry.mo.uuid}
              entry={entry}
              companyDateFormat={companyDateFormat}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PreflightRow({
  entry,
  companyDateFormat,
}: {
  entry: PreflightQueueEntry;
  companyDateFormat: FormatPrefs | null;
}) {
  const { mo, planned_start, pickup_completed_at, pickup_completed_by } = entry;

  return (
    <li>
      <Link
        href={`/production/preflight/${mo.uuid}`}
        className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
      >
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
          <Clipboard className="size-2.5" />
          Awaiting sign-off
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-xs font-semibold text-muted-foreground">
              {mo.code ?? `#${mo.id}`}
            </span>
            <span className="truncate text-sm font-medium">
              {mo.item?.name ?? "Unknown item"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <PackageOpen className="size-3" />
              {mo.quantity} units
            </span>
            {pickup_completed_at && (
              <span className="inline-flex items-center gap-1">
                <Truck className="size-3" />
                Arrived{" "}
                {formatCompanyDate(pickup_completed_at, companyDateFormat)}
                {pickup_completed_by ? ` · ${pickup_completed_by.name}` : ""}
              </span>
            )}
            {planned_start && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                MO starts{" "}
                {formatCompanyDate(planned_start, companyDateFormat)}
              </span>
            )}
          </div>
        </div>

        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
      <CheckCheck className="size-7 text-emerald-500/70" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">Nothing to verify</p>
        <p className="text-xs text-muted-foreground">
          Once the warehouse picker drops ingredients at the production-feed
          cell, MOs awaiting receipt sign-off will appear here.
        </p>
      </div>
      <PreflightInfoCard />
    </div>
  );
}

function PreflightInfoCard() {
  return (
    <div className="mt-2 flex max-w-md items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-left text-[11px] text-muted-foreground">
      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
      <p>
        Sign-off is a hard gate — production can&apos;t flip an MO to
        In progress until every booked raw-material and packaging line has
        been received here (qty + quality notes).
      </p>
    </div>
  );
}
