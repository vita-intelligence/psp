"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCheck,
  ChevronRight,
  Clipboard,
  Clock,
  PackageOpen,
  RefreshCw,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/forms/error-banner";
import { cn } from "@/lib/utils";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import type { PreflightQueueEntry } from "@/lib/production/types";
import type { PreflightQueueResponse } from "@/lib/production-preflight/server";

interface Props {
  initialResponse: PreflightQueueResponse | null;
  companyDateFormat: FormatPrefs | null;
}

const POLL_INTERVAL_MS = 30_000;

/**
 * Production-operator landing. Lists MOs whose pickup has landed at
 * production-feed but still need the per-booking receipt sign-off.
 * Tap a row → /m/preflight/<mo_uuid>.
 */
export function MobilePreflightList({
  initialResponse,
  companyDateFormat,
}: Props) {
  const router = useRouter();
  const [response, setResponse] = useState<PreflightQueueResponse | null>(
    initialResponse,
  );
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const res = await fetch("/api/m/preflight-queue", { cache: "no-store" });
      if (!res.ok) {
        if (!silent) {
          setErrorDetail(
            `Couldn't refresh the queue (${res.status}). Pull down again in a moment.`,
          );
          setErrorCode(`http_${res.status}`);
        }
        return;
      }
      const body = (await res.json()) as PreflightQueueResponse;
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
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh(true);
    }, POLL_INTERVAL_MS);
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
              Pre-production checks
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {response?.items.length ?? 0} awaiting receipt sign-off
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
              <PreflightCard
                key={entry.mo.uuid}
                entry={entry}
                onTap={() => router.push(`/m/preflight/${entry.mo.uuid}`)}
                companyDateFormat={companyDateFormat}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

interface PreflightCardProps {
  entry: PreflightQueueEntry;
  onTap: () => void;
  companyDateFormat: FormatPrefs | null;
}

function PreflightCard({ entry, onTap, companyDateFormat }: PreflightCardProps) {
  const { mo, planned_start, pickup_completed_at, pickup_completed_by } = entry;

  return (
    <li>
      <button
        type="button"
        onClick={onTap}
        className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 text-left active:bg-muted"
      >
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              <Clipboard className="size-2.5" />
              Awaiting sign-off
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
              <PackageOpen className="size-3" />
              {mo.quantity} units
            </span>
            {pickup_completed_at && (
              <span className="inline-flex items-center gap-1">
                <Truck className="size-3" />
                Arrived {formatCompanyDate(pickup_completed_at, companyDateFormat)}
                {pickup_completed_by ? ` · ${pickup_completed_by.name}` : ""}
              </span>
            )}
            {planned_start && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                MO starts {formatCompanyDate(planned_start, companyDateFormat)}
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
        <p className="text-sm font-semibold">Nothing to verify</p>
        <p className="text-xs text-muted-foreground">
          Once the warehouse picker drops ingredients at the production-feed
          cell, MOs awaiting receipt sign-off will appear here.
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href="/m">
          <ArrowLeft className="mr-1.5 size-3.5" />
          Back to mobile home
        </Link>
      </Button>
    </div>
  );
}
