"use client";

/**
 * Cash-flow dashboard. Four panels:
 *
 *   1. KPI strip — outstanding A/R + projected A/R + outstanding A/P
 *      + planned A/P + net position.
 *   2. Overdue card — anything past today that hasn't cleared.
 *   3. Weekly stacked bar chart — 12 weeks. Green stacks above the
 *      zero line (inflows), red stacks below (outflows). A single
 *      line trace shows the running cumulative balance.
 *   4. Detail table — same numbers per week for the operator who
 *      wants to read exact figures.
 *
 * Everything in the company's base currency; foreign-currency rows
 * the FX feed doesn't cover surface as a yellow banner so the
 * operator knows the chart is missing data.
 */

import { useMemo } from "react";
import { AlertTriangle, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import type {
  CashFlowBucket,
  CashFlowForecast,
  CompanyDefaults,
} from "@/lib/types";
import { formatCompanyMoney, formatCompanyDate } from "@/lib/format/company";

interface Props {
  forecast: CashFlowForecast | null;
  prefs: CompanyDefaults | null;
  baseCurrency: string;
}

export function CashFlowBoard({ forecast, prefs, baseCurrency }: Props) {
  if (!forecast || !prefs) {
    return (
      <p className="rounded-md border border-dashed border-border/60 px-4 py-12 text-center text-sm text-muted-foreground">
        Couldn&rsquo;t load the cash-flow forecast. Try a refresh.
      </p>
    );
  }

  const totals = forecast.totals;
  const overdue = forecast.overdue;
  const buckets = forecast.buckets;

  return (
    <div className="space-y-6">
      <KpiStrip totals={totals} prefs={prefs} currency={baseCurrency} />

      {forecast.excluded_currencies.length > 0 && (
        <ExcludedBanner currencies={forecast.excluded_currencies} />
      )}

      <OverdueCard overdue={overdue} prefs={prefs} currency={baseCurrency} />

      <ChartCard buckets={buckets} prefs={prefs} currency={baseCurrency} />

      <DetailTable buckets={buckets} prefs={prefs} currency={baseCurrency} />
    </div>
  );
}

// ============================================================
// KPI strip
// ============================================================

function KpiStrip({
  totals,
  prefs,
  currency,
}: {
  totals: CashFlowForecast["totals"];
  prefs: CompanyDefaults;
  currency: string;
}) {
  const cards = [
    {
      label: "Outstanding A/R",
      value: totals.outstanding_ar,
      tone: "emerald" as const,
      icon: TrendingUp,
      hint: "Sent + partially-paid invoices",
    },
    {
      label: "Projected A/R",
      value: totals.projected_ar,
      tone: "sky" as const,
      icon: TrendingUp,
      hint: "Confirmed COs awaiting invoice",
    },
    {
      label: "Outstanding A/P",
      value: totals.outstanding_ap,
      tone: "amber" as const,
      icon: TrendingDown,
      hint: "Received + disputed supplier invoices",
    },
    {
      label: "Planned A/P",
      value: totals.planned_ap,
      tone: "amber" as const,
      icon: TrendingDown,
      hint: "Open POs awaiting receipt",
    },
    {
      label: "Net position",
      value: totals.net_position,
      tone:
        Number(totals.net_position) >= 0
          ? ("emerald" as const)
          : ("destructive" as const),
      icon: Wallet,
      hint: "Inflows − outflows over the horizon",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => {
        const Icon = c.icon;
        const toneClass =
          c.tone === "emerald"
            ? "text-emerald-700 dark:text-emerald-400"
            : c.tone === "amber"
              ? "text-amber-700 dark:text-amber-400"
              : c.tone === "destructive"
                ? "text-destructive"
                : "text-sky-700 dark:text-sky-400";

        return (
          <div
            key={c.label}
            className="rounded-lg border border-border/60 bg-card p-3 shadow-sm"
          >
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Icon className={`size-3 ${toneClass}`} />
              {c.label}
            </div>
            <div className={`mt-1.5 font-mono text-base font-semibold ${toneClass}`}>
              {formatCompanyMoney(c.value, prefs, { currency_code: currency })}
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{c.hint}</p>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Overdue card
// ============================================================

function OverdueCard({
  overdue,
  prefs,
  currency,
}: {
  overdue: CashFlowForecast["overdue"];
  prefs: CompanyDefaults;
  currency: string;
}) {
  const total =
    Number(overdue.ar_due) +
    Number(overdue.ar_projected) +
    Number(overdue.ap_due) +
    Number(overdue.ap_planned);

  if (total === 0) return null;

  return (
    <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-destructive">
            <AlertTriangle className="size-4" />
            Past due
          </h2>
          <p className="text-xs text-muted-foreground">
            Invoices / POs whose target date has already passed. Chase the
            A/R; settle the A/P (or dispute it).
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Net overdue
          </p>
          <p className="font-mono text-base font-semibold">
            {formatCompanyMoney(overdue.net, prefs, { currency_code: currency })}
          </p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <OverdueLine
          label="A/R due"
          value={overdue.ar_due}
          prefs={prefs}
          currency={currency}
          tone="emerald"
        />
        <OverdueLine
          label="A/R projected"
          value={overdue.ar_projected}
          prefs={prefs}
          currency={currency}
          tone="sky"
        />
        <OverdueLine
          label="A/P due"
          value={overdue.ap_due}
          prefs={prefs}
          currency={currency}
          tone="amber"
        />
        <OverdueLine
          label="A/P planned"
          value={overdue.ap_planned}
          prefs={prefs}
          currency={currency}
          tone="amber"
        />
      </dl>
    </section>
  );
}

function OverdueLine({
  label,
  value,
  prefs,
  currency,
  tone,
}: {
  label: string;
  value: string;
  prefs: CompanyDefaults;
  currency: string;
  tone: "emerald" | "sky" | "amber";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "sky"
        ? "text-sky-700 dark:text-sky-400"
        : "text-amber-700 dark:text-amber-400";

  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className={`mt-0.5 font-mono ${toneClass}`}>
        {formatCompanyMoney(value, prefs, { currency_code: currency })}
      </dd>
    </div>
  );
}

// ============================================================
// Excluded-currencies banner
// ============================================================

function ExcludedBanner({ currencies }: { currencies: string[] }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div>
        <p className="font-medium">FX rate missing</p>
        <p>
          {currencies.join(", ")} amounts are excluded — settings &gt;
          Company &gt; Exchange rates needs a value for these currencies
          before they&rsquo;ll contribute to the forecast.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// Chart (pure SVG — no external deps)
// ============================================================

function ChartCard({
  buckets,
  prefs,
  currency,
}: {
  buckets: CashFlowBucket[];
  prefs: CompanyDefaults;
  currency: string;
}) {
  const layout = useMemo(() => buildLayout(buckets), [buckets]);

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">12-week forecast</h2>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <LegendDot tone="emerald" label="A/R inflow" />
          <LegendDot tone="sky" label="Projected" />
          <LegendDot tone="amber" label="A/P outflow" />
          <LegendDot tone="brand" label="Cumulative" />
        </div>
      </header>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="w-full"
          style={{ minWidth: "640px" }}
        >
          {/* Zero baseline */}
          <line
            x1={layout.left}
            x2={layout.right}
            y1={layout.zeroY}
            y2={layout.zeroY}
            stroke="currentColor"
            strokeOpacity="0.2"
          />

          {/* Bars */}
          {buckets.map((b, i) => {
            const x = layout.left + i * layout.colWidth;
            const inflow = Number(b.ar_due) + Number(b.ar_projected);
            const outflow = Number(b.ap_due) + Number(b.ap_planned);

            const arDueH = scaledH(Number(b.ar_due), layout);
            const arProjH = scaledH(Number(b.ar_projected), layout);
            const apDueH = scaledH(Number(b.ap_due), layout);
            const apPlanH = scaledH(Number(b.ap_planned), layout);

            const barW = layout.colWidth * 0.7;
            const barX = x + (layout.colWidth - barW) / 2;

            return (
              <g key={i}>
                {/* Inflow stack — above zero */}
                {Number(b.ar_due) > 0 && (
                  <rect
                    x={barX}
                    y={layout.zeroY - arDueH}
                    width={barW}
                    height={arDueH}
                    className="fill-emerald-500/80 dark:fill-emerald-400/70"
                  />
                )}
                {Number(b.ar_projected) > 0 && (
                  <rect
                    x={barX}
                    y={layout.zeroY - arDueH - arProjH}
                    width={barW}
                    height={arProjH}
                    className="fill-sky-500/70 dark:fill-sky-400/60"
                  />
                )}

                {/* Outflow stack — below zero */}
                {Number(b.ap_due) > 0 && (
                  <rect
                    x={barX}
                    y={layout.zeroY}
                    width={barW}
                    height={apDueH}
                    className="fill-amber-500/80 dark:fill-amber-400/70"
                  />
                )}
                {Number(b.ap_planned) > 0 && (
                  <rect
                    x={barX}
                    y={layout.zeroY + apDueH}
                    width={barW}
                    height={apPlanH}
                    className="fill-amber-300/70 dark:fill-amber-200/50"
                  />
                )}

                {/* Week label */}
                <text
                  x={x + layout.colWidth / 2}
                  y={layout.height - 8}
                  textAnchor="middle"
                  className="fill-current text-[9px] text-muted-foreground"
                  fontSize="9"
                >
                  {labelForWeek(b.week_start, prefs)}
                </text>

                {/* Net label */}
                {(inflow !== 0 || outflow !== 0) && (
                  <text
                    x={x + layout.colWidth / 2}
                    y={
                      Number(b.net) >= 0
                        ? layout.zeroY - arDueH - arProjH - 4
                        : layout.zeroY + apDueH + apPlanH + 10
                    }
                    textAnchor="middle"
                    className="fill-current text-[9px] font-mono"
                    fontSize="8"
                  >
                    {compactMoney(b.net, currency)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Cumulative line */}
          {layout.cumLine.length > 1 && (
            <polyline
              points={layout.cumLine.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-brand"
            />
          )}
          {layout.cumLine.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="2.5"
              className="fill-brand"
            />
          ))}
        </svg>
      </div>
    </section>
  );
}

function LegendDot({
  tone,
  label,
}: {
  tone: "emerald" | "sky" | "amber" | "brand";
  label: string;
}) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-500/80"
      : tone === "sky"
        ? "bg-sky-500/70"
        : tone === "amber"
          ? "bg-amber-500/80"
          : "bg-brand";
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block size-2 rounded-sm ${cls}`} />
      {label}
    </span>
  );
}

interface Layout {
  width: number;
  height: number;
  left: number;
  right: number;
  colWidth: number;
  zeroY: number;
  pixelsPerUnit: number;
  cumLine: Array<{ x: number; y: number }>;
}

function buildLayout(buckets: CashFlowBucket[]): Layout {
  const width = Math.max(640, buckets.length * 70);
  const height = 280;
  const left = 32;
  const right = width - 16;

  const inflows = buckets.map((b) =>
    Math.max(0, Number(b.ar_due) + Number(b.ar_projected)),
  );
  const outflows = buckets.map((b) =>
    Math.max(0, Number(b.ap_due) + Number(b.ap_planned)),
  );
  const cumulatives = buckets.map((b) => Number(b.cumulative));

  const maxUp = Math.max(0, ...inflows, ...cumulatives);
  const maxDown = Math.max(0, ...outflows, ...cumulatives.map((v) => -v));

  const usableTop = 30;
  const usableBottom = 30;
  const topY = usableTop;
  const bottomY = height - usableBottom - 14; // leave room for week labels
  const range = maxUp + maxDown || 1;
  const pixelsPerUnit = (bottomY - topY) / range;
  const zeroY = topY + maxUp * pixelsPerUnit;

  const colWidth = (right - left) / buckets.length;

  const cumLine = buckets.map((b, i) => ({
    x: left + i * colWidth + colWidth / 2,
    y: zeroY - Number(b.cumulative) * pixelsPerUnit,
  }));

  return {
    width,
    height,
    left,
    right,
    colWidth,
    zeroY,
    pixelsPerUnit,
    cumLine,
  };
}

function scaledH(value: number, layout: Layout): number {
  return Math.max(0, value) * layout.pixelsPerUnit;
}

function labelForWeek(weekStartIso: string, prefs: CompanyDefaults): string {
  return formatCompanyDate(weekStartIso, prefs).slice(0, 5);
}

function compactMoney(value: string, currency: string): string {
  const n = Number(value);
  if (Math.abs(n) >= 1000) {
    return `${(n / 1000).toFixed(1)}k ${currency}`;
  }
  return `${n.toFixed(0)} ${currency}`;
}

// ============================================================
// Detail table
// ============================================================

function DetailTable({
  buckets,
  prefs,
  currency,
}: {
  buckets: CashFlowBucket[];
  prefs: CompanyDefaults;
  currency: string;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card shadow-sm">
      <header className="border-b border-border/60 px-5 py-3">
        <h2 className="text-sm font-semibold tracking-tight">Week-by-week</h2>
        <p className="text-[11px] text-muted-foreground">
          Exact figures for each bucket. Net = inflows − outflows;
          cumulative is the running balance from week 0.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Week</th>
              <th className="px-4 py-2 text-right">A/R due</th>
              <th className="px-4 py-2 text-right">A/R projected</th>
              <th className="px-4 py-2 text-right">A/P due</th>
              <th className="px-4 py-2 text-right">A/P planned</th>
              <th className="px-4 py-2 text-right">Net</th>
              <th className="px-4 py-2 text-right">Cumulative</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {buckets.map((b) => (
              <tr key={b.week_index}>
                <td className="px-4 py-2">
                  <span className="font-medium">W{b.week_index}</span>{" "}
                  <span className="text-muted-foreground">
                    · {formatCompanyDate(b.week_start, prefs)}
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-mono text-emerald-700 dark:text-emerald-400">
                  {Number(b.ar_due) > 0
                    ? formatCompanyMoney(b.ar_due, prefs, { currency_code: currency })
                    : "—"}
                </td>
                <td className="px-4 py-2 text-right font-mono text-sky-700 dark:text-sky-400">
                  {Number(b.ar_projected) > 0
                    ? formatCompanyMoney(b.ar_projected, prefs, { currency_code: currency })
                    : "—"}
                </td>
                <td className="px-4 py-2 text-right font-mono text-amber-700 dark:text-amber-400">
                  {Number(b.ap_due) > 0
                    ? formatCompanyMoney(b.ap_due, prefs, { currency_code: currency })
                    : "—"}
                </td>
                <td className="px-4 py-2 text-right font-mono text-amber-700 dark:text-amber-400">
                  {Number(b.ap_planned) > 0
                    ? formatCompanyMoney(b.ap_planned, prefs, { currency_code: currency })
                    : "—"}
                </td>
                <td
                  className={`px-4 py-2 text-right font-mono ${
                    Number(b.net) > 0
                      ? "text-emerald-700 dark:text-emerald-400"
                      : Number(b.net) < 0
                        ? "text-destructive"
                        : "text-muted-foreground/50"
                  }`}
                >
                  {Number(b.net) !== 0
                    ? formatCompanyMoney(b.net, prefs, { currency_code: currency })
                    : "—"}
                </td>
                <td
                  className={`px-4 py-2 text-right font-mono font-semibold ${
                    Number(b.cumulative) >= 0
                      ? ""
                      : "text-destructive"
                  }`}
                >
                  {formatCompanyMoney(b.cumulative, prefs, { currency_code: currency })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
