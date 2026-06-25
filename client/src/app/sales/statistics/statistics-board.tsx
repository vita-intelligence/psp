"use client";

/**
 * Sales statistics dashboard. Five panels:
 *
 *   1. KPI strip — revenue this month, YTD, vs prior YTD, plus
 *      counts (invoices sent, active customers, avg invoice).
 *   2. Monthly revenue chart — bars for invoice revenue with
 *      credit-note overlay, line trace for the rolling net.
 *   3. Top customers table — last 12 months, with mini sparkline.
 *   4. Top items table — line revenue + qty.
 *   5. Lifecycle funnel — 5 stacked bars (lead → prospect → active
 *      → dormant → inactive).
 */

import { useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Box,
  Minus,
  Receipt,
  Users,
} from "lucide-react";
import type {
  CompanyDefaults,
  StatisticsFunnel,
  StatisticsMonthRow,
  StatisticsSnapshot,
  StatisticsTopCustomer,
  StatisticsTopItem,
} from "@/lib/types";
import {
  formatCompanyDate,
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";

interface Props {
  snapshot: StatisticsSnapshot | null;
  prefs: CompanyDefaults | null;
  baseCurrency: string;
}

export function StatisticsBoard({ snapshot, prefs, baseCurrency }: Props) {
  if (!snapshot || !prefs) {
    return (
      <p className="rounded-md border border-dashed border-border/60 px-4 py-12 text-center text-sm text-muted-foreground">
        Couldn&rsquo;t load the statistics snapshot. Try a refresh.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <KpiStrip kpis={snapshot.kpis} prefs={prefs} currency={baseCurrency} />

      {snapshot.excluded_currencies.length > 0 && (
        <ExcludedBanner currencies={snapshot.excluded_currencies} />
      )}

      <RevenueChart
        series={snapshot.revenue_by_month}
        prefs={prefs}
        currency={baseCurrency}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <TopCustomers
          rows={snapshot.top_customers}
          monthsCount={snapshot.revenue_by_month.length}
          prefs={prefs}
          currency={baseCurrency}
        />
        <TopItems
          rows={snapshot.top_items}
          prefs={prefs}
          currency={baseCurrency}
        />
      </div>

      <Funnel funnel={snapshot.funnel} />
    </div>
  );
}

// ============================================================
// KPI strip
// ============================================================

function KpiStrip({
  kpis,
  prefs,
  currency,
}: {
  kpis: StatisticsSnapshot["kpis"];
  prefs: CompanyDefaults;
  currency: string;
}) {
  const ytd = Number(kpis.revenue_ytd);
  const priorYtd = Number(kpis.revenue_prior_ytd);
  const yoyDelta = ytd - priorYtd;
  const yoyPct = priorYtd === 0 ? null : (yoyDelta / priorYtd) * 100;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi
        label="Revenue this month"
        value={formatCompanyMoney(kpis.revenue_this_month, prefs, {
          currency_code: currency,
        })}
        hint="Sent invoices, this calendar month"
      />
      <Kpi
        label="Revenue YTD"
        value={formatCompanyMoney(kpis.revenue_ytd, prefs, {
          currency_code: currency,
        })}
        hint={`vs ${formatCompanyMoney(kpis.revenue_prior_ytd, prefs, { currency_code: currency })} same period last year`}
      />
      <Kpi
        label="YoY"
        value={
          yoyPct === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span
              className={
                yoyDelta > 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : yoyDelta < 0
                    ? "text-destructive"
                    : "text-muted-foreground"
              }
            >
              {yoyDelta > 0 ? (
                <ArrowUpRight className="mr-1 inline size-4" />
              ) : yoyDelta < 0 ? (
                <ArrowDownRight className="mr-1 inline size-4" />
              ) : (
                <Minus className="mr-1 inline size-4" />
              )}
              {yoyPct.toFixed(1)}%
            </span>
          )
        }
        hint="YTD vs prior YTD"
      />
      <Kpi
        label="Invoices sent"
        value={formatCompanyNumber(kpis.invoices_sent_count, prefs)}
        hint="Last 24 months"
        icon={Receipt}
      />
      <Kpi
        label="Active customers"
        value={formatCompanyNumber(kpis.active_customers, prefs)}
        hint="At least one invoice this calendar year"
        icon={Users}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="size-3" />}
        {label}
      </div>
      <div className="mt-1.5 font-mono text-base font-semibold">{value}</div>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
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
          Revenue in {currencies.join(", ")} is excluded — settings &gt;
          Company &gt; Exchange rates needs a value for these currencies.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// Monthly revenue chart
// ============================================================

function RevenueChart({
  series,
  prefs,
  currency,
}: {
  series: StatisticsMonthRow[];
  prefs: CompanyDefaults;
  currency: string;
}) {
  const layout = useMemo(() => buildChartLayout(series), [series]);

  if (series.every((m) => Number(m.invoice_revenue) === 0)) {
    return (
      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="mb-4 flex items-center gap-2">
          <BarChart3 className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">
            Monthly revenue
          </h2>
        </header>
        <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
          No invoiced revenue yet in the last {series.length} months.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">
            Monthly revenue
          </h2>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <LegendDot tone="emerald" label="Invoice revenue" />
          <LegendDot tone="destructive" label="Credit notes" />
        </div>
      </header>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="w-full"
          style={{ minWidth: "640px" }}
        >
          <line
            x1={layout.left}
            x2={layout.right}
            y1={layout.zeroY}
            y2={layout.zeroY}
            stroke="currentColor"
            strokeOpacity="0.2"
          />

          {series.map((m, i) => {
            const x = layout.left + i * layout.colWidth;
            const barW = layout.colWidth * 0.7;
            const barX = x + (layout.colWidth - barW) / 2;

            const invH = Number(m.invoice_revenue) * layout.pixelsPerUnit;
            const cnH = Number(m.credit_notes) * layout.pixelsPerUnit;

            return (
              <g key={i}>
                {Number(m.invoice_revenue) > 0 && (
                  <rect
                    x={barX}
                    y={layout.zeroY - invH}
                    width={barW}
                    height={invH}
                    className="fill-emerald-500/80 dark:fill-emerald-400/70"
                  />
                )}
                {Number(m.credit_notes) > 0 && (
                  <rect
                    x={barX}
                    y={layout.zeroY}
                    width={barW}
                    height={cnH}
                    className="fill-destructive/70"
                  />
                )}
                <text
                  x={x + layout.colWidth / 2}
                  y={layout.height - 8}
                  textAnchor="middle"
                  className="fill-current text-[9px] text-muted-foreground"
                  fontSize="9"
                >
                  {monthLabel(m.month_start, prefs)}
                </text>
                {Number(m.net) !== 0 && (
                  <text
                    x={x + layout.colWidth / 2}
                    y={layout.zeroY - invH - 4}
                    textAnchor="middle"
                    className="fill-current text-[9px] font-mono"
                    fontSize="8"
                  >
                    {compactMoney(m.net, currency)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

interface ChartLayout {
  width: number;
  height: number;
  left: number;
  right: number;
  colWidth: number;
  zeroY: number;
  pixelsPerUnit: number;
}

function buildChartLayout(series: StatisticsMonthRow[]): ChartLayout {
  const width = Math.max(640, series.length * 60);
  const height = 240;
  const left = 24;
  const right = width - 16;

  const maxUp = Math.max(0, ...series.map((m) => Number(m.invoice_revenue)));
  const maxDown = Math.max(0, ...series.map((m) => Number(m.credit_notes)));

  const top = 28;
  const bottom = height - 28 - 14;
  const range = maxUp + maxDown || 1;
  const pixelsPerUnit = (bottom - top) / range;
  const zeroY = top + maxUp * pixelsPerUnit;

  const colWidth = (right - left) / series.length;

  return { width, height, left, right, colWidth, zeroY, pixelsPerUnit };
}

function monthLabel(iso: string, prefs: CompanyDefaults): string {
  const d = formatCompanyDate(iso, prefs);
  // formatCompanyDate gives a full date — show MM-YY.
  return d.slice(3);
}

function compactMoney(value: string, currency: string): string {
  const n = Number(value);
  if (Math.abs(n) >= 1000) {
    return `${(n / 1000).toFixed(1)}k ${currency}`;
  }
  return `${n.toFixed(0)} ${currency}`;
}

function LegendDot({
  tone,
  label,
}: {
  tone: "emerald" | "destructive";
  label: string;
}) {
  const cls =
    tone === "emerald" ? "bg-emerald-500/80" : "bg-destructive/70";
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block size-2 rounded-sm ${cls}`} />
      {label}
    </span>
  );
}

// ============================================================
// Top customers
// ============================================================

function TopCustomers({
  rows,
  monthsCount,
  prefs,
  currency,
}: {
  rows: StatisticsTopCustomer[];
  monthsCount: number;
  prefs: CompanyDefaults;
  currency: string;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card shadow-sm">
      <header className="border-b border-border/60 px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Users className="size-4 text-muted-foreground" />
          Top customers
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Ranked by revenue in the last {monthsCount} months
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-muted-foreground">
          No customer revenue yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/40">
          {rows.map((r) => (
            <li
              key={r.customer_id}
              className="flex items-center justify-between gap-3 px-5 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/sales/customers/${r.customer_id}`}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {r.customer_name}
                </Link>
                <Sparkline values={r.monthly_series} />
              </div>
              <span className="shrink-0 font-mono text-sm font-semibold">
                {formatCompanyMoney(r.revenue, prefs, { currency_code: currency })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Sparkline({ values }: { values: string[] }) {
  if (values.length < 2) return null;
  const nums = values.map((v) => Number(v));
  const max = Math.max(...nums, 1);
  const w = 100;
  const h = 18;
  const step = w / (nums.length - 1);
  const points = nums
    .map((n, i) => `${i * step},${h - (n / max) * h}`)
    .join(" ");

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="mt-0.5 text-emerald-600/80 dark:text-emerald-400/80"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

// ============================================================
// Top items
// ============================================================

function TopItems({
  rows,
  prefs,
  currency,
}: {
  rows: StatisticsTopItem[];
  prefs: CompanyDefaults;
  currency: string;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card shadow-sm">
      <header className="border-b border-border/60 px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Box className="size-4 text-muted-foreground" />
          Top items
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Ranked by invoice-line revenue
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-muted-foreground">
          No item lines in revenue invoices yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/40">
          {rows.map((r) => (
            <li
              key={r.item_id}
              className="flex items-center justify-between gap-3 px-5 py-2.5"
            >
              <div className="min-w-0 flex-1">
                {r.item_uuid ? (
                  <Link
                    href={`/items/${r.item_uuid}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {r.item_name}
                  </Link>
                ) : (
                  <span className="block truncate text-sm font-medium">
                    {r.item_name}
                  </span>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {formatCompanyNumber(r.qty, prefs)} units
                </p>
              </div>
              <span className="shrink-0 font-mono text-sm font-semibold">
                {formatCompanyMoney(r.revenue, prefs, { currency_code: currency })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ============================================================
// Lifecycle funnel
// ============================================================

function Funnel({ funnel }: { funnel: StatisticsFunnel }) {
  const stages: Array<{
    key: keyof StatisticsFunnel;
    label: string;
    tone: "muted" | "sky" | "emerald" | "amber" | "destructive";
    hint: string;
  }> = [
    { key: "lead", label: "Lead", tone: "muted", hint: "Never contacted" },
    {
      key: "prospect",
      label: "Prospect",
      tone: "sky",
      hint: "Contacted, no order yet",
    },
    {
      key: "active",
      label: "Active",
      tone: "emerald",
      hint: "Ordered + spoken to recently",
    },
    {
      key: "dormant",
      label: "Dormant",
      tone: "amber",
      hint: "Ordered, but quiet for 6+ months",
    },
    {
      key: "inactive",
      label: "Inactive",
      tone: "destructive",
      hint: "Manually suspended",
    },
  ];

  const total = stages.reduce((s, x) => s + (funnel[x.key] ?? 0), 0);

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Users className="size-4 text-muted-foreground" />
          Lifecycle funnel
        </h2>
        <p className="text-[11px] text-muted-foreground">
          {total} customer{total === 1 ? "" : "s"} in your registry
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-5">
        {stages.map((s) => {
          const value = funnel[s.key] ?? 0;
          const toneClass =
            s.tone === "destructive"
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : s.tone === "amber"
                ? "border-amber-300/60 bg-amber-50/40 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300"
                : s.tone === "emerald"
                  ? "border-emerald-300/60 bg-emerald-50/40 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300"
                  : s.tone === "sky"
                    ? "border-sky-300/60 bg-sky-50/40 text-sky-800 dark:border-sky-800/40 dark:bg-sky-950/20 dark:text-sky-300"
                    : "border-border/60 bg-muted/30 text-muted-foreground";
          return (
            <div
              key={s.key}
              className={`rounded-md border px-3 py-2.5 ${toneClass}`}
            >
              <div className="text-[10px] uppercase tracking-wider">
                {s.label}
              </div>
              <div className="mt-0.5 font-mono text-xl font-semibold">
                {value}
              </div>
              <p className="text-[10px] opacity-80">{s.hint}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
