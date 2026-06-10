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
import type { StockLot, StockLotPlacement } from "@/lib/types";
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

  const nonZeroPlacements = useMemo(
    () => lot.placements.filter((p) => Number(p.qty) > 0),
    [lot.placements],
  );

  const [direction, setDirection] = useState<"up" | "down">("up");
  const [magnitude, setMagnitude] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [placementId, setPlacementId] = useState<string>(
    nonZeroPlacements[0]?.uuid ?? "",
  );

  // Reset every time the dialog opens so a previous-attempt state
  // doesn't leak in.
  useEffect(() => {
    if (!open) return;
    setDirection("up");
    setMagnitude("");
    setReason("");
    setError(null);
    setPlacementId(nonZeroPlacements[0]?.uuid ?? "");
  }, [open, nonZeroPlacements]);

  const placement = useMemo(
    () => nonZeroPlacements.find((p) => p.uuid === placementId) ?? null,
    [nonZeroPlacements, placementId],
  );

  const magnitudeNumber = Number(magnitude);
  const isValidMagnitude =
    Number.isFinite(magnitudeNumber) && magnitudeNumber > 0;
  const wouldUnderflow =
    direction === "down" &&
    placement &&
    isValidMagnitude &&
    Number(placement.qty) - magnitudeNumber < 0;

  const canSubmit =
    !!reason.trim() &&
    isValidMagnitude &&
    !wouldUnderflow &&
    !!placement &&
    !pending;

  function submit() {
    if (!canSubmit || !placement) return;
    setError(null);

    const delta = direction === "up" ? magnitude : `-${magnitude}`;

    startTransition(async () => {
      const res = await adjustLotAction(lot.uuid, {
        from_cell_uuid: placement.storage_cell?.uuid,
        delta_qty: delta,
        reason: reason.trim(),
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
          {nonZeroPlacements.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Placement
              </Label>
              <Select value={placementId} onValueChange={setPlacementId}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {nonZeroPlacements.map((p) => (
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
              Reason
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Stock take, damage write-off, supplier shorted us 3…"
              rows={3}
            />
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
