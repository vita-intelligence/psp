"use client";

/**
 * Sales management dashboard. Three panels:
 *
 *   1. Leaderboard — one row per account manager, sorted by revenue
 *      YTD. Shows customers under their care, outstanding A/R,
 *      pipeline (confirmed COs not yet invoiced).
 *   2. CO funnel — value-weighted progression draft → submitted →
 *      approved → confirmed. Lets management see where deals stall.
 *   3. Unassigned customers — accounts with no account manager set.
 *      Each row links to the customer detail page where the manager
 *      can be assigned.
 */

import Link from "next/link";
import {
  AlertTriangle,
  CircleDashed,
  CheckCircle2,
  PenSquare,
  ShieldCheck,
  Trophy,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge-mini";
import type {
  CompanyDefaults,
  SalesManagementFunnelStage,
  SalesManagementLeaderRow,
  SalesManagementSnapshot,
  SalesManagementUnassignedRow,
} from "@/lib/types";
import {
  formatCompanyDate,
  formatCompanyMoney,
} from "@/lib/format/company";

interface Props {
  snapshot: SalesManagementSnapshot | null;
  prefs: CompanyDefaults | null;
  baseCurrency: string;
}

export function SalesManagementBoard({ snapshot, prefs, baseCurrency }: Props) {
  if (!snapshot || !prefs) {
    return (
      <p className="rounded-md border border-dashed border-border/60 px-4 py-12 text-center text-sm text-muted-foreground">
        Couldn&rsquo;t load the dashboard. Try a refresh.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {snapshot.excluded_currencies.length > 0 && (
        <ExcludedBanner currencies={snapshot.excluded_currencies} />
      )}

      <Leaderboard
        rows={snapshot.leaderboard}
        prefs={prefs}
        currency={baseCurrency}
      />

      <Funnel
        stages={snapshot.funnel}
        prefs={prefs}
        currency={baseCurrency}
      />

      <Unassigned rows={snapshot.unassigned} prefs={prefs} />
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
          Some {currencies.join(", ")} revenue is excluded — settings &gt;
          Company &gt; Exchange rates needs a value for these currencies.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// Leaderboard
// ============================================================

function Leaderboard({
  rows,
  prefs,
  currency,
}: {
  rows: SalesManagementLeaderRow[];
  prefs: CompanyDefaults;
  currency: string;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card shadow-sm">
      <header className="border-b border-border/60 px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Trophy className="size-4 text-muted-foreground" />
          Leaderboard
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Ranked by revenue YTD. Pipeline = sum of confirmed COs not yet
          invoiced.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-muted-foreground">
          No customers have an account manager assigned yet. Open a
          customer and pick one — they&rsquo;ll appear here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">#</th>
                <th className="px-4 py-2 text-left">Manager</th>
                <th className="px-4 py-2 text-right">Customers</th>
                <th className="px-4 py-2 text-right">Revenue YTD</th>
                <th className="px-4 py-2 text-right">Outstanding A/R</th>
                <th className="px-4 py-2 text-right">Pipeline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((r, i) => (
                <tr key={r.manager_id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-mono text-muted-foreground">
                    {i + 1}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{r.manager_name}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="font-mono font-medium">
                      {r.customers_count}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {r.approved_customers_count} approved
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                    {formatCompanyMoney(r.revenue_ytd, prefs, {
                      currency_code: currency,
                    })}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {Number(r.outstanding_ar) > 0 ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        {formatCompanyMoney(r.outstanding_ar, prefs, {
                          currency_code: currency,
                        })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {Number(r.pipeline_value) > 0 ? (
                      <span className="text-sky-700 dark:text-sky-400">
                        {formatCompanyMoney(r.pipeline_value, prefs, {
                          currency_code: currency,
                        })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ============================================================
// CO funnel
// ============================================================

const STAGE_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approver: "Pending approver",
  pending_director: "Pending director",
  approved: "Approved",
  confirmed: "Confirmed",
};

const STAGE_ICON: Record<string, typeof CircleDashed> = {
  draft: CircleDashed,
  pending_approver: PenSquare,
  pending_director: PenSquare,
  approved: ShieldCheck,
  confirmed: CheckCircle2,
};

function Funnel({
  stages,
  prefs,
  currency,
}: {
  stages: SalesManagementFunnelStage[];
  prefs: CompanyDefaults;
  currency: string;
}) {
  const maxValue = Math.max(
    1,
    ...stages.map((s) => Number(s.total_value)),
  );

  const totalCount = stages.reduce((sum, s) => sum + s.count, 0);
  const totalValue = stages.reduce(
    (sum, s) => sum + Number(s.total_value),
    0,
  );

  return (
    <section className="rounded-lg border border-border/60 bg-card shadow-sm">
      <header className="border-b border-border/60 px-5 py-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Users className="size-4 text-muted-foreground" />
              Customer-order funnel
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Value-weighted by status. Cancelled COs excluded.
            </p>
          </div>
          {totalCount > 0 && (
            <div className="text-right text-[11px]">
              <p className="text-muted-foreground">Total open</p>
              <p className="font-mono font-semibold">
                {totalCount} ·{" "}
                {formatCompanyMoney(totalValue.toFixed(2), prefs, {
                  currency_code: currency,
                })}
              </p>
            </div>
          )}
        </div>
      </header>

      {totalCount === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-muted-foreground">
          No open customer orders right now.
        </p>
      ) : (
        <ul className="space-y-2 px-5 py-4">
          {stages.map((stage) => {
            const Icon = STAGE_ICON[stage.stage] ?? CircleDashed;
            const value = Number(stage.total_value);
            const widthPct = maxValue > 0 ? (value / maxValue) * 100 : 0;

            return (
              <li key={stage.stage} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <Icon className="size-3 text-muted-foreground" />
                    {STAGE_LABEL[stage.stage] ?? stage.stage}
                    <Badge tone="muted">{stage.count}</Badge>
                  </span>
                  <span className="font-mono">
                    {formatCompanyMoney(stage.total_value, prefs, {
                      currency_code: currency,
                    })}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted/40">
                  <div
                    className="h-full bg-brand/70"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ============================================================
// Unassigned customers
// ============================================================

function Unassigned({
  rows,
  prefs,
}: {
  rows: SalesManagementUnassignedRow[];
  prefs: CompanyDefaults;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card shadow-sm">
      <header className="border-b border-border/60 px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <UserMinus className="size-4 text-muted-foreground" />
          Unassigned customers
          <Badge tone={rows.length > 0 ? "amber" : "muted"}>
            {rows.length}
          </Badge>
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Active customers with no account manager set. Click through
          to assign one.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-muted-foreground">
          Every active customer has an account manager. Nice.
        </p>
      ) : (
        <ul className="divide-y divide-border/40">
          {rows.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 px-5 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/sales/customers/${c.uuid}`}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {c.name}
                </Link>
                <p className="text-[11px] text-muted-foreground">
                  <Badge
                    tone={
                      c.approval_status === "approved"
                        ? "emerald"
                        : c.approval_status === "suspended"
                          ? "amber"
                          : c.approval_status === "rejected"
                            ? "destructive"
                            : "muted"
                    }
                  >
                    {c.approval_status}
                  </Badge>{" "}
                  · {c.total_orders_count} orders
                  {c.last_contact_at && (
                    <>
                      {" "}
                      · last contact{" "}
                      {formatCompanyDate(c.last_contact_at, prefs)}
                    </>
                  )}
                  {!c.last_contact_at && " · never contacted"}
                </p>
              </div>
              <Link
                href={`/sales/customers/${c.uuid}`}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              >
                <UserPlus className="size-3" />
                Assign
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
