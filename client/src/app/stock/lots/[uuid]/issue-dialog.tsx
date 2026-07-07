"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HandCoins, Loader2 } from "lucide-react";
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
import { issueLotAction } from "@/lib/stock/actions";

interface Props {
  lot: StockLot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Issue consumable qty to a recipient. Distinct from Adjust (a stock
 * correction) and MO consumption (which runs through the pick →
 * confirm → consume ceremony bound to a production step). Used for
 * PPE handout, sanitiser pour, spare-parts issue, and similar
 * consumable flows where the operator hands stock to a person /
 * shift / department.
 *
 * Two optional linkage fields — a recipient user and an MO — make
 * the issue traceable for cost allocation + recall scope. Both
 * default to unlinked for the common shift-level bulk case.
 */
export function IssueDialog({ lot, open, onOpenChange }: Props) {
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

  const [qty, setQty] = useState<string>("");
  const [purpose, setPurpose] = useState<string>("");
  const [placementId, setPlacementId] = useState<string>(
    nonZeroPlacements[0]?.uuid ?? "",
  );
  // Optional linkage — leave blank for shift-level bulk issue.
  const [recipientUserUuid, setRecipientUserUuid] = useState<string>("");
  const [manufacturingOrderUuid, setManufacturingOrderUuid] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    // Explicit reset on open so a previous-attempt state doesn't
    // leak in when the dialog is reopened. The lint rule flags
    // setState in an effect; here it's the intended pattern —
    // sync form state to dialog visibility.
    /* eslint-disable react-hooks/set-state-in-effect */
    setQty("");
    setPurpose("");
    setError(null);
    setPlacementId(nonZeroPlacements[0]?.uuid ?? "");
    setRecipientUserUuid("");
    setManufacturingOrderUuid("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, nonZeroPlacements]);

  const placement = useMemo(
    () => nonZeroPlacements.find((p) => p.uuid === placementId) ?? null,
    [nonZeroPlacements, placementId],
  );

  const qtyNumber = Number(qty);
  const isValidQty = Number.isFinite(qtyNumber) && qtyNumber > 0;
  const wouldUnderflow =
    placement && isValidQty && Number(placement.qty) - qtyNumber < 0;

  const canSubmit =
    !!purpose.trim() &&
    isValidQty &&
    !wouldUnderflow &&
    !!placement &&
    !pending;

  function submit() {
    if (!canSubmit || !placement) return;
    setError(null);

    startTransition(async () => {
      const res = await issueLotAction(lot.uuid, {
        from_cell_uuid: placement.storage_cell?.uuid,
        qty,
        purpose: purpose.trim(),
        issued_to_user_uuid: recipientUserUuid.trim() || null,
        manufacturing_order_uuid: manufacturingOrderUuid.trim() || null,
      });
      if (res.ok) {
        toast.success(
          `Issued ${qty} ${symbol} from ${lot.code ?? `lot #${lot.id}`}`,
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
            <HandCoins className="size-4 text-muted-foreground" />
            Issue
          </DialogTitle>
          <DialogDescription>
            Draw down a consumable to a recipient — PPE handout, sanitiser
            pour, spare parts, a food-safe lubricant top-up. The audit
            trail keeps who took what, when, and why.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {nonZeroPlacements.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                From placement
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
              How much
            </Label>
            <div className="flex gap-2">
              <Input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
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
                {placement.qty} {symbol} on hand at {breadcrumb(placement)}.
                {isValidQty && !wouldUnderflow && (
                  <>
                    {" "}
                    → After:{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {Number(placement.qty) - qtyNumber} {symbol}
                    </span>
                  </>
                )}
              </p>
            )}
            {wouldUnderflow && (
              <p className="text-[11px] text-destructive">
                Not enough stock at that cell to cover the issue.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Purpose
            </Label>
            <Textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Shift PPE issue · Line 3 cleaning · MO closeout PPE"
              rows={2}
            />
          </div>

          {/* Optional linkage — kept as UUID fields for the MVP. A
              follow-up PR wires proper pickers (user picker, MO
              picker) once operators have used the flow. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Recipient UUID (optional)
              </Label>
              <Input
                value={recipientUserUuid}
                onChange={(e) => setRecipientUserUuid(e.target.value)}
                placeholder="user uuid"
                className="h-9 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                MO UUID (optional)
              </Label>
              <Input
                value={manufacturingOrderUuid}
                onChange={(e) => setManufacturingOrderUuid(e.target.value)}
                placeholder="mo uuid"
                className="h-9 font-mono text-xs"
              />
            </div>
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
            ) : (
              <HandCoins className="mr-1.5 size-4" />
            )}
            Record issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
