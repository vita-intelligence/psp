"use client";

/**
 * Loyalty-program tier editor. Inline table of existing tiers plus a
 * single-row "add tier" form below. Server-action driven — no
 * optimistic UI; we `router.refresh()` after each mutation.
 *
 * Why not the full collab pattern: tier rows are small, fast to
 * write, and a save races against the BE's rank-uniqueness check —
 * we'd rather let the API arbitrate than try to mirror that on the
 * client. The header form on the same page is where collab lives.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CompanyDefaults, LoyaltyProgram, LoyaltyTier } from "@/lib/types";
import {
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";
import {
  addTierAction,
  deleteTierAction,
  updateTierAction,
} from "@/lib/loyalty/actions";

interface Props {
  program: LoyaltyProgram;
  prefs: CompanyDefaults;
  baseCurrency: string;
  canEdit: boolean;
}

export function LoyaltyTierEditorCard({
  program,
  prefs,
  baseCurrency,
  canEdit,
}: Props) {
  const sorted = [...program.tiers].sort(
    (a, b) => Number(a.min_threshold) - Number(b.min_threshold),
  );

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>Tiers</CardTitle>
        <CardDescription>
          Each tier sets a YTD-revenue threshold and the rebate %
          applied past that threshold. The next-higher tier overrides as
          the customer&rsquo;s YTD climbs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sorted.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
            No tiers yet. Add one below — e.g. 5% over £10,000 YTD.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-md border border-border/60">
            <li className="grid grid-cols-[80px_minmax(0,1fr)_100px_minmax(0,1fr)_auto] items-center gap-3 bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>Rank</span>
              <span>Threshold</span>
              <span className="text-right">Rate %</span>
              <span>Label</span>
              <span className="sr-only">Actions</span>
            </li>
            {sorted.map((tier) => (
              <TierRow
                key={tier.id}
                tier={tier}
                program={program}
                prefs={prefs}
                baseCurrency={baseCurrency}
                canEdit={canEdit}
              />
            ))}
          </ul>
        )}

        {canEdit && (
          <AddTierRow program={program} nextRank={sorted.length + 1} />
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// One row + inline edit
// ============================================================

function TierRow({
  tier,
  program,
  prefs,
  baseCurrency,
  canEdit,
}: {
  tier: LoyaltyTier;
  program: LoyaltyProgram;
  prefs: CompanyDefaults;
  baseCurrency: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [minThreshold, setMinThreshold] = useState(tier.min_threshold);
  const [ratePct, setRatePct] = useState(tier.rate_pct);
  const [label, setLabel] = useState(tier.label ?? "");
  const [pending, startTransition] = useTransition();

  function cancel() {
    setMinThreshold(tier.min_threshold);
    setRatePct(tier.rate_pct);
    setLabel(tier.label ?? "");
    setEditing(false);
  }

  function save() {
    startTransition(async () => {
      const res = await updateTierAction(program.uuid, tier.uuid, {
        min_threshold: minThreshold,
        rate_pct: ratePct,
        label: label.trim() || null,
      });
      if (res.ok) {
        toast.success("Tier saved");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  function remove() {
    if (
      !window.confirm(
        `Remove the tier at ${tier.min_threshold}? Past accruals stay on the ledger.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await deleteTierAction(program.uuid, tier.uuid);
      if (res.ok) {
        toast.success("Tier removed");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  if (editing) {
    return (
      <li className="grid grid-cols-[80px_minmax(0,1fr)_100px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2">
        <span className="font-mono text-xs text-muted-foreground">
          #{tier.rank}
        </span>
        <Input
          type="text"
          inputMode="decimal"
          value={minThreshold}
          onChange={(e) => setMinThreshold(e.target.value)}
          className="h-9 font-mono"
        />
        <Input
          type="text"
          inputMode="decimal"
          value={ratePct}
          onChange={(e) => setRatePct(e.target.value)}
          className="h-9 text-right font-mono"
        />
        <Input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Optional (e.g. Silver)"
          className="h-9"
        />
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={cancel}
            disabled={pending}
            aria-label="Cancel"
            className="size-8"
          >
            <X className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            onClick={save}
            disabled={pending}
            aria-label="Save tier"
            className="size-8"
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="grid grid-cols-[80px_minmax(0,1fr)_100px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-xs">
      <span className="font-mono text-muted-foreground">#{tier.rank}</span>
      <span className="font-mono">
        {formatCompanyMoney(tier.min_threshold, prefs, {
          currency_code: baseCurrency,
        })}
        +
      </span>
      <span className="text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400">
        {formatCompanyNumber(tier.rate_pct, prefs)}%
      </span>
      <span className="truncate">
        {tier.label ?? (
          <span className="text-muted-foreground/50">—</span>
        )}
      </span>
      {canEdit && (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => setEditing(true)}
            disabled={pending}
            aria-label="Edit tier"
            className="size-8 text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={remove}
            disabled={pending}
            aria-label="Remove tier"
            className="size-8 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </li>
  );
}

// ============================================================
// Add-tier row
// ============================================================

function AddTierRow({
  program,
  nextRank,
}: {
  program: LoyaltyProgram;
  nextRank: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [minThreshold, setMinThreshold] = useState("");
  const [ratePct, setRatePct] = useState("");
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();

  function reset() {
    setMinThreshold("");
    setRatePct("");
    setLabel("");
    setOpen(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!minThreshold.trim() || !ratePct.trim()) return;
    startTransition(async () => {
      const res = await addTierAction(program.uuid, {
        rank: nextRank,
        min_threshold: minThreshold.trim(),
        rate_pct: ratePct.trim(),
        label: label.trim() || null,
      });
      if (res.ok) {
        toast.success("Tier added");
        reset();
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Plus className="mr-1.5 size-4" />
        Add tier
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Min threshold
          </Label>
          <Input
            type="text"
            inputMode="decimal"
            value={minThreshold}
            onChange={(e) => setMinThreshold(e.target.value)}
            placeholder="10000.00"
            className="h-10 font-mono"
            required
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Rate %
          </Label>
          <Input
            type="text"
            inputMode="decimal"
            value={ratePct}
            onChange={(e) => setRatePct(e.target.value)}
            placeholder="5.00"
            className="h-10 font-mono"
            required
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Label (optional)
          </Label>
          <Input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Silver, Gold, …"
            className="h-10"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Add tier
        </Button>
      </div>
    </form>
  );
}
