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
  PackagePlus,
  RefreshCw,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/forms/error-banner";
import { cn } from "@/lib/utils";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import type {
  ReturnPickRow,
  ReturnPickupLot,
  ReturnPickupQueueEntry,
} from "@/lib/production/types";
import type {
  LooseDispatchResponse,
  ReturnPickupQueueResponse,
  TrolleyResponse,
} from "@/lib/warehouse-return-pickup/server";

interface Props {
  initialQueue: ReturnPickupQueueResponse | null;
  initialLoose: LooseDispatchResponse | null;
  initialTrolley: TrolleyResponse | null;
  companyDateFormat: FormatPrefs | null;
}

const POLL_INTERVAL_MS = 30_000;
const LOOSE_KEY = "__loose__";

export function MobileReturnPickupList({
  initialQueue,
  initialLoose,
  initialTrolley,
  companyDateFormat,
}: Props) {
  const router = useRouter();
  const [queue, setQueue] = useState<ReturnPickupQueueResponse | null>(
    initialQueue,
  );
  const [loose, setLoose] = useState<LooseDispatchResponse | null>(initialLoose);
  const [trolley, setTrolley] = useState<TrolleyResponse | null>(initialTrolley);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const [q, l, t] = await Promise.all([
        fetch("/api/m/return-pickup-queue", { cache: "no-store" }),
        fetch("/api/m/return-pickup/loose", { cache: "no-store" }),
        fetch("/api/m/return-pickup/trolley", { cache: "no-store" }),
      ]);
      if (q.ok) setQueue((await q.json()) as ReturnPickupQueueResponse);
      if (l.ok) setLoose((await l.json()) as LooseDispatchResponse);
      if (t.ok) setTrolley((await t.json()) as TrolleyResponse);
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

  const queueItems = queue?.items ?? [];
  const looseItems = loose?.items ?? [];
  const trolleyItems = trolley?.items ?? [];
  const peerTrolley = trolley?.others ?? [];
  const totalOpen =
    queueItems.reduce((acc, e) => acc + e.lots_at_dispatch, 0) + looseItems.length;

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
              Return pickup
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {totalOpen} lot{totalOpen === 1 ? "" : "s"} at dispatch
              {trolleyItems.length > 0 &&
                ` · ${trolleyItems.length} on your trolley`}
              {peerTrolley.length > 0 &&
                ` · ${peerTrolley.length} held by colleagues`}
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

      <main className="flex-1 space-y-3 px-3 py-3">
        {errorDetail && <ErrorBanner detail={errorDetail} />}

        {trolleyItems.length > 0 && (
          <TrolleyBanner
            trolley={trolleyItems}
            onResume={() => router.push("/m/return-pickup/loose")}
          />
        )}

        {queueItems.length === 0 && looseItems.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {queueItems.length > 0 && (
              <section className="space-y-2">
                <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  From production
                </h2>
                <ul className="space-y-2">
                  {queueItems.map((entry) => (
                    <QueueCard
                      key={entry.mo.uuid}
                      entry={entry}
                      onTap={() =>
                        router.push(`/m/return-pickup/${entry.mo.uuid}`)
                      }
                      companyDateFormat={companyDateFormat}
                    />
                  ))}
                </ul>
              </section>
            )}

            {looseItems.length > 0 && (
              <section className="space-y-2">
                <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Loose dispatch ({looseItems.length})
                </h2>
                <LooseCard
                  items={looseItems}
                  onTap={() => router.push(`/m/return-pickup/${LOOSE_KEY}`)}
                />
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function TrolleyBanner({
  trolley,
  onResume,
}: {
  trolley: ReturnPickRow[];
  onResume: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onResume}
      className="flex w-full items-center gap-3 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-3 text-left active:bg-sky-500/15"
    >
      <Truck className="size-5 shrink-0 text-sky-700 dark:text-sky-300" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-sky-900 dark:text-sky-100">
          {trolley.length} on your trolley
        </p>
        <p className="truncate text-[11px] text-sky-800/80 dark:text-sky-200/80">
          Tap to resume placing — each lot needs a target rack + photo.
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-sky-700/70 dark:text-sky-300/70" />
    </button>
  );
}

function QueueCard({
  entry,
  onTap,
  companyDateFormat,
}: {
  entry: ReturnPickupQueueEntry;
  onTap: () => void;
  companyDateFormat: FormatPrefs | null;
}) {
  const { mo, actual_finish, lots_at_dispatch } = entry;

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
              At dispatch
            </span>
            <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              {lots_at_dispatch} lot{lots_at_dispatch === 1 ? "" : "s"}
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

function LooseCard({
  items,
  onTap,
}: {
  items: ReturnPickupLot[];
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 text-left active:bg-muted"
    >
      <PackagePlus className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">Loose dispatch</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {items.length} unlinked lot{items.length === 1 ? "" : "s"} — raw
          materials returned without an MO tag.
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
      <CheckCheck className="size-7 text-emerald-500/70" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">Nothing to pick up</p>
        <p className="text-xs text-muted-foreground">
          Once production finishes closing out an MO and lots land in a
          dispatch cell, they'll appear here. Scan each onto the trolley
          and place them back at a warehouse rack.
        </p>
      </div>
    </div>
  );
}
