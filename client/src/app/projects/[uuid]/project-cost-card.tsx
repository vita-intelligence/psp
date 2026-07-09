"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PoundSterling, Radio } from "lucide-react";
import type { CompanyDefaults } from "@/lib/types";
import { formatCompanyMoney } from "@/lib/format/company";
import { useEntityChannel } from "@/lib/realtime/use-entity-channel";
import { cn } from "@/lib/utils";
import type { COCostBreakdown } from "@/lib/customer-orders/cost";

/**
 * Project cost so far — the wizard's "how much has this CO burnt
 * through" card. Sums materials + labour + machine across every MO
 * in the CO tree and ticks live as kiosk sessions run.
 *
 * Realtime strategy:
 *
 *   1. Subscribe to the `workstation_session_co` channel scoped to
 *      the CO UUID — the same channel the sessions card + routemap
 *      already listen on. Any kiosk event bumps a `router.refresh()`,
 *      which re-runs the server component and threads a fresh
 *      snapshot in via `initial`.
 *   2. When there's at least one session running
 *      (`active_labour_running_seconds > 0`), schedule a periodic
 *      `router.refresh()` every 15s so labour visibly ticks between
 *      kiosk events (a session that ran uninterrupted for 30 minutes
 *      wouldn't push events but still accrues cost).
 *
 * Money formatting: strictly through `formatCompanyMoney(..., prefs)`
 * per the CLAUDE.md rendering rule. Currency code override is passed
 * so an EUR customer order renders as EUR even if the company's base
 * is GBP.
 */
export interface ProjectCostCardProps {
  coUuid: string;
  initial: COCostBreakdown | null;
  prefs: CompanyDefaults;
}

