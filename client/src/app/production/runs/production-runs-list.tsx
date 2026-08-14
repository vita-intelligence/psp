"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCheck,
  ChevronRight,
  Clock,
  Factory,
  FlaskConical,
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
import { useEntityChannel } from "@/lib/realtime/use-entity-channel";

// Stream tab. Mirrors the MOs ledger pattern (see mos-ledger.tsx):
// URL is the source of truth so refresh + share + back/forward all
// stay in sync. `production` = normal MOs on the floor, `rnd` = trial
// / sample MOs (fast-path — no pickup ceremony), `all` = both.
type Stream = "production" | "rnd" | "all";

function normaliseStream(raw: string | null | undefined): Stream {
  return raw === "rnd" || raw === "all" ? raw : "production";
}

function isRndProjectType(pt: string | undefined): boolean {
  return pt === "trial" || pt === "sample";
}

interface Props {
  initialQueue: ProductionRunEntry[];
  companyDateFormat: FormatPrefs | null;
}

export function ProductionRunsList({
  initialQueue,
  companyDateFormat,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stream: Stream = normaliseStream(searchParams.get("stream"));

  const [queue, setQueue] = useState<ProductionRunEntry[]>(initialQueue);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter client-side. The queue is naturally small (only
  // preflight-cleared + in_progress + approved R&D runs), so
  // shipping the whole list once + filtering locally is cheaper
  // than a round-trip per tab click.
  const visibleQueue = useMemo(
    () =>
      queue.filter((entry) => {
        if (stream === "all") return true;
        const rnd = isRndProjectType(entry.mo.project_type);
        return stream === "rnd" ? rnd : !rnd;
      }),
    [queue, stream],
  );

  function chooseStream(next: Stream) {
    if (next === stream) return;
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("stream", next);
    router.replace(`${pathname}?${qs.toString()}`);
  }

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

  // Live push — any MO write (started, completed, released) fans out
  // through ``entity_changed("manufacturing-order", …)`` and the hook
  // re-runs the silent refresh. Debounced ~250 ms.
  useEntityChannel({
    entity: "manufacturing-order",
    onEvent: () => void refresh(true),
  });

  return (
    <section className="space-y-3">
      <StreamTabStrip stream={stream} onChange={chooseStream} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {visibleQueue.length === 0
            ? "No production runs in this view."
            : `${visibleQueue.length} run${visibleQueue.length === 1 ? "" : "s"} on the floor`}
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

      {visibleQueue.length === 0 ? (
        <EmptyState stream={stream} />
      ) : (
        <RunRowsWithPaging
          entries={visibleQueue}
          companyDateFormat={companyDateFormat}
        />
      )}
    </section>
  );
}

// Progressive-disclosure paging on the run list. Warehouses with
// 200+ live MOs would otherwise paint 200 row components on every
// filter change / refresh, dragging the mobile browser into jank
// under the 5s polling loop. First 50 rows render immediately + a
// "Load more" reveals the next 50. Keeps the DOM small without
// pulling in a virtualisation dependency for a simple linear layout.
const RUNS_PAGE_SIZE = 50;

function RunRowsWithPaging({
  entries,
  companyDateFormat,
}: {
  entries: ProductionRunEntry[];
  companyDateFormat: FormatPrefs | null;
}) {
  const [visibleCount, setVisibleCount] = useState(RUNS_PAGE_SIZE);
  const visible = entries.slice(0, visibleCount);
  const hidden = entries.length - visible.length;

  return (
    <>
      <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card">
        {visible.map((entry) => (
          <RunRow
            key={entry.mo.uuid}
            entry={entry}
            companyDateFormat={companyDateFormat}
          />
        ))}
      </ul>
      {hidden > 0 && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() =>
              setVisibleCount((n) => Math.min(n + RUNS_PAGE_SIZE, entries.length))
            }
            className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            Load {Math.min(RUNS_PAGE_SIZE, hidden)} more
            {hidden > RUNS_PAGE_SIZE ? ` (${hidden} remaining)` : ""}
          </button>
        </div>
      )}
    </>
  );
}

const STREAM_TABS: Array<{ value: Stream; label: string; hint: string }> = [
  {
    value: "production",
    label: "Production",
    hint: "Preflight-cleared production runs on the floor.",
  },
  {
    value: "rnd",
    label: "R&D",
    hint: "Trial + sample runs — bypass the warehouse-pickup ceremony.",
  },
  {
    value: "all",
    label: "All",
    hint: "Both streams. R&D rows are chipped.",
  },
];

function StreamTabStrip({
  stream,
  onChange,
}: {
  stream: Stream;
  onChange: (next: Stream) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Production runs stream"
      className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-1 text-sm"
    >
      {STREAM_TABS.map((t) => {
        const active = t.value === stream;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={t.hint}
            onClick={() => onChange(t.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
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
            {isRndProjectType(mo.project_type) && (
              <span
                title="R&D — trial or sample run. Books R&D-tagged lots only."
                className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-violet-700 dark:text-violet-300"
              >
                <FlaskConical className="size-2.5" />
                R&D
              </span>
            )}
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

function EmptyState({ stream }: { stream: Stream }) {
  const copy =
    stream === "rnd"
      ? {
          title: "No R&D runs on the floor",
          body: "Approved R&D MOs (trial + sample) appear here immediately — no warehouse pickup ceremony required.",
        }
      : stream === "production"
        ? {
            title: "No production runs ready",
            body: "Once an MO is preflight-cleared (warehouse pickup done + every booking signed off under Pre-production), it'll appear here ready to start.",
          }
        : {
            title: "Nothing on the floor",
            body: "No production or R&D runs in either stream right now.",
          };

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
      <CheckCheck className="size-7 text-emerald-500/70" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">{copy.title}</p>
        <p className="text-xs text-muted-foreground">{copy.body}</p>
      </div>
    </div>
  );
}
