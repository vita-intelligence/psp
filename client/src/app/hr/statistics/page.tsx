import Link from "next/link";
import { redirect } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { PageHeader } from "@/components/layout/page-header";
import { getCompanyDefaults } from "@/lib/company/server";
import { getHRStatistics } from "@/lib/hr/server";
import {
  formatCompanyMoney,
  formatCompanyNumber,
  type FormatPrefs,
} from "@/lib/format/company";
import { cn } from "@/lib/utils";
import type { HRStatisticsRow, HRStatisticsSummary } from "@/lib/hr/types";
import { WindowSelect } from "./window-select";

export const metadata = { title: "Statistics · HR · PSP" };
export const dynamic = "force-dynamic";

function formatHours(seconds: number): string {
  if (seconds <= 0) return "0h";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function repTone(score: number): string {
  if (score >= 700) return "text-emerald-700 dark:text-emerald-400";
  if (score >= 550) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

function perfTone(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  if (pct >= 90) return "text-emerald-700 dark:text-emerald-400";
  if (pct >= 70) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

export default async function HRStatisticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "hr.view")) redirect("/");

  const { days: daysParam } = await searchParams;
  const days = parseWindow(daysParam);

  const [summary, prefs] = await Promise.all([
    getHRStatistics(days),
    getCompanyDefaults(),
  ]);

  if (!prefs) redirect("/");

  const rows = summary?.rows ?? [];
  const totals = summary?.totals ?? {
    employees: 0,
    shift_count: 0,
    shift_seconds: 0,
    session_count: 0,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={TrendingUp}
        title="Statistics"
        description={`Aggregate metrics per worker across the past ${days} day${days === 1 ? "" : "s"}. Numbers are computed live off shifts + sessions + wages so they never drift from the ledgers.`}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <WindowSelect selected={days} />
      </div>

      <StatsTotals summary={summary} totals={totals} prefs={prefs} />

      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="mb-4 flex items-baseline gap-2">
          <h2 className="text-sm font-semibold tracking-tight">Per-employee</h2>
          <span className="text-[11px] text-muted-foreground">
            · {rows.length} shown
          </span>
        </header>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No active employees in the window.
          </p>
        ) : (
          <StatsTable rows={rows} prefs={prefs} />
        )}
      </section>
    </div>
  );
}

function StatsTotals({
  summary,
  totals,
  prefs,
}: {
  summary: HRStatisticsSummary | null;
  totals: HRStatisticsSummary["totals"];
  prefs: FormatPrefs;
}) {
  if (!summary) return null;
  const kpi = [
    { label: "Employees", value: String(totals.employees) },
    { label: "Shifts", value: String(totals.shift_count) },
    { label: "Hours worked", value: formatHours(totals.shift_seconds) },
    { label: "Sessions", value: String(totals.session_count) },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {kpi.map((k) => (
        <div
          key={k.label}
          className="rounded-lg border border-border/60 bg-card p-4"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {k.label}
          </p>
          <p className="mt-1 text-lg font-mono font-semibold tabular-nums">
            {k.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function StatsTable({
  rows,
  prefs,
}: {
  rows: HRStatisticsRow[];
  prefs: FormatPrefs;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pr-3 font-semibold">Employee</th>
            <th className="py-2 pr-3 text-right font-semibold">Shifts</th>
            <th className="py-2 pr-3 text-right font-semibold">Hours</th>
            <th className="py-2 pr-3 text-right font-semibold">Sessions</th>
            <th className="py-2 pr-3 text-right font-semibold">Avg perf</th>
            <th className="py-2 pr-3 text-right font-semibold">Rate</th>
            <th className="py-2 pr-3 text-right font-semibold">Est. labour</th>
            <th className="py-2 text-right font-semibold">Reputation</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.map((r) => (
            <tr key={r.employee.uuid}>
              <td className="py-2 pr-3">
                <Link
                  href={`/hr/employees/${r.employee.uuid}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {r.employee.name}
                </Link>
                {r.employee.is_qa && (
                  <span className="ml-2 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
                    QA
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                {r.shift_count}
              </td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                {formatHours(r.shift_seconds ?? 0)}
              </td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                {r.session_count}
              </td>
              <td
                className={cn(
                  "py-2 pr-3 text-right font-mono tabular-nums",
                  perfTone(r.avg_performance),
                )}
              >
                {r.avg_performance == null
                  ? "—"
                  : `${formatCompanyNumber(r.avg_performance, prefs)}%`}
              </td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                {r.hourly_rate?.hourly_rate
                  ? formatCompanyMoney(r.hourly_rate.hourly_rate, prefs, {
                      currency_code: r.hourly_rate.currency_code,
                    })
                  : "—"}
              </td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                {r.estimated_labour_cost
                  ? formatCompanyMoney(r.estimated_labour_cost, prefs, {
                      currency_code: r.hourly_rate?.currency_code,
                    })
                  : "—"}
              </td>
              <td
                className={cn(
                  "py-2 text-right font-mono font-semibold tabular-nums",
                  repTone(r.employee.reputation_score),
                )}
              >
                {r.employee.reputation_score}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseWindow(v: string | undefined): number {
  const n = Number(v);
  if (Number.isFinite(n) && n >= 1 && n <= 365) return Math.floor(n);
  return 30;
}
