"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCheck,
  ChevronRight,
  Clock,
  Package2,
  RefreshCw,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/forms/error-banner";
import { cn } from "@/lib/utils";
import type {
  MobileIncomingResponse,
  MobileIncomingRow,
  MobileIncomingOpenInspection,
} from "@/lib/goods-in/server";

interface WarehouseOption {
  id: number;
  uuid: string;
  name: string;
}

interface Props {
  initialResponse: MobileIncomingResponse | null;
  warehouses: WarehouseOption[];
}

type DayFilter = "today" | "tomorrow" | "this_week" | "all";

const POLL_INTERVAL_MS = 30_000;

/**
 * Mobile "Expected today" board.
 *
 * Layout: sticky top header + horizontal day-chip filter + body of
 * tap-friendly cards. Lightweight 30s polling refreshes the list so a
 * second operator's "I started this one" reflects without a manual
 * pull-to-refresh.
 *
 * Card tap behaviour:
 *   - open inspection exists → navigate straight to the wizard at
 *     /m/inspections/<uuid>
 *   - no open inspection → create a draft (server action) then
 *     navigate to the new uuid
 *
 * Errors surface in the standard `<ErrorBanner>` at the top — the
 * banner stays soft (`tone="warning"`) so a transient 502 during
 * polling doesn't paint the whole list red.
 */
