"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Truck } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner } from "@/components/forms/error-banner";
import { requestDispatchAction } from "@/lib/three-pl/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type { ThreePLInventoryRow } from "@/lib/three-pl/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: ThreePLInventoryRow | null;
}

/**
 * Desktop step of the split dispatch flow — queues a "please
 * dispatch N units" task on the mobile picker queue. Operator types
 * qty (+ optional reference / notes) and confirms; NO photo here.
 * The warehouse picker takes over on mobile: scan source cell → scan
 * lot → walk → scan shipping cell → take photo → confirm.
 */
export function DispatchDialog({ open, onOpenChange, row }: Props) {
  const router = useRouter();
  const [qty, setQty] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setQty("");
    setReference("");
    setNotes("");
    setError(null);
  }, [open, row?.lot.uuid]);

  if (!row) return null;
  const lot = row.lot;
  const qtyOnHand = Number(lot.qty_on_hand ?? 0);
  const unit = lot.unit_of_measurement?.symbol ?? "";

  const qtyNumber = Number(qty);
  const qtyValid = qty.trim() !== "" && qtyNumber > 0 && qtyNumber <= qtyOnHand;
  const canSubmit = qtyValid && !pending;

  function submit() {
    if (!canSubmit) return;
    setError(null);

    startTransition(async () => {
      const res = await requestDispatchAction({
        lot_uuid: lot.uuid,
        qty,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      });
      if (!res.ok) {
        setError(res);
        return;
      }
      toast.success(
        `Dispatch queued for warehouse pickup — ${qty}${unit ? ` ${unit}` : ""} of ${lot.code ?? "lot"}.`,
      );
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="size-4" />
            Queue dispatch for {lot.code ?? "lot"}
          </DialogTitle>
          <DialogDescription>
            {lot.item?.name ?? "—"} • {lot.bailee_customer?.name ?? "—"} •{" "}
            {qtyOnHand}
            {unit ? ` ${unit}` : ""} in bailee custody
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-sky-500/40 bg-sky-500/5 p-3 text-xs text-sky-900 dark:text-sky-100">
            This creates a pick task for the warehouse team. They&apos;ll
            scan the 3PL cell, scan the lot QR, walk it to the shipping
            bay, scan the destination cell and take a photo — the
            physical move + evidence get attached at that step, not
            here.
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dispatch-qty">Qty to dispatch</Label>
            <Input
              id="dispatch-qty"
              type="number"
              min={0}
              max={qtyOnHand}
              step="0.0001"
              inputMode="decimal"
              placeholder={`Up to ${qtyOnHand}${unit ? ` ${unit}` : ""}`}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            {qty.trim() !== "" && !qtyValid && (
              <p className="text-[11px] text-destructive">
                {qtyNumber <= 0
                  ? "Must be greater than zero."
                  : `Only ${qtyOnHand}${unit ? ` ${unit}` : ""} available.`}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dispatch-reference">Reference (optional)</Label>
            <Input
              id="dispatch-reference"
              placeholder="Carrier waybill / customer PO"
              maxLength={200}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dispatch-notes">Notes for picker (optional)</Label>
            <Textarea
              id="dispatch-notes"
              placeholder="Anything the picker should know — split pallets, handle carefully, etc."
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error && <ErrorBanner detail={error.detail} code={error.code} />}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Queue for warehouse
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
