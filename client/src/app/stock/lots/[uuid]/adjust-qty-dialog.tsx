"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Minus, Plus, Scale } from "lucide-react";
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
import type {
  StockLot,
  StockLotPlacement,
  StockMovementReasonCategory,
} from "@/lib/types";
import { STOCK_MOVEMENT_REASON_CATEGORY_LABEL } from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import { adjustLotAction } from "@/lib/stock/actions";

interface Props {
  lot: StockLot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Manual qty adjustment — stock-take corrections, damage write-offs,
 * shrinkage. Operator picks Up / Down, a magnitude, and a reason.
 * The backend converts the signed delta into the corresponding
 * `adjust_up` / `adjust_down` movement so the lot's history shows
 * what happened.
 *
 * Adjustments never net to zero — a no-op would just be noise on the
 * timeline, so the submit button stays disabled until the delta is
 * positive.
 */
export function AdjustQtyDialog({ lot, open, onOpenChange }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  // Direction-aware placement picker source. Adjust-DOWN can only
  // pull from cells that actually hold stock (Decimal.compare "> 0").
  // Adjust-UP is fine against a zero-qty placement — the operator's
  // adding stock, so an empty row is a legitimate target. Both lists
  // exclude legacy phantom placements with a broken storage_cell FK
  // so the dropdown never renders a "Cell null" row.
  const allPlacements = useMemo(
    () => lot.placements.filter((p) => !!p.storage_cell_id),
    [lot.placements],
  );

  const nonZeroPlacements = useMemo(
    () => allPlacements.filter((p) => Number(p.qty) > 0),
    [allPlacements],
  );

  const [direction, setDirection] = useState<"up" | "down">("up");
  const [magnitude, setMagnitude] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [reasonCategory, setReasonCategory] =
    useState<StockMovementReasonCategory | "">("");

  const eligiblePlacements = direction === "up" ? allPlacements : nonZeroPlacements;
  const [placementId, setPlacementId] = useState<string>(
    eligiblePlacements[0]?.uuid ?? "",
  );

  // Reset every time the dialog opens so a previous-attempt state
  // doesn't leak in.
  useEffect(() => {
    if (!open) return;
    setDirection("up");
    setMagnitude("");
    setReason("");
    setReasonCategory("");
    setError(null);
    // Prefer a non-zero placement on first render so the "current qty"
    // preview isn't empty; falls through to any placement for up-only
    // lots (nothing on hand yet).
    setPlacementId(
      nonZeroPlacements[0]?.uuid ?? allPlacements[0]?.uuid ?? "",
    );
  }, [open, nonZeroPlacements, allPlacements]);

  // Re-seed the picker if the operator flips direction and the current
  // selection is no longer eligible (e.g. picked a zero-qty placement
  // then flipped to Adjust down).
  useEffect(() => {
    if (!placementId) return;
    if (!eligiblePlacements.find((p) => p.uuid === placementId)) {
      setPlacementId(eligiblePlacements[0]?.uuid ?? "");
    }
  }, [direction, eligiblePlacements, placementId]);

  const placement = useMemo(
    () => eligiblePlacements.find((p) => p.uuid === placementId) ?? null,
    [eligiblePlacements, placementId],
  );

  const hasNoPlacements = allPlacements.length === 0;
  const hasNoNonZero = nonZeroPlacements.length === 0;

  const magnitudeNumber = Number(magnitude);
  const isValidMagnitude =
    Number.isFinite(magnitudeNumber) && magnitudeNumber > 0;
  const wouldUnderflow =
    direction === "down" &&
    placement &&
    isValidMagnitude &&
    Number(placement.qty) - magnitudeNumber < 0;

  // BE now requires ≥ 10 chars of reason + a closed category. Mirror
  // both here so the operator gets a disabled button instead of a
  // round-trip that would only reject anyway.
  const canSubmit =
    reason.trim().length >= 10 &&
    !!reasonCategory &&
    isValidMagnitude &&
    !wouldUnderflow &&
    !!placement &&
    !pending;

  function submit() {
    if (!canSubmit || !placement || !reasonCategory) return;
    setError(null);

    const delta = direction === "up" ? magnitude : `-${magnitude}`;

    startTransition(async () => {
      const res = await adjustLotAction(lot.uuid, {
        from_cell_uuid: placement.storage_cell?.uuid,
        delta_qty: delta,
        reason: reason.trim(),
        reason_category: reasonCategory,
      });
      if (res.ok) {
        toast.success(
          `Adjusted ${lot.code ?? `lot #${lot.id}`} ${direction === "up" ? "+" : "−"}${magnitude}`,
        );
        onOpenChange(false);
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  const symbol = lot.unit_of_measurement?.symbol ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="size-4 text-muted-foreground" />
            Adjust qty
          </DialogTitle>
          <DialogDescription>
            Use for stock-take corrections, shrinkage, or damage —
            anything that changed the count without a physical move.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {hasNoPlacements && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
              <p className="font-medium">
                No placements on this lot yet.
              </p>
              <p className="mt-1 text-muted-foreground">
                Adjust needs a cell to add to. Use{" "}
                <a
                  href="/m"
                  className="font-medium text-amber-700 underline underline-offset-2 dark:text-amber-400"
                >
                  Receive / put-away
                </a>{" "}
                to place stock first, then come back here for corrections.
              </p>
            </div>
          )}

          {!hasNoPlacements &&
            direction === "down" &&
            hasNoNonZero && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                <p>
                  All placements are already at zero — nothing to
                  adjust down. Flip to <strong>Adjust up</strong> to
                  add stock instead.
                </p>
              </div>
            )}

          {eligiblePlacements.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Placement
              </Label>
              <Select value={placementId} onValueChange={setPlacementId}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {eligiblePlacements.map((p) => (
                    <SelectItem key={p.uuid} value={p.uuid}>
                      {breadcrumb(p)} — {p.qty} {symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Direction
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <DirectionPill
                active={direction === "up"}
                onClick={() => setDirection("up")}
                icon={Plus}
                label="Adjust up"
              />
              <DirectionPill
                active={direction === "down"}
                onClick={() => setDirection("down")}
                icon={Minus}
                label="Adjust down"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              How much
            </Label>
            <div className="flex gap-2">
              <Input
                value={magnitude}
                onChange={(e) => setMagnitude(e.target.value)}
                placeholder="0.00"
                className="h-9 font-mono"
                inputMode="decimal"
              />
              <span className="inline-flex items-center rounded-md border border-border/60 bg-muted px-2 text-xs font-medium text-muted-foreground">
                {symbol}
              </span>
            </div>
            {placement && (
              <p className="text-[11px] text-muted-foreground">
                Currently {placement.qty} {symbol} on hand at{" "}
                {breadcrumb(placement)}.
                {isValidMagnitude && (
                  <>
                    {" "}
                    → After:{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {direction === "up"
                        ? Number(placement.qty) + magnitudeNumber
                        : Number(placement.qty) - magnitudeNumber}{" "}
                      {symbol}
                    </span>
                  </>
                )}
              </p>
            )}
            {wouldUnderflow && (
              <p className="text-[11px] text-destructive">
                That would put the placement below zero.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Category
            </Label>
            <Select
              value={reasonCategory}
              onValueChange={(v) =>
                setReasonCategory(v as StockMovementReasonCategory)
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Why did the count change?" />
              </SelectTrigger>
              <SelectContent>
                {(direction === "up"
                  ? ADJUST_UP_CATEGORIES
                  : ADJUST_DOWN_CATEGORIES
                ).map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {STOCK_MOVEMENT_REASON_CATEGORY_LABEL[cat]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Powers the waste-log report — pick the closest match, add
              specifics in the notes below.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Notes (min 10 characters)
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Box crushed by forklift at gate 3, driver signed acknowledgement…"
              rows={3}
            />
            {reason.trim().length > 0 && reason.trim().length < 10 && (
              <p className="text-[11px] text-destructive">
                {10 - reason.trim().length} more character
                {10 - reason.trim().length === 1 ? "" : "s"} needed.
              </p>
            )}
          </div>

          {error && (
            <>
              <ErrorBanner
                detail={error.detail}
                code={error.code}
                debug={error.debug}
              />
              {error.code === "cannot_zero_via_adjust" && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                  <p className="mb-2">
                    Zeroing a placement destroys stock — that needs the
                    three-signature write-off workflow (creator + approver
                    + authoriser) so the paperwork trail is complete.
                  </p>
                  <a
                    href={`/stock/write-offs`}
                    className="inline-flex items-center gap-1 font-medium text-amber-700 underline underline-offset-2 dark:text-amber-400"
                  >
                    File a write-off →
                  </a>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : direction === "up" ? (
              <Plus className="mr-1.5 size-4" />
            ) : (
              <Minus className="mr-1.5 size-4" />
            )}
            Record adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Category choices scoped to the adjust direction — "expired" or
// "damaged" don't make sense as adjust-UP reasons, and "found extra
// on the shelf" isn't a valid adjust-DOWN. Two curated lists keep
// the operator from picking a nonsense combination.
const ADJUST_DOWN_CATEGORIES: StockMovementReasonCategory[] = [
  "damage",
  "expiry",
  "qc_fail",
  "stock_take_variance",
  "theft_loss",
  "sample_pull",
  "admin_correction",
  "other",
];

const ADJUST_UP_CATEGORIES: StockMovementReasonCategory[] = [
  "stock_take_variance",
  "customer_return",
  "admin_correction",
  "other",
];

function DirectionPill({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Plus;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-foreground/30 bg-foreground/5 text-foreground"
          : "border-border/60 text-muted-foreground hover:bg-muted/40"
      }`}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

function breadcrumb(p: StockLotPlacement): string {
  const c = p.storage_cell;
  if (!c) return `Cell ${p.storage_cell_id}`;
  const parts: string[] = [];
  if (c.warehouse?.name) parts.push(c.warehouse.name);
  if (c.storage_location?.name) parts.push(c.storage_location.name);
  if (c.name) parts.push(c.name);
  return parts.length > 0 ? parts.join(" · ") : `Cell ${p.storage_cell_id}`;
}
