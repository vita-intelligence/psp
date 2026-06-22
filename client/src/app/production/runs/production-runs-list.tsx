"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCheck,
  ChevronRight,
  Clock,
  Factory,
  Loader2,
  PackageOpen,
  Play,
  RefreshCw,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/forms/error-banner";
import { cn } from "@/lib/utils";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import type { ProductionRunEntry } from "@/lib/production/types";

const POLL_INTERVAL_MS = 30_000;

interface Props {
  initialQueue: ProductionRunEntry[];
  companyDateFormat: FormatPrefs | null;
}

export function ProductionRunsList({
  initialQueue,
  companyDateFormat,
}: Props) {
  const [queue, setQueue] = useState<ProductionRunEntry[]>(initialQueue);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const res = await fetch("/api/production/runs", { cache: "no-store" });
      if (!res.ok) {
        if (!silent)
          setErrorDetail(`Couldn't refresh the queue (${res.status}).`);
        return;
      }
      const body = (await res.json()) as { items: ProductionRunEntry[] };
      setQueue(body.items);
      if (!silent) setErrorDetail(null);
    } catch (err) {
      if (!silent)
        setErrorDetail(
          err instanceof Error ? err.message : "Network blip — try again.",
        );
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
            ? "No production runs ready."
            : `${queue.length} run${queue.length === 1 ? "" : "s"} on the floor`}
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
            <RunRow
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

function RunRow({
  entry,
  companyDateFormat,
}: {
  entry: ProductionRunEntry;
  companyDateFormat: FormatPrefs | null;
}) {
  const { mo, planned_start, actual_start, pickup_completed_at } = entry;
  const inProgress = mo.status === "in_progress";

  return (
    <li>
      <Link
        href={`/production/runs/${mo.uuid}`}
        className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
      >
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            inProgress
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              : "bg-sky-500/15 text-sky-700 dark:text-sky-300",
          )}
        >
          {inProgress ? (
            <Factory className="size-2.5" />
          ) : (
            <Play className="size-2.5" />
          )}
          {inProgress ? "Running" : "Ready to start"}
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
              {mo.quantity} units booked
            </span>
            {pickup_completed_at && (
              <span className="inline-flex items-center gap-1">
                <Truck className="size-3" />
                Materials arrived{" "}
                {formatCompanyDate(pickup_completed_at, companyDateFormat)}
              </span>
            )}
            {inProgress && actual_start ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                Started{" "}
                {formatCompanyDate(actual_start, companyDateFormat)}
              </span>
            ) : planned_start ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                Planned start{" "}
                {formatCompanyDate(planned_start, companyDateFormat)}
              </span>
            ) : null}
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
        <p className="text-sm font-semibold">Nothing on the floor</p>
        <p className="text-xs text-muted-foreground">
          Once an MO is preflight-cleared (warehouse pickup done +
          every booking signed off under Pre-production), it&apos;ll
          appear here ready to start.
        </p>
      </div>
    </div>
  );
}
