"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PackageMinus, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorDebug } from "@/lib/errors/types";
import type {
  StockLot,
  StockMovementReasonCategory,
  StockWriteOffDisposalMethod,
} from "@/lib/types";
import {
  STOCK_MOVEMENT_REASON_CATEGORY_LABEL,
  STOCK_WRITE_OFF_DISPOSAL_METHOD_LABEL,
} from "@/lib/types";
import { createWriteOffAction } from "@/lib/stock/actions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional — when opened from a lot page the lot is pre-selected. */
  presetLot?: {
    uuid: string;
    code: string | null;
    item_name: string | null;
    qty_on_hand: string | null;
    uom: string | null;
  };
}

// Same 9-value list as the WriteOff schema. Skips `physical_move`
// since a move doesn't destroy stock.
const REASON_CATEGORY_OPTIONS: StockMovementReasonCategory[] = [
  "damage",
  "expiry",
  "qc_fail",
  "stock_take_variance",
  "theft_loss",
  "sample_pull",
  "customer_return",
  "admin_correction",
  "other",
];

const DISPOSAL_METHOD_OPTIONS: StockWriteOffDisposalMethod[] = [
  "incinerated",
  "landfill",
  "recycled",
  "returned_to_supplier",
  "destroyed_on_site",
  "other",
];

const MIN_NARRATIVE = 30;

/**
 * Simple create-draft modal. When invoked from the write-offs list,
 * an inline search picker resolves a lot uuid. When invoked from a
 * lot page (via ``presetLot``), the picker is skipped and the qty
 * pre-fills with the lot's on-hand.
 */
