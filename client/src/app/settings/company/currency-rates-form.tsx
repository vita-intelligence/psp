"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateCompanyBagAction } from "@/lib/company/bag-actions";
import { ErrorBanner } from "@/components/forms/error-banner";
import { clientValidationError } from "@/lib/errors/client";
import type { CurrencyRate } from "@/lib/company/bags";
import type { Company } from "@/lib/types";
import type { ErrorResult } from "@/lib/errors/server";
import {
  Coins,
  Loader2,
  LockKeyhole,
  Plus,
  Trash2,
} from "lucide-react";

interface Props {
  company: Company;
  canEdit: boolean;
}

const CURRENCY_OPTIONS = ["EUR", "USD", "JPY", "INR", "CHF", "CAD", "AUD", "GBP"];

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
    }));
}

export function CurrencyRatesForm({ company, canEdit }: Props) {
  const base = company.currency_code;
  const [original, setOriginal] = useState<CurrencyRate[]>(() =>
    normalize(company.currency_rates),
  );
  const [items, setItems] = useState<CurrencyRate[]>(() =>
    normalize(company.currency_rates),
  );
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(items) !== JSON.stringify(original);

  function addRow() {
    setItems((s) => [
      ...s,
      {
        currency: firstUnused(s, base) ?? CURRENCY_OPTIONS[0]!,
        rate: 0,
      },
    ]);
  }

  function remove(index: number) {
    setItems((s) => s.filter((_, i) => i !== index));
  }

  function update(index: number, patch: Partial<CurrencyRate>) {
    setItems((s) =>
      s.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);

    const cleaned = items
      .map((r) => ({
        currency: r.currency.toUpperCase(),
        rate: Number(r.rate),
      }))
      .filter((r) => r.currency && Number.isFinite(r.rate) && r.rate > 0);

    const seen = new Set<string>();
    for (const r of cleaned) {
      if (seen.has(r.currency)) {
        setActionError(
          clientValidationError({
            source: "CurrencyRatesForm",
            detail: `Currency "${r.currency}" appears more than once.`,
            exception: `duplicate currency code: ${r.currency}`,
          }),
        );
        return;
      }
      seen.add(r.currency);
    }

    startTransition(async () => {
      const res = await updateCompanyBagAction("currency_rates", {
        rates: cleaned,
      });
      if (res.ok) {
        toast.success("Currency rates updated");
        setOriginal(cleaned);
        setItems(cleaned);
        return;
      }
      setActionError(res);
    });
  }

  function onReset() {
    setItems(original);
    setActionError(null);
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Currency rates</CardTitle>
            <CardDescription>
              Manual exchange rates to <strong>{base}</strong> (your base currency).
            </CardDescription>
          </div>
          {!canEdit && <ReadOnly />}
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <form onSubmit={onSubmit} className="space-y-4">
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border/60 py-8 text-center">
                <Coins className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium">No rates yet</p>
                <p className="text-xs text-muted-foreground">
                  Add currencies you trade in.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                <li className="grid grid-cols-[80px_minmax(0,1.5fr)_auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Multiplier</span>
                  <span>Currency</span>
                  <span>=</span>
                  <span>Rate ({base})</span>
                  <span className="sr-only">Actions</span>
                </li>
                {items.map((row, i) => (
                  <li
                    key={i}
                    className="grid grid-cols-[80px_minmax(0,1.5fr)_auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2"
                  >
                    <span className="text-sm font-medium text-muted-foreground">
                      1
                    </span>
                    <Select
                      value={row.currency}
                      onValueChange={(v) => update(i, { currency: v })}
                    >
                      <SelectTrigger className="h-10 w-full" aria-label="Currency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCY_OPTIONS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span aria-hidden className="text-sm text-muted-foreground">
                      =
                    </span>
                    <Input
                      type="number"
                      step="any"
                      min={0}
                      value={row.rate}
                      onChange={(e) =>
                        update(i, { rate: Number(e.target.value) })
                      }
                      className="h-10"
                      aria-label="Rate"
                    />
                    {canEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(i)}
                        className="size-9 text-muted-foreground hover:text-destructive"
                        aria-label="Remove rate"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
              >
                <Plus className="mr-1.5 size-4" />
                Add rate
              </Button>
            )}

            {actionError && (
              <ErrorBanner
                detail={actionError.detail}
                code={actionError.code}
                debug={actionError.debug}
              />
            )}

            {canEdit && (
              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
                {dirty && !pending && (
                  <Button type="button" variant="ghost" onClick={onReset}>
                    Discard
                  </Button>
                )}
                <Button type="submit" disabled={!dirty || pending}>
                  {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save changes
                </Button>
              </div>
            )}
          </form>
        </fieldset>
      </CardContent>
    </Card>
  );
}

function firstUnused(items: CurrencyRate[], base: string) {
  const taken = new Set([base, ...items.map((i) => i.currency.toUpperCase())]);
  return CURRENCY_OPTIONS.find((c) => !taken.has(c));
}

function ReadOnly() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
      <LockKeyhole className="size-3" />
      Read-only
    </span>
  );
}