export function MobileIncomingList({ initialResponse, warehouses }: Props) {
  const router = useRouter();
  const [response, setResponse] = useState<MobileIncomingResponse | null>(
    initialResponse,
  );
  const [warehouseId, setWarehouseId] = useState<number | null>(
    warehouses[0]?.id ?? null,
  );
  const [dayFilter, setDayFilter] = useState<DayFilter>("today");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Re-fetch when the warehouse filter changes by reading the same
  // page through a client fetch. The server-action route hits the
  // BE under the device cookie automatically (forwarded by the Next
  // proxy), so we use a fetch helper colocated below.
  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) setIsRefreshing(true);
      try {
        const params = new URLSearchParams();
        if (warehouseId != null)
          params.set("warehouse_id", String(warehouseId));
        const res = await fetch(
          `/api/m/incoming?${params.toString()}`,
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
        const body = (await res.json()) as MobileIncomingResponse;
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
    [warehouseId],
  );

  // Re-fetch on warehouse change. Skip the first run so the SSR
  // response stays as the initial paint (the polling loop below picks
  // up any drift). Re-fetching on mount triggers a cascading render
  // for no benefit since SSR already returned the same data.
  const initialWarehouseRef = useRef(warehouseId);
  useEffect(() => {
    if (warehouseId === initialWarehouseRef.current) return;
    void refresh(true);
  }, [refresh, warehouseId]);

  // Lightweight polling. Keeps the list honest if a teammate starts
  // an inspection from the laptop while the operator is staring at
  // the tablet. 30s is well under any "is this fresh?" expectation.
  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh(true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const todayIso = useMemo(() => isoToday(), []);
  const tomorrowIso = useMemo(
    () => isoOffset(todayIso, 1),
    [todayIso],
  );

  // Apply the day chip filter on the server-supplied list. Cheaper
  // than re-fetching with a stricter window on every chip toggle.
  const filteredRows = useMemo(
    () =>
      (response?.items ?? []).filter((row) =>
        matchesDayFilter(row, dayFilter, todayIso, tomorrowIso),
      ),
    [response, dayFilter, todayIso, tomorrowIso],
  );

  const counts = useMemo(
    () => computeCounts(response?.items ?? [], todayIso, tomorrowIso),
    [response, todayIso, tomorrowIso],
  );

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
              Expected deliveries
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {response?.items.length ?? 0} in window · {counts.today} today
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void refresh(false)}
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

        {warehouses.length > 1 && (
          <div className="mt-2 -mx-1 flex gap-1 overflow-x-auto pb-1">
            {warehouses.map((wh) => (
              <button
                key={wh.uuid}
                type="button"
                onClick={() => setWarehouseId(wh.id)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs font-medium",
                  warehouseId === wh.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/60 bg-background text-muted-foreground",
                )}
              >
                {wh.name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-2 -mx-1 flex gap-1 overflow-x-auto pb-1">
          <FilterChip
            label="Today"
            count={counts.today}
            active={dayFilter === "today"}
            onClick={() => setDayFilter("today")}
          />
          <FilterChip
            label="Tomorrow"
            count={counts.tomorrow}
            active={dayFilter === "tomorrow"}
            onClick={() => setDayFilter("tomorrow")}
          />
          <FilterChip
            label="This week"
            count={counts.thisWeek}
            active={dayFilter === "this_week"}
            onClick={() => setDayFilter("this_week")}
          />
          <FilterChip
            label="All"
            count={response?.items.length ?? 0}
            active={dayFilter === "all"}
            onClick={() => setDayFilter("all")}
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

        {filteredRows.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-2">
            {filteredRows.map((row) => (
              <IncomingCard
                key={row.purchase_order.uuid}
                row={row}
                todayIso={todayIso}
                tomorrowIso={tomorrowIso}
                onTap={(uuid) => {
                  // Insert the "what to expect" pre-receive checklist
                  // before the operator dives into the inspection
                  // wizard. The pre-receive screen cross-checks vendor
                  // paperwork against the PO + surfaces compliance
                  // flags so the worker spots an unfinalised item
                  // before the truck pulls away. The Start receiving
                  // CTA on that screen handles the open-vs-create
                  // inspection branching.
                  router.push(`/m/incoming/${uuid}`);
                }}
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

function IncomingCard({
  row,
  todayIso,
  tomorrowIso,
  onTap,
}: {
  row: MobileIncomingRow;
  todayIso: string;
  tomorrowIso: string;
  onTap: (poUuid: string) => void;
}) {
  const po = row.purchase_order;
  const badge = computeBadge(po.expected_delivery_date, todayIso, tomorrowIso);
  const lineCount = po.lines.length;
  const remainingSum = po.lines
    .reduce((acc, l) => acc + Number(l.remaining || "0"), 0)
    .toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <li>
      <button
        type="button"
        onClick={() => onTap(po.uuid)}
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
            {row.open_inspection && (
              <InspectionBadge inspection={row.open_inspection} />
            )}
          </div>

          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-xs font-semibold text-muted-foreground">
              {po.code ?? `#${po.id}`}
            </span>
            <span className="truncate text-sm font-medium">
              {po.vendor?.name ?? "Unknown vendor"}
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Package2 className="size-3" />
              {lineCount} {lineCount === 1 ? "item" : "items"}
            </span>
            {remainingSum && (
              <span>{remainingSum} units remaining</span>
            )}
            {po.default_warehouse?.name && (
              <span className="truncate">→ {po.default_warehouse.name}</span>
            )}
          </div>
        </div>

        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

function InspectionBadge({
  inspection,
}: {
  inspection: MobileIncomingOpenInspection;
}) {
  const operatorName = inspection.goods_in_operator?.name;
  const label =
    inspection.status === "submitted"
      ? operatorName
        ? `Awaiting QC · signed by ${operatorName}`
        : "Awaiting QC"
      : operatorName
        ? `In progress by ${operatorName}`
        : "Inspection in progress";

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
      <Clock className="size-2.5" />
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
      <CheckCheck className="size-7 text-emerald-500/70" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">Nothing expected</p>
        <p className="text-xs text-muted-foreground">
          Enjoy the quiet. Pull down or tap refresh if a delivery shows up.
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

// ----- helpers ----------------------------------------------------

function isoToday(): string {
  // Operator's local "today" — the badge label they care about is
  // the local date their wall clock says. Backend already filters by
  // calendar date too.
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function isoOffset(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d!);
  dt.setDate(dt.getDate() + days);
  return [
    dt.getFullYear(),
    String(dt.getMonth() + 1).padStart(2, "0"),
    String(dt.getDate()).padStart(2, "0"),
  ].join("-");
}

interface CardBadge {
  label: string;
  className: string;
}

function computeBadge(
  expectedIso: string,
  todayIso: string,
  tomorrowIso: string,
): CardBadge {
  if (expectedIso < todayIso) {
    return {
      label: "Overdue",
      className: "bg-red-500/15 text-red-700 dark:text-red-300",
    };
  }
  if (expectedIso === todayIso) {
    return {
      label: "Expected today",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    };
  }
  if (expectedIso === tomorrowIso) {
    return {
      label: "Tomorrow",
      className: "bg-muted text-foreground/70",
    };
  }
  // This week / further out — show the abbreviated weekday + date so
  // the operator can plan ahead without doing date math in their head.
  const dt = new Date(expectedIso);
  const weekday = dt.toLocaleDateString(undefined, { weekday: "short" });
  const day = dt.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  return {
    label: `${weekday} ${day}`,
    className: "bg-muted text-foreground/70",
  };
}

interface DayCounts {
  today: number;
  tomorrow: number;
  thisWeek: number;
}

function computeCounts(
  rows: MobileIncomingRow[],
  todayIso: string,
  tomorrowIso: string,
): DayCounts {
  let today = 0;
  let tomorrow = 0;
  let thisWeek = 0;
  const weekEnd = isoOffset(todayIso, 7);
  for (const r of rows) {
    const d = r.purchase_order.expected_delivery_date;
    if (d === todayIso) today += 1;
    if (d === tomorrowIso) tomorrow += 1;
    if (d >= todayIso && d <= weekEnd) thisWeek += 1;
  }
  return { today, tomorrow, thisWeek };
}

function matchesDayFilter(
  row: MobileIncomingRow,
  filter: DayFilter,
  todayIso: string,
  tomorrowIso: string,
): boolean {
  const d = row.purchase_order.expected_delivery_date;
  if (filter === "all") return true;
  if (filter === "today") {
    // Today bucket also surfaces overdue POs so the operator never
    // forgets a delivery that should already have landed.
    return d <= todayIso;
  }
  if (filter === "tomorrow") return d === tomorrowIso;
  if (filter === "this_week") {
    const weekEnd = isoOffset(todayIso, 7);
    return d >= todayIso && d <= weekEnd;
  }
  return true;
}
