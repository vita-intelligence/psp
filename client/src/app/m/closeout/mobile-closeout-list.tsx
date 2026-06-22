"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCheck,
  ChevronRight,
  Clock,
  Factory,
  PackageCheck,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/forms/error-banner";
import { cn } from "@/lib/utils";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import type { CloseoutQueueEntry } from "@/lib/production/types";
import type { CloseoutQueueResponse } from "@/lib/production-closeout/server";

interface Props {
  initialResponse: CloseoutQueueResponse | null;
  companyDateFormat: FormatPrefs | null;
}

const POLL_INTERVAL_MS = 30_000;

export function MobileCloseoutList({
  initialResponse,
  companyDateFormat,
}: Props) {
  const router = useRouter();
  const [response, setResponse] = useState<CloseoutQueueResponse | null>(
    initialResponse,
  );
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const res = await fetch("/api/m/closeout-queue", { cache: "no-store" });
      if (!res.ok) {
        if (!silent) setErrorDetail(`Couldn't refresh (${res.status}).`);
        return;
      }
      const body = (await res.json()) as CloseoutQueueResponse;
      setResponse(body);
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
    const id = window.setInterval(() => void refresh(true), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

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
              Closeout
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {response?.items.length ?? 0} MO
              {(response?.items.length ?? 0) === 1 ? "" : "s"} awaiting hand-off
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void refresh(false)}
            disabled={isRefreshing}
            aria-label="Refresh"
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
        {errorDetail && <ErrorBanner detail={errorDetail} />}

        {(response?.items?.length ?? 0) === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-2">
            {response!.items.map((entry) => (
              <CloseoutCard
                key={entry.mo.uuid}
                entry={entry}
                onTap={() => router.push(`/m/closeout/${entry.mo.uuid}`)}
                companyDateFormat={companyDateFormat}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function CloseoutCard({
  entry,
  onTap,
  companyDateFormat,
}: {
  entry: CloseoutQueueEntry;
  onTap: () => void;
  companyDateFormat: FormatPrefs | null;
}) {
  const { mo, actual_finish } = entry;

  return (
    <li>
      <button
        type="button"
        onClick={onTap}
        className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 text-left active:bg-muted"
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              <Factory className="size-2.5" />
              Closeout pending
            </span>
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
              <PackageCheck className="size-3" />
              {mo.quantity} units
            </span>
            {actual_finish && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                Finished {formatCompanyDate(actual_finish, companyDateFormat)}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
      <CheckCheck className="size-7 text-emerald-500/70" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">Nothing to close out</p>
        <p className="text-xs text-muted-foreground">
          Once a production run finishes and clears Output QC, the MOs
          land here so you can hand the materials + produced lots off
          to the production-side dispatch cell.
        </p>
      </div>
    </div>
  );
}
