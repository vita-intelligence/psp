"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Microscope,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/forms/error-banner";
import { cn } from "@/lib/utils";
import { formatCompanyDate } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type { InspectionStatus } from "@/lib/goods-in/types";
import type { InspectionSummary } from "@/lib/inspections/types";

type Tab = "needs_sign_off" | "mine" | "recent";

interface InitialPages {
  needs_sign_off: InspectionSummary[];
  mine: InspectionSummary[];
  recent: InspectionSummary[];
}

interface Props {
  canApprove: boolean;
  initialPages: InitialPages;
}

const POLL_INTERVAL_MS = 30_000;

/**
 * Mobile inspections list.
 *
 * Three tabs:
 *   - Needs sign-off (approver-only) → `?status=submitted`
 *   - Mine                          → `?mine=true`
 *   - All recent                    → no filter
 *
 * Default tab: "Needs sign-off" if the viewer can approve, else
 * "Mine". Tap a row → /m/inspections/<uuid> (wizard or its
 * read-only summary depending on status).
 */
export function MobileInspectionsList({ canApprove, initialPages }: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();
  const [tab, setTab] = useState<Tab>(canApprove ? "needs_sign_off" : "mine");
  const [pages, setPages] = useState<InitialPages>(initialPages);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchTab = useCallback(
    async (which: Tab, silent: boolean): Promise<void> => {
      if (!silent) setIsRefreshing(true);
      try {
        const params = new URLSearchParams({ limit: "25" });
        if (which === "needs_sign_off") params.set("status", "submitted");
        if (which === "mine") params.set("mine", "true");
        const res = await fetch(
          `/api/procurement/inspections?${params.toString()}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          if (!silent) {
            setErrorDetail(
              `Couldn't refresh the list (${res.status}). Pull down again in a moment.`,
            );
            setErrorCode(`http_${res.status}`);
          }
          return;
        }
        const body = (await res.json()) as { items: InspectionSummary[] };
        setPages((prev) => ({ ...prev, [which]: body.items ?? [] }));
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

  // Re-fetch the active tab on chip swap so chip counts and rows stay
  // honest after a peer signs / approves on another device.
  const initialTabRef = useRef(tab);
  useEffect(() => {
    if (tab === initialTabRef.current) return;
    void fetchTab(tab, true);
  }, [fetchTab, tab]);

  // Light polling so an approver sees a freshly-submitted inspection
  // pop into the chip without having to manually refresh. 30 s is the
  // same cadence as the goods-in board.
  useEffect(() => {
    const id = window.setInterval(() => {
      void fetchTab(tab, true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [fetchTab, tab]);

  const rows = pages[tab];

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
              Inspections
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {rows.length} {rows.length === 1 ? "result" : "results"}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void fetchTab(tab, false)}
            disabled={isRefreshing}
            aria-label="Refresh list"
          >
            <RefreshCw
              className={cn(
                "size-4",
                isRefreshing && "animate-spin text-muted-foreground",
              )}
            />
          </Button>
        </div>

        <div className="mt-2 -mx-1 flex gap-1 overflow-x-auto pb-1">
          {canApprove && (
            <FilterChip
              label="Needs sign-off"
              count={pages.needs_sign_off.length}
              active={tab === "needs_sign_off"}
              onClick={() => setTab("needs_sign_off")}
            />
          )}
          <FilterChip
            label="Mine"
            count={pages.mine.length}
            active={tab === "mine"}
            onClick={() => setTab("mine")}
          />
          <FilterChip
            label="All recent"
            count={pages.recent.length}
            active={tab === "recent"}
            onClick={() => setTab("recent")}
          />
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

        {rows.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <InspectionRow
                key={row.uuid}
                row={row}
                prefs={prefs}
                onTap={(uuid) => router.push(`/m/inspections/${uuid}`)}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1 text-xs font-medium",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/60 bg-background text-muted-foreground",
      )}
    >
      {label}
      <span
        className={cn(
          "ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold",
          active
            ? "bg-primary-foreground/20 text-primary-foreground"
            : "bg-muted text-foreground/70",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function InspectionRow({
  row,
  prefs,
  onTap,
}: {
  row: InspectionSummary;
  prefs: ReturnType<typeof useFormatPrefs>;
  onTap: (uuid: string) => void;
}) {
  const tone = STATUS_TONE[row.status];
  const Icon = STATUS_ICON[row.status];
  return (
    <li>
      <button
        type="button"
        onClick={() => onTap(row.uuid)}
        className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 text-left active:bg-muted"
      >
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                tone,
              )}
            >
              <Icon className="size-2.5" />
              {STATUS_LABEL[row.status]}
            </span>
            {row.purchase_order?.code && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {row.purchase_order.code}
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-xs font-semibold text-muted-foreground">
              {row.code ?? `#${row.id}`}
            </span>
            <span className="truncate text-sm font-medium">
              {row.purchase_order?.vendor?.name ?? "Unknown vendor"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {row.delivery_date && (
              <span>{formatCompanyDate(row.delivery_date, prefs)}</span>
            )}
            {row.goods_in_operator && (
              <span className="truncate">By {row.goods_in_operator.name}</span>
            )}
            {row.quality_approver && (
              <span className="truncate">
                QC {row.quality_approver.name}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  const copy = EMPTY_COPY[tab];
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
      <Microscope className="size-7 text-muted-foreground/40" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">{copy.title}</p>
        <p className="text-xs text-muted-foreground">{copy.body}</p>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<InspectionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  hold: "On hold",
  rejected: "Rejected",
};

const STATUS_TONE: Record<InspectionStatus, string> = {
  draft: "bg-muted text-foreground/70",
  submitted: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  hold: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
};

const STATUS_ICON: Record<InspectionStatus, typeof Clock> = {
  draft: Clock,
  submitted: ShieldCheck,
  approved: CheckCircle2,
  hold: Clock,
  rejected: XCircle,
};

const EMPTY_COPY: Record<Tab, { title: string; body: string }> = {
  needs_sign_off: {
    title: "Nothing waiting for sign-off",
    body: "Submitted inspections will appear here. Pull down to refresh.",
  },
  mine: {
    title: "You haven't touched any inspections yet",
    body: "Inspections you start or sign off on will land in this list.",
  },
  recent: {
    title: "No inspections yet",
    body: "Once an operator opens a draft against an incoming delivery, it'll appear here.",
  },
};
