"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Camera,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Truck,
} from "lucide-react";
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
import { dispatchLotAction } from "@/lib/three-pl/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type { ThreePLInventoryRow } from "@/lib/three-pl/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: ThreePLInventoryRow | null;
}

/**
 * Partial-lot outbound dispatch dialog. Operator enters qty being
 * shipped, uploads a photo of the packages on the trolley/dock, and
 * can attach an optional carrier / customer PO reference. On confirm
 * we hit /api/three-pl/dispatch/:lot_uuid which records the audit
 * row + moves the qty from the three_pl_storage cell into a dispatch
 * cell in one transaction.
 */
export function DispatchDialog({ open, onOpenChange, row }: Props) {
  const router = useRouter();
  const [qty, setQty] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [error, setError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setQty("");
    setReference("");
    setNotes("");
    setPhotoUrl(null);
    setError(null);
  }, [open, row?.lot.uuid]);

  if (!row) return null;
  const lot = row.lot;
  const qtyOnHand = Number(lot.qty_on_hand ?? 0);
  const unit = lot.unit_of_measurement?.symbol ?? "";

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/stock/movement-photos", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        photo_url?: string;
        detail?: string;
      };
      if (!res.ok || !data.photo_url) {
        setError({
          ok: false,
          code: "photo_upload_failed",
          detail: data.detail ?? "Photo upload failed.",
          debug: { source: "DispatchDialog.onPhoto" },
        } as ErrorResult);
        return;
      }
      setPhotoUrl(data.photo_url);
    } finally {
      setPhotoUploading(false);
      e.target.value = "";
    }
  }

  const qtyNumber = Number(qty);
  const qtyValid = qty.trim() !== "" && qtyNumber > 0 && qtyNumber <= qtyOnHand;
  const canSubmit = qtyValid && !!photoUrl && !pending && !photoUploading;

  function submit() {
    if (!canSubmit) return;
    setError(null);

    startTransition(async () => {
      const res = await dispatchLotAction(lot.uuid, {
        qty,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        photo_url: photoUrl,
      });
      if (!res.ok) {
        setError(res);
        return;
      }
      toast.success(
        `Dispatched ${qty}${unit ? ` ${unit}` : ""} of ${lot.code ?? "lot"}.`,
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
            Dispatch {lot.code ?? "lot"}
          </DialogTitle>
          <DialogDescription>
            {lot.item?.name ?? "—"} • {lot.bailee_customer?.name ?? "—"} •{" "}
            {qtyOnHand}
            {unit ? ` ${unit}` : ""} in bailee custody
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
            <Label htmlFor="dispatch-notes">Notes (optional)</Label>
            <Textarea
              id="dispatch-notes"
              placeholder="Anything unusual — split pallets, damaged packaging, etc."
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Photo evidence (required)</Label>
            <div className="flex items-center gap-2">
              {photoUrl ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-2 py-1 text-xs text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 className="size-3.5" />
                  Photo attached
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Snap the trolley / dock before it leaves.
                </div>
              )}
              <label className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-xs hover:bg-muted">
                {photoUploading ? (
                  <>
                    <RefreshCw className="size-3.5 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <Camera className="size-3.5" />
                    {photoUrl ? "Retake" : "Add photo"}
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => void onPhoto(e)}
                />
              </label>
            </div>
          </div>

          {error && <ErrorBanner detail={error.detail} code={error.code} />}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Confirm dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
