"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import {
  setCurrencyRatesAutoPullAction,
  updateCompanyBagAction,
} from "@/lib/company/bag-actions";
import { ErrorBanner } from "@/components/forms/error-banner";
import { clientValidationError } from "@/lib/errors/client";
import type { CurrencyRate } from "@/lib/company/bags";
import type { Company } from "@/lib/types";
import type { ErrorResult } from "@/lib/errors/server";
import {
  Coins,
  Globe,
  Loader2,
  LockKeyhole,
  Plus,
  Trash2,
} from "lucide-react";
import {
  CreatorLockBanner,
  JoinErrorCard,
  useFormCursorAnchor,
} from "./_realtime";

interface Props {
  company: Company;
  canEdit: boolean;
}

const CURRENCY_OPTIONS = ["EUR", "USD", "JPY", "INR", "CHF", "CAD", "AUD", "GBP"];

interface FormState {
  items: CurrencyRate[];
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
    }));
}

const P = "currency_rates_";

export function CurrencyRatesForm({ company, canEdit }: Props) {
  useFormPresenceBeacon("company:1");

  const base = company.currency_code;

  // Optimistic overlay over the server prop. While the toggle PUT is
  // in flight we render the user's intent; when the server round-trip
  // succeeds `revalidatePath` refreshes `company` and we drop back to
  // the prop. A failure clears the override so the prop wins.
  const [autoPullOverride, setAutoPullOverride] = useState<boolean | null>(null);
  const autoPull = autoPullOverride ?? company.currency_rates_auto_pull;

  const ratesLocked = autoPull;

  const {
    state,
    setField,
    resetState,
    presence,
    fieldEditors,
    focusField,
    blurField,
    joinError,
    creator,
    isCreator,
    cursors,
    setCursor,
    hideCursor,
    broadcastCommit,
  } = useLiveForm<FormState>({
    resource: "company:1",
    disabled: !canEdit,
    initialState: { items: normalize(company.currency_rates) },
    onCommit: (raw) => {
      const msg = raw as
        | { kind: "currency_rates:saved"; items: CurrencyRate[] }
        | null;
      if (!msg || msg.kind !== "currency_rates:saved") return;
      toast.success("Saved", {
        description: `${creator?.name ?? "The host"} just saved currency rates.`,
      });
      setOriginal(msg.items);
      resetState({ items: msg.items });
    },
  });

  const items = state.items;
  const setItems = (next: CurrencyRate[]) => setField("items", next);

  const [original, setOriginal] = useState<CurrencyRate[]>(() =>
    normalize(company.currency_rates),
  );
  useEffect(() => {
    setOriginal(normalize(company.currency_rates));
  }, [company]);

  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [togglePending, startToggleTransition] = useTransition();

  const dirty = JSON.stringify(items) !== JSON.stringify(original);

  function addRow() {
    setItems([
      ...items,
      {
        currency: firstUnused(items, base) ?? CURRENCY_OPTIONS[0]!,
        rate: 0,
      },
    ]);
  }

  function remove(index: number) {
    setItems(items.filter((_, i) => i !== index));
  }

  function update(index: number, patch: Partial<CurrencyRate>) {
    setItems(items.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function onToggleAutoPull(next: boolean) {
    if (!canEdit || !isCreator) return;
    setActionError(null);
    setAutoPullOverride(next);

    startToggleTransition(async () => {
      const res = await setCurrencyRatesAutoPullAction(next);
      if (res.ok) {
        toast.success(
          next
            ? "Auto-pull on. ECB rates will refresh daily at 08:00 UTC."
            : "Auto-pull off. Manage rates manually below.",
        );
        // Server prop will arrive via revalidatePath — clear the
        // override so it takes over.
        setAutoPullOverride(null);
        return;
      }
      setAutoPullOverride(null);
      setActionError(res);
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit || !isCreator) return;
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
        setField("items", cleaned);
        broadcastCommit({ kind: "currency_rates:saved", items: cleaned });
        return;
      }
      setActionError(res);
    });
  }

  function onReset() {
    resetState({ items: original });
    setActionError(null);
  }

  const {
    attach: attachCursor,
    size: cursorSize,
    onMouseMove: onCursorMove,
    onMouseLeave: onCursorLeave,
  } = useFormCursorAnchor(setCursor, hideCursor);

  if (joinError) return <JoinErrorCard error={joinError} />;

  return (
    <Card
      ref={attachCursor}
      onMouseMove={onCursorMove}
      onMouseLeave={onCursorLeave}
      className="relative border-border/60"
    >
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-xl">
        {Object.entries(cursors).map(([id, cursor]) => (
          <RemoteCursor
            key={id}
            cursor={cursor}
            anchorWidth={cursorSize.w}
            anchorHeight={cursorSize.h}
          />
        ))}
      </div>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Currency rates</CardTitle>
            <CardDescription>
              Exchange rates to <strong>{base}</strong> (your base currency).
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <CollabAvatars peers={presence} />
            {!canEdit && <ReadOnly />}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <form onSubmit={onSubmit} className="space-y-4">
            <AutoPullBanner
              enabled={autoPull}
              pulledAt={company.currency_rates_pulled_at}
              source={company.currency_rates_source}
              canEdit={canEdit && isCreator}
              pending={togglePending}
              onToggle={onToggleAutoPull}
            />

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
                {items.map((row, i) => {
                  const currencyId = `${P}${i}_currency`;
                  const rateId = `${P}${i}_rate`;
                  return (
                    <li
                      key={i}
                      className="grid grid-cols-[80px_minmax(0,1.5fr)_auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2"
                    >
                      <span className="text-sm font-medium text-muted-foreground">
                        1
                      </span>
                      <div className="relative">
                        <Select
                          value={row.currency}
                          onValueChange={(v) => update(i, { currency: v })}
                          disabled={ratesLocked}
                        >
                          <SelectTrigger
                            id={currencyId}
                            onFocus={() => focusField(currencyId)}
                            onBlur={() => blurField(currencyId)}
                            className="h-10 w-full"
                            aria-label="Currency"
                          >
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
                        <FieldEditingIndicator peer={fieldEditors[currencyId]} />
                      </div>
                      <span aria-hidden className="text-sm text-muted-foreground">
                        =
                      </span>
                      <div className="relative">
                        <Input
                          id={rateId}
                          type="number"
                          step="any"
                          min={0}
                          value={row.rate}
                          readOnly={ratesLocked}
                          onChange={(e) =>
                            update(i, { rate: Number(e.target.value) })
                          }
                          onFocus={() => focusField(rateId)}
                          onBlur={() => blurField(rateId)}
                          className="h-10"
                          aria-label="Rate"
                        />
                        <FieldEditingIndicator peer={fieldEditors[rateId]} />
                      </div>
                      {canEdit && !ratesLocked && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(i)}
                          disabled={!isCreator}
                          className="size-9 text-muted-foreground hover:text-destructive"
                          aria-label="Remove rate"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {canEdit && !ratesLocked && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
                disabled={!isCreator}
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

            {canEdit && !ratesLocked && (
              <>
                {!isCreator && <CreatorLockBanner creator={creator} />}
                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
                  {dirty && !pending && isCreator && (
                    <Button type="button" variant="ghost" onClick={onReset}>
                      Discard
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={!dirty || pending || !isCreator}
                    title={
                      isCreator
                        ? undefined
                        : creator
                          ? `Only ${creator.name} can save from this room.`
                          : undefined
                    }
                  >
                    {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                    Save changes
                  </Button>
                </div>
              </>
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

interface AutoPullBannerProps {
  enabled: boolean;
  pulledAt: string | null;
  source: "manual" | "ecb_auto";
  canEdit: boolean;
  pending: boolean;
  onToggle: (next: boolean) => void;
}

function AutoPullBanner({
  enabled,
  pulledAt,
  source,
  canEdit,
  pending,
  onToggle,
}: AutoPullBannerProps) {
  const stamp = pulledAt ? formatUtcStamp(pulledAt) : null;

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-4 py-3">
      <div className="flex items-start gap-3">
        <Globe className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            European Central Bank auto-pull
          </p>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? stamp
                ? source === "ecb_auto"
                  ? `Pulled from the ECB feed at ${stamp}. Refreshes daily at 08:00 UTC.`
                  : `On. Next pull at 08:00 UTC will overwrite manual values (last saved ${stamp}).`
                : "On. First pull runs at the next 08:00 UTC tick — current values are whatever was last saved manually."
              : "Off. Edit the rates below manually."}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={!canEdit || pending}
          aria-label="Auto-pull ECB rates"
        />
      </div>
    </div>
  );
}

// Render a UTC-stamped time the operator can compare against their
// watch. Date-fns isn't pulled in by this form, so we stay in vanilla
// Intl and explicitly tag UTC so it's unambiguous regardless of the
// browser timezone.
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

function ReadOnly() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
      <LockKeyhole className="size-3" />
      Read-only
    </span>
  );
}
