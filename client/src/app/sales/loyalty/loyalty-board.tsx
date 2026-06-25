"use client";

/**
 * Loyalty dashboard board. Four panels:
 *
 *   1. Programs grid — one card per program with tiers + lifecycle
 *      chips. Manage-permission users get edit / default / activate
 *      action buttons + a "New program" CTA at top-right.
 *   2. Customer balance leaderboard — top-20 by credit balance.
 *   3. Recent ledger — the last 25 accrual/grant/apply events.
 *   4. FX-excluded banner — shown only when the BE reports missing
 *      rates for currencies present in the data set.
 */

import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CircleSlash,
  Plus,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { Badge } from "@/components/ui/badge-mini";
import { Button } from "@/components/ui/button";
import type {
  CompanyDefaults,
  CustomerCredit,
  LoyaltyDashboard,
  LoyaltyPerCustomerRow,
  LoyaltyProgram,
} from "@/lib/types";
import {
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";

interface Props {
  dashboard: LoyaltyDashboard | null;
  prefs: CompanyDefaults | null;
  canManage: boolean;
  canGrant: boolean;
}

export function LoyaltyBoard({ dashboard, prefs, canManage, canGrant }: Props) {
  if (!dashboard || !prefs) {
    return (
      <p className="rounded-md border border-dashed border-border/60 px-4 py-12 text-center text-sm text-muted-foreground">
        Couldn&rsquo;t load the loyalty dashboard. Try a refresh.
      </p>
    );
  }

  // FX-excluded list isn't guaranteed by the BE — guard the access.
  const excluded = dashboard.excluded_currencies ?? [];

  return (
    <div className="space-y-6">
      {excluded.length > 0 && <ExcludedBanner currencies={excluded} />}

      <ProgramsGrid
        programs={dashboard.programs}
        prefs={prefs}
        baseCurrency={dashboard.base_currency}
        canManage={canManage}
      />

      <Leaderboard
        rows={dashboard.per_customer}
        prefs={prefs}
        baseCurrency={dashboard.base_currency}
      />

      <RecentLedger
        rows={dashboard.recent_ledger}
        prefs={prefs}
        canGrant={canGrant}
      />
    </div>
  );
}

// ============================================================
// FX-excluded banner
// ============================================================

function ExcludedBanner({ currencies }: { currencies: string[] }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div>
        <p className="font-medium">FX rate missing</p>
        <p>
          Some {currencies.join(", ")} balances are excluded — settings &gt;
          Company &gt; Exchange rates needs a value for these currencies.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// Programs grid
// ============================================================

function ProgramsGrid({
  programs,
  prefs,
  baseCurrency,
  canManage,
}: {
  programs: LoyaltyProgram[];
  prefs: CompanyDefaults;
  baseCurrency: string;
  canManage: boolean;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card shadow-sm">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 px-5 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Sparkles className="size-4 text-muted-foreground" />
            Programs
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Tiered rebate schemes. The default program applies to every
            customer who isn&rsquo;t individually enrolled elsewhere.
          </p>
        </div>
        {canManage && (
          <Button asChild size="sm">
            <Link href="/sales/loyalty/programs/new">
              <Plus className="mr-1.5 size-4" />
              New program
            </Link>
          </Button>
        )}
      </header>

      {programs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Sparkles className="size-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">No programs yet</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Add a tiered rebate to start rewarding repeat customers. A
              typical setup: 5% over £10k YTD, 7.5% over £25k, 10% over £50k.
            </p>
          </div>
          {canManage && (
            <Button asChild size="sm">
              <Link href="/sales/loyalty/programs/new">
                <Plus className="mr-1.5 size-4" />
                Create the first program
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <ul className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((p) => (
            <ProgramCard
              key={p.id}
              program={p}
              prefs={prefs}
              baseCurrency={baseCurrency}
              canManage={canManage}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProgramCard({
  program,
  prefs,
  baseCurrency,
  canManage,
}: {
  program: LoyaltyProgram;
  prefs: CompanyDefaults;
  baseCurrency: string;
  canManage: boolean;
}) {
  const sortedTiers = [...program.tiers].sort(
    (a, b) => Number(a.min_threshold) - Number(b.min_threshold),
  );

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border/60 bg-background/50 p-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {program.is_default && (
            <Badge tone="indigo">
              <Star className="size-3" />
              Default
            </Badge>
          )}
          <Badge tone={program.is_active ? "emerald" : "muted"}>
            {program.is_active ? "Active" : "Inactive"}
          </Badge>
          {program.code && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {program.code}
            </span>
          )}
        </div>
        <Link
          href={`/sales/loyalty/programs/${program.uuid}`}
          className="block text-sm font-semibold tracking-tight hover:underline"
        >
          {program.name}
        </Link>
        {program.description && (
          <p className="line-clamp-2 text-[11px] text-muted-foreground">
            {program.description}
          </p>
        )}
        <div className="flex flex-wrap gap-1">
          <Badge tone="muted">{schemeLabel(program.scheme)}</Badge>
          <Badge tone="muted">{basisLabel(program.basis)}</Badge>
          <Badge tone="muted">{payoutLabel(program.payout_kind)}</Badge>
        </div>
      </div>

      <div className="rounded-md border border-border/40 bg-muted/20 p-2">
        {sortedTiers.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            No tiers yet — open the program to add thresholds.
          </p>
        ) : (
          <ul className="space-y-1 text-[11px]">
            {sortedTiers.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Target className="size-3 text-muted-foreground" />
                  <span className="font-mono">
                    {formatCompanyMoney(t.min_threshold, prefs, {
                      currency_code: baseCurrency,
                    })}
                    +
                  </span>
                  {t.label && (
                    <span className="text-muted-foreground">{t.label}</span>
                  )}
                </span>
                <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                  {formatCompanyNumber(t.rate_pct, prefs)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManage && (
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <Link href={`/sales/loyalty/programs/${program.uuid}`}>
              Open
            </Link>
          </Button>
        </div>
      )}
    </li>
  );
}

function schemeLabel(s: LoyaltyProgram["scheme"]): string {
  return s === "tiered_rebate" ? "Tiered rebate" : s;
}

function basisLabel(b: LoyaltyProgram["basis"]): string {
  return b === "ytd_revenue" ? "YTD revenue" : b;
}

function payoutLabel(p: LoyaltyProgram["payout_kind"]): string {
  return p === "credit" ? "Credit payout" : p;
}

// ============================================================
// Customer balance leaderboard
// ============================================================

function Leaderboard({
  rows,
  prefs,
  baseCurrency,
}: {
  rows: LoyaltyPerCustomerRow[];
  prefs: CompanyDefaults;
  baseCurrency: string;
}) {
  // BE doesn't guarantee an ordering — sort defensively.
  const sorted = [...rows]
    .sort((a, b) => Number(b.balance) - Number(a.balance))
    .slice(0, 20);

  return (
    <section className="rounded-lg border border-border/60 bg-card shadow-sm">
      <header className="border-b border-border/60 px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Trophy className="size-4 text-muted-foreground" />
          Customer balances
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Top 20 by credit balance. Balance = total earned − total applied.
        </p>
      </header>

      {sorted.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-muted-foreground">
          Nobody has accrued credit yet. Once invoices get paid and a
          customer crosses a tier, their balance will show up here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">#</th>
                <th className="px-4 py-2 text-left">Customer</th>
                <th className="px-4 py-2 text-left">Currency</th>
                <th className="px-4 py-2 text-right">Balance</th>
                <th className="px-4 py-2 text-right">Total earned</th>
                <th className="px-4 py-2 text-right">Total applied</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {sorted.map((r, i) => (
                <tr
                  key={`${r.customer?.id ?? "anon"}-${r.currency_code}`}
                  className="hover:bg-muted/20"
                >
                  <td className="px-4 py-2.5 font-mono text-muted-foreground">
                    {i + 1}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.customer ? (
                      <Link
                        href={`/sales/customers/${r.customer.uuid}`}
                        className="font-medium hover:underline"
                      >
                        {r.customer.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] uppercase text-muted-foreground">
                      {r.currency_code || baseCurrency}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                    {formatCompanyMoney(r.balance, prefs, {
                      currency_code: r.currency_code || baseCurrency,
                    })}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                    {formatCompanyMoney(r.total_earned, prefs, {
                      currency_code: r.currency_code || baseCurrency,
                    })}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                    {formatCompanyMoney(r.total_applied, prefs, {
                      currency_code: r.currency_code || baseCurrency,
                    })}
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
// Recent ledger
// ============================================================

const KIND_TONE: Record<
  CustomerCredit["kind"],
  "emerald" | "sky" | "amber"
> = {
  manual_grant: "emerald",
  rebate_accrual: "sky",
  applied_to_invoice: "amber",
};

const KIND_LABEL: Record<CustomerCredit["kind"], string> = {
  manual_grant: "Granted",
  rebate_accrual: "Accrued",
  applied_to_invoice: "Applied",
};

function RecentLedger({
  rows,
  prefs,
  canGrant,
}: {
  rows: CustomerCredit[];
  prefs: CompanyDefaults;
  canGrant: boolean;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card shadow-sm">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 px-5 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Users className="size-4 text-muted-foreground" />
            Recent ledger
          </h2>
          <p className="text-[11px] text-muted-foreground">
            The last 25 credit events across all customers — grants,
            accruals on paid invoices, and applications against open ones.
          </p>
        </div>
        {canGrant && (
          <p className="text-[11px] text-muted-foreground">
            Grant or redeem credit from the customer detail page.
          </p>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-muted-foreground">
          No ledger activity yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/40">
          {rows.map((r) => (
            <LedgerRow key={r.id} row={r} prefs={prefs} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LedgerRow({
  row,
  prefs,
}: {
  row: CustomerCredit;
  prefs: CompanyDefaults;
}) {
  const amount = Number(row.amount);
  const isNegative = amount < 0;
  const Icon = isNegative ? ArrowDownRight : ArrowUpRight;
  const colorClass = isNegative
    ? "text-amber-700 dark:text-amber-400"
    : "text-emerald-700 dark:text-emerald-400";

  const occurredAt = row.inserted_at;

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5">
      <Badge tone={KIND_TONE[row.kind]}>{KIND_LABEL[row.kind]}</Badge>
      <div className="min-w-0">
        <p className="truncate text-xs">
          {row.customer ? (
            <Link
              href={`/sales/customers/${row.customer.uuid}`}
              className="font-medium hover:underline"
            >
              {row.customer.name}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {row.source_invoice && (
            <>
              {" · "}
              <Link
                href={`/sales/invoices/${row.source_invoice.uuid}`}
                className="text-muted-foreground hover:underline"
              >
                {row.source_invoice.code ?? `#${row.source_invoice.id}`}
              </Link>
            </>
          )}
          {row.credit_note_invoice && (
            <>
              {" · credit note "}
              <Link
                href={`/sales/invoices/${row.credit_note_invoice.uuid}`}
                className="text-muted-foreground hover:underline"
              >
                {row.credit_note_invoice.code ??
                  `#${row.credit_note_invoice.id}`}
              </Link>
            </>
          )}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {row.reason ?? (
            <span className="inline-flex items-center gap-1">
              <CircleSlash className="size-3" />
              No reason given
            </span>
          )}
          {" · "}
          {formatDistanceToNowStrict(new Date(occurredAt), {
            addSuffix: true,
          })}
        </p>
      </div>
      <div className={`text-right font-mono text-sm font-semibold ${colorClass}`}>
        <span className="inline-flex items-center gap-1">
          <Icon className="size-3.5" />
          {formatCompanyMoney(
            isNegative ? String(-amount) : String(amount),
            prefs,
            { currency_code: row.currency_code },
          )}
        </span>
      </div>
    </li>
  );
}