export function ProjectCostCard({ coUuid, initial, prefs }: ProjectCostCardProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<COCostBreakdown | null>(initial);
  const [, startTransition] = useTransition();

  // Adopt the freshly-server-fetched snapshot on every re-render so
  // `router.refresh()` propagates to state without a manual refetch.
  useEffect(() => {
    setSnapshot(initial);
  }, [initial]);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  // Kiosk events → refresh. Debounced 250ms upstream in the hook so a
  // burst of writes on a busy CO collapses to one round-trip.
  useEntityChannel({
    entity: "workstation_session_co",
    uuid: coUuid,
    onEvent: refresh,
  });

  const activeSeconds = snapshot?.totals.active_labour_running_seconds ?? 0;
  const isLive = activeSeconds > 0;

  // Periodic tick so labour visibly climbs even when the kiosk
  // channel is quiet (a running session doesn't emit an event every
  // second). 15s keeps the UX snappy without hammering the API.
  useEffect(() => {
    if (!isLive) return;
    const handle = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(handle);
  }, [isLive, refresh]);

  const totals = snapshot?.totals;
  const mos = snapshot?.mos ?? [];
  const currency = snapshot?.currency_code ?? null;
  const currencyOverride = currency ? { currency_code: currency } : {};

  const totalNumber = safeNumber(totals?.total_cost);
  const materialNumber = safeNumber(totals?.material_cost);
  const labourNumber = safeNumber(totals?.labour_cost);
  const machineNumber = safeNumber(totals?.machine_cost);

  // Segmented bar shares — guard divide-by-zero for a fresh CO.
  const shares = useMemo(() => {
    if (totalNumber <= 0) {
      return { material: 0, labour: 0, machine: 0 };
    }
    return {
      material: (materialNumber / totalNumber) * 100,
      labour: (labourNumber / totalNumber) * 100,
      machine: (machineNumber / totalNumber) * 100,
    };
  }, [totalNumber, materialNumber, labourNumber, machineNumber]);

  if (!snapshot) {
    // Server fetch failed (auth expired etc.) — render nothing rather
    // than a broken empty card. The wizard's other loaders will show
    // the auth error state.
    return null;
  }

  return (
    <section
      data-phase="production"
      className="rounded-lg border border-border/60 bg-card p-5 shadow-sm"
    >
      <header className="mb-4 flex items-start gap-2">
        <PoundSterling
          className="mt-0.5 size-4 text-muted-foreground"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight">
            Project cost so far
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Materials + labour + machine, rolled up across every MO in
            this order.
          </p>
        </div>
        {isLive && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-400"
            title="A kiosk session is running — cost is accruing live."
          >
            <Radio className="size-3 animate-pulse" aria-hidden />
            live
          </span>
        )}
      </header>

      <div className="space-y-1">
        <div className="text-3xl font-semibold tracking-tight">
          {formatCompanyMoney(totals?.total_cost, prefs, currencyOverride)}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Spent across{" "}
          <span className="font-medium text-foreground">{mos.length}</span>{" "}
          {mos.length === 1 ? "MO" : "MOs"}
          {totals?.planned_total_cost && (
            <>
              {" "}·{" "}
              <span className="font-medium text-foreground">
                {formatCompanyMoney(
                  totals.planned_total_cost,
                  prefs,
                  currencyOverride,
                )}
              </span>{" "}
              planned
            </>
          )}
        </div>
      </div>

      {/* Segmented bar */}
      <div className="mt-4">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="bg-amber-500"
            style={{ width: `${shares.material}%` }}
            aria-label={`Materials ${shares.material.toFixed(0)}%`}
          />
          <div
            className="bg-sky-500"
            style={{ width: `${shares.labour}%` }}
            aria-label={`Labour ${shares.labour.toFixed(0)}%`}
          />
          <div
            className="bg-violet-500"
            style={{ width: `${shares.machine}%` }}
            aria-label={`Machine ${shares.machine.toFixed(0)}%`}
          />
        </div>
      </div>

      {/* Breakdown rows */}
      <dl className="mt-4 space-y-2 text-xs">
        <CostRow
          swatch="bg-amber-500"
          label="Materials"
          value={formatCompanyMoney(
            totals?.material_cost,
            prefs,
            currencyOverride,
          )}
          hint={
            totals?.planned_material_cost
              ? `${formatCompanyMoney(
                  totals.planned_material_cost,
                  prefs,
                  currencyOverride,
                )} planned`
              : undefined
          }
          share={shares.material}
        />
        <CostRow
          swatch="bg-sky-500"
          label="Labour"
          value={formatCompanyMoney(
            totals?.labour_cost,
            prefs,
            currencyOverride,
          )}
          share={shares.labour}
        />
        <CostRow
          swatch="bg-violet-500"
          label="Machine"
          value={formatCompanyMoney(
            totals?.machine_cost,
            prefs,
            currencyOverride,
          )}
          share={shares.machine}
        />
      </dl>

      {/* Per-machine drill-down. Only rendered when at least one
          machine actually contributed — otherwise the machine cost
          came from the workstation/group fallback and there's nothing
          to break out. Collapsed by default. */}
      {snapshot.by_machine && snapshot.by_machine.length > 0 && (
        <details className="group mt-4 border-t border-border/60 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
            <span className="inline-block transition-transform group-open:rotate-90">
              ▸
            </span>
            <span
              className="ml-1 size-2 shrink-0 rounded-full bg-violet-500"
              aria-hidden
            />
            <span className="ml-1">By machine</span>
            <span className="ml-auto font-normal">
              {snapshot.by_machine.length} contributing
            </span>
          </summary>
          <ul className="mt-3 space-y-1.5">
            {snapshot.by_machine.map((m) => (
              <li
                key={m.uuid}
                className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-foreground">
                      {m.name}
                    </span>
                    {m.asset_tag && (
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                        {m.asset_tag}
                      </span>
                    )}
                    <span className="ml-2 text-muted-foreground">
                      @ {m.workstation_name}
                    </span>
                  </div>
                  <span className="whitespace-nowrap font-semibold tabular-nums">
                    {formatCompanyMoney(m.cost, prefs, currencyOverride)}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                  {m.hours}h ·{" "}
                  {formatCompanyMoney(m.hourly_rate, prefs, currencyOverride)}
                  /h
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Per-MO drill-down. Collapsed by default so a long CO stays
          compact in the left column. */}
      {mos.length > 0 && (
        <details className="group mt-4 border-t border-border/60 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
            <span className="inline-block transition-transform group-open:rotate-90">
              ▸
            </span>
            Per MO breakdown
          </summary>
          <ul className="mt-3 space-y-2">
            {mos.map((mo) => (
              <li
                key={mo.uuid}
                className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 truncate">
                    <span className="font-mono font-semibold text-foreground">
                      {mo.code ?? mo.uuid.slice(0, 8)}
                    </span>
                    {mo.item_name && (
                      <span className="ml-2 text-muted-foreground">
                        {mo.item_name}
                      </span>
                    )}
                  </div>
                  <span className="whitespace-nowrap font-semibold tabular-nums">
                    {formatCompanyMoney(
                      mo.totals.total_cost,
                      prefs,
                      currencyOverride,
                    )}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span>
                    M{" "}
                    {formatCompanyMoney(
                      mo.totals.material_cost,
                      prefs,
                      currencyOverride,
                    )}
                    {mo.totals.planned_material_cost && (
                      <span className="opacity-60">
                        {" / "}
                        {formatCompanyMoney(
                          mo.totals.planned_material_cost,
                          prefs,
                          currencyOverride,
                        )}
                      </span>
                    )}
                  </span>
                  <span>
                    L{" "}
                    {formatCompanyMoney(
                      mo.totals.labour_cost,
                      prefs,
                      currencyOverride,
                    )}
                  </span>
                  <span>
                    X{" "}
                    {formatCompanyMoney(
                      mo.totals.machine_cost,
                      prefs,
                      currencyOverride,
                    )}
                  </span>
                  <span
                    className={cn(
                      "ml-auto rounded px-1.5 py-0.5 font-medium",
                      statusChipClass(mo.status),
                    )}
                  >
                    {mo.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function CostRow({
  swatch,
  label,
  value,
  hint,
  share,
}: {
  swatch: string;
  label: string;
  value: string;
  hint?: string;
  share: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn("size-2 shrink-0 rounded-full", swatch)}
        aria-hidden
      />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="ml-auto flex flex-col items-end leading-tight">
        <span className="font-semibold tabular-nums">{value}</span>
        {hint && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {hint}
          </span>
        )}
      </dd>
      <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">
        {share > 0 ? `${share.toFixed(0)}%` : "—"}
      </span>
    </div>
  );
}

// Stringified decimals from the API → number for arithmetic only.
// Rendering always goes through `formatCompanyMoney` so precision
// stays in the formatter's hands.
function safeNumber(v: string | null | undefined): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function statusChipClass(status: string): string {
  switch (status) {
    case "completed":
    case "verified":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400";
    case "in_progress":
    case "active":
      return "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-400";
    case "cancelled":
    case "rejected":
      return "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}
