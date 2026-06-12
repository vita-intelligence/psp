"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import {
  refreshCurrencyRatesNowAction,
  setCurrencyRatesAutoPullAction,
} from "@/lib/company/bag-actions";
import type { CurrencyRate } from "@/lib/company/bags";
import type { Company } from "@/lib/types";
import { Coins, Globe, Loader2, RefreshCw } from "lucide-react";

interface Props {
  company: Company;
  canEdit: boolean;
}

function normalize(input: unknown): CurrencyRate[] {
  const bag = (input ?? {}) as { rates?: unknown };
  const rates = Array.isArray(bag.rates) ? bag.rates : [];
  return rates
    .filter(
      (r): r is CurrencyRate =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as CurrencyRate).currency === "string",
    )
    .map((r) => ({
      currency: r.currency.toUpperCase(),
      rate: Number(r.rate) || 0,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Exchange rates section. Deliberately stripped down:
 *
 *   - The ECB feed is the source of truth.
 *   - The only user action is `Refresh now`.
 *   - No add / remove / pick / save / edit — the rate list is owned
 *     by the feed.
 *
 * Companies that flipped auto-pull off (legacy / explicit choice) see
 * an empty-state CTA that re-enables it. That's the single escape
 * hatch back to the simple flow.
 */
export function CurrencyRatesForm({ company, canEdit }: Props) {
  useFormPresenceBeacon("company:1");

  const base = company.currency_code;
  const autoPull = company.currency_rates_auto_pull;
  const rates = normalize(company.currency_rates);
  const stamp = company.currency_rates_pulled_at;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Exchange rates</CardTitle>
        <CardDescription>
          Used to convert vendor invoices, POs, and the AP ledger into{" "}
          <strong>{base}</strong>. Auto-updated daily at 08:00 UTC from the{" "}
          European Central Bank reference feed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {autoPull ? (
          <AutoPullView
            rates={rates}
            base={base}
            stamp={stamp}
            canEdit={canEdit}
          />
        ) : (
          <ManualFallback canEdit={canEdit} />
        )}
      </CardContent>
    </Card>
  );
}

interface AutoPullViewProps {
  rates: CurrencyRate[];
  base: string;
  stamp: string | null;
  canEdit: boolean;
}

function AutoPullView({ rates, base, stamp, canEdit }: AutoPullViewProps) {
  const [refreshing, startRefresh] = useTransition();

  function onRefresh() {
    if (!canEdit || refreshing) return;
    startRefresh(async () => {
      const res = await refreshCurrencyRatesNowAction();
      if (res.ok) {
        toast.success("ECB rates refreshed.");
      } else {
        toast.error(res.detail ?? "Couldn't reach the ECB feed.");
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-4 py-3">
        <div className="flex items-start gap-3">
          <Globe className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">
              {stamp
                ? `Last pulled ${formatUtcStamp(stamp)} · Next pull tomorrow at 08:00 UTC.`
                : "First pull runs at the next 08:00 UTC tick — click Refresh now to grab rates immediately."}
            </p>
          </div>
        </div>
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            className="h-8"
          >
            {refreshing ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 size-3.5" />
            )}
            Refresh now
          </Button>
        )}
      </div>

      {rates.length === 0 ? (
        <EmptyHint />
      ) : (
        <ul className="divide-y divide-border/60 rounded-md border border-border/60">
          {rates.map((row) => (
            <li
              key={row.currency}
              className="flex items-center justify-between px-4 py-2.5 text-sm"
            >
              <span className="font-mono font-medium">
                1 {row.currency} ={" "}
                <span className="text-foreground">
                  {formatRate(row.rate)}
                </span>{" "}
                <span className="text-muted-foreground">{base}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ManualFallback({ canEdit }: { canEdit: boolean }) {
  const [enabling, startEnable] = useTransition();

  function onEnable() {
    if (!canEdit || enabling) return;
    startEnable(async () => {
      const res = await setCurrencyRatesAutoPullAction(true);
      if (res.ok) {
        toast.success("Auto-update on — pulling fresh rates from ECB.");
      } else {
        toast.error(res.detail ?? "Couldn't enable auto-update.");
      }
    });
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border/60 py-8 text-center">
      <Coins className="size-6 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">Auto-update is off</p>
        <p className="text-xs text-muted-foreground">
          Switch it on to keep your exchange rates accurate without manual entry.
        </p>
      </div>
      {canEdit && (
        <Button
          type="button"
          size="sm"
          onClick={onEnable}
          disabled={enabling}
          className="mt-2"
        >
          {enabling && <Loader2 className="mr-1.5 size-4 animate-spin" />}
          Enable ECB auto-update
        </Button>
      )}
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border/60 px-4 py-3 text-xs text-muted-foreground">
      <Coins className="size-4 shrink-0" />
      No rates yet — click Refresh now or wait for the next 08:00 UTC tick.
    </div>
  );
}

function formatRate(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function formatUtcStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  });
  return `${fmt.format(date)} UTC`;
}