export function CreateWriteOffModal({ open, onOpenChange, presetLot }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  const [lotUuid, setLotUuid] = useState<string>("");
  const [lotLabel, setLotLabel] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [reasonCategory, setReasonCategory] =
    useState<StockMovementReasonCategory | "">("");
  const [disposalMethod, setDisposalMethod] =
    useState<StockWriteOffDisposalMethod | "">("");
  const [narrative, setNarrative] = useState<string>("");

  // Reset every time the modal opens so a previous-attempt state
  // doesn't leak in.
  useEffect(() => {
    if (!open) return;
    setLotUuid(presetLot?.uuid ?? "");
    setLotLabel(
      presetLot
        ? `${presetLot.code ?? presetLot.uuid.slice(0, 8)} — ${
            presetLot.item_name ?? "?"
          }`
        : "",
    );
    setQty(presetLot?.qty_on_hand ?? "");
    setReasonCategory("");
    setDisposalMethod("");
    setNarrative("");
    setError(null);
  }, [open, presetLot]);

  const canSubmit =
    !!lotUuid &&
    !!reasonCategory &&
    !!disposalMethod &&
    Number(qty) > 0 &&
    narrative.trim().length >= MIN_NARRATIVE &&
    !pending;

  function submit() {
    if (!canSubmit || !reasonCategory || !disposalMethod) return;
    setError(null);
    startTransition(async () => {
      const res = await createWriteOffAction({
        lot_uuid: lotUuid,
        qty,
        reason_category: reasonCategory,
        reason_narrative: narrative.trim(),
        disposal_method: disposalMethod,
      });
      if (res.ok) {
        toast.success(`Draft ${res.write_off.code ?? "created"} filed`);
        onOpenChange(false);
        router.push(`/stock/write-offs/${res.write_off.uuid}`);
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageMinus className="size-4 text-muted-foreground" />
            Create write-off draft
          </DialogTitle>
          <DialogDescription>
            Files a draft. It stays editable until you submit for review;
            the actual stock qty only changes when the authoriser signs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {presetLot ? (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
              <span className="font-mono font-semibold">
                {presetLot.code ?? presetLot.uuid.slice(0, 8)}
              </span>{" "}
              — {presetLot.item_name ?? "Unknown item"}
              {presetLot.qty_on_hand && (
                <span className="ml-2 text-muted-foreground">
                  ({presetLot.qty_on_hand} {presetLot.uom ?? ""} on hand)
                </span>
              )}
            </div>
          ) : (
            <LotSearchInput
              value={lotLabel}
              onChange={setLotLabel}
              onSelect={(lot) => {
                setLotUuid(lot.uuid);
                setLotLabel(
                  `${lot.code ?? lot.uuid.slice(0, 8)} — ${
                    lot.item?.name ?? "?"
                  }`,
                );
                if (lot.qty_on_hand) setQty(lot.qty_on_hand);
              }}
              disabled={pending}
            />
          )}

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Qty to write off
            </Label>
            <Input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0.00"
              className="h-9 font-mono"
              inputMode="decimal"
              disabled={pending}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Reason
              </Label>
              <Select
                value={reasonCategory}
                onValueChange={(v) =>
                  setReasonCategory(v as StockMovementReasonCategory)
                }
                disabled={pending}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Why?" />
                </SelectTrigger>
                <SelectContent>
                  {REASON_CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {STOCK_MOVEMENT_REASON_CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Disposal method
              </Label>
              <Select
                value={disposalMethod}
                onValueChange={(v) =>
                  setDisposalMethod(v as StockWriteOffDisposalMethod)
                }
                disabled={pending}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="How?" />
                </SelectTrigger>
                <SelectContent>
                  {DISPOSAL_METHOD_OPTIONS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {STOCK_WRITE_OFF_DISPOSAL_METHOD_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Narrative (min {MIN_NARRATIVE} chars)
            </Label>
            <Textarea
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              placeholder="Describe what happened, evidence you'd cite, and the physical destination…"
              rows={4}
              disabled={pending}
            />
            {narrative.trim().length > 0 &&
              narrative.trim().length < MIN_NARRATIVE && (
                <p className="text-[11px] text-destructive">
                  {MIN_NARRATIVE - narrative.trim().length} more character
                  {MIN_NARRATIVE - narrative.trim().length === 1 ? "" : "s"}{" "}
                  needed.
                </p>
              )}
          </div>

          {error && (
            <ErrorBanner
              detail={error.detail}
              code={error.code}
              debug={error.debug}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            File draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------
 *  Simple lot search — hits `/api/stock/lots?search=…&limit=10`.
 *  Debounced 300ms so keystrokes don't hammer the endpoint.
 * ---------------------------------------------------------------- */
function LotSearchInput({
  value,
  onChange,
  onSelect,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (lot: StockLot & { qty_on_hand?: string }) => void;
  disabled?: boolean;
}) {
  const [results, setResults] = useState<Array<StockLot & { qty_on_hand?: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const term = useMemo(() => value.trim(), [value]);

  useEffect(() => {
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/stock/lots?limit=10&search=${encodeURIComponent(term)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          items: Array<StockLot & { qty_on_hand?: string }>;
        };
        if (!cancelled) {
          setResults(body.items ?? []);
          setShowResults(true);
        }
      } catch {
        /* silent — the empty results state is enough */
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term]);

  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Lot
      </Label>
      <div className="relative">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setShowResults(true);
            }}
            onFocus={() => setShowResults(true)}
            onBlur={() => setTimeout(() => setShowResults(false), 200)}
            placeholder="Search lot code, batch, item name…"
            className="h-9 pl-8"
            disabled={disabled}
          />
          {searching && (
            <Loader2 className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
        {showResults && results.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border/60 bg-popover shadow-lg">
            {results.map((lot) => (
              <li key={lot.uuid}>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onSelect(lot);
                    setShowResults(false);
                  }}
                  className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-muted/50"
                >
                  <span>
                    <span className="font-mono font-semibold">
                      {lot.code ?? lot.uuid.slice(0, 8)}
                    </span>
                    <span className="ml-1 text-muted-foreground">
                      {lot.item?.name ?? "?"}
                    </span>
                  </span>
                  {lot.qty_on_hand && (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {lot.qty_on_hand} {lot.unit_of_measurement?.symbol ?? ""}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
