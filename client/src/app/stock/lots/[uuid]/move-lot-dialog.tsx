"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Check, Loader2, Move } from "lucide-react";
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
import { CellPicker } from "@/components/forms/cell-picker";
import { ErrorBanner } from "@/components/forms/error-banner";
import type {
  StockCellPickerRow,
  StockLot,
  StockLotPlacement,
} from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import { moveLotAction } from "@/lib/stock/actions";

interface Props {
  lot: StockLot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Same set the mobile flow uses — keeps the audit reasons consistent
// across surfaces.
const SKIP_REASONS = [
  { value: "blurry_capture", label: "Couldn't get a clear photo" },
  { value: "camera_unavailable", label: "No camera on this device" },
  { value: "tight_quarters", label: "Couldn't reach the angle" },
  { value: "other", label: "Other" },
];

/**
 * Laptop-side equivalent of the mobile move flow. The operator picks
 * a source placement (when the lot's split), a destination cell from
 * the searchable picker, a qty (defaulting to the source's on-hand),
 * and attaches either a photo or a skip-reason. Submits to the same
 * /api/stock/lots/:uuid/move endpoint the phone hits.
 */
export function MoveLotDialog({ lot, open, onOpenChange }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  // Source — defaults to the only non-zero placement when there is
  // one. The select stays mounted when the lot has 2+ so the operator
  // is forced to disambiguate.
  const nonZeroPlacements = useMemo(
    () => lot.placements.filter((p) => Number(p.qty) > 0),
    [lot.placements],
  );

  const [fromPlacementId, setFromPlacementId] = useState<string>(
    nonZeroPlacements[0]?.uuid ?? "",
  );
  const [toCellId, setToCellId] = useState<string>("");
  const [toCellRow, setToCellRow] = useState<StockCellPickerRow | null>(null);
  const [qty, setQty] = useState<string>("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [skipReason, setSkipReason] = useState<string>("");

  const fromPlacement = useMemo(
    () =>
      nonZeroPlacements.find((p) => p.uuid === fromPlacementId) ?? null,
    [nonZeroPlacements, fromPlacementId],
  );

  // Default qty to the source placement's on-hand each time it
  // changes; operator can override.
  useEffect(() => {
    if (fromPlacement) setQty(fromPlacement.qty);
  }, [fromPlacement]);

  // Reset transient state every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setFromPlacementId(nonZeroPlacements[0]?.uuid ?? "");
    setToCellId("");
    setToCellRow(null);
    setPhotoUrl(null);
    setSkipReason("");
  }, [open, nonZeroPlacements]);

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
      const data = (await res.json()) as { photo_url?: string; detail?: string };
      if (!res.ok || !data.photo_url) {
        setError({
          detail: data.detail ?? "Photo upload failed.",
          code: "photo_upload_failed",
        });
        return;
      }
      setPhotoUrl(data.photo_url);
      setSkipReason("");
    } finally {
      setPhotoUploading(false);
      e.target.value = "";
    }
  }

  const canSubmit =
    !!toCellId &&
    !!fromPlacementId &&
    !!qty.trim() &&
    Number(qty) > 0 &&
    (!!photoUrl || !!skipReason) &&
    !pending;

  function submit() {
    if (!canSubmit || !toCellRow) return;
    setError(null);

    startTransition(async () => {
      const res = await moveLotAction(lot.uuid, {
        to_cell_uuid: toCellRow.uuid,
        from_cell_uuid: fromPlacement?.storage_cell?.uuid,
        qty: qty.trim(),
        photo_url: photoUrl ?? undefined,
        skip_photo_reason: skipReason || undefined,
      });
      if (res.ok) {
        toast.success(`Moved ${lot.code ?? `lot #${lot.id}`}`);
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
          <DialogTitle>Move stock</DialogTitle>
          <DialogDescription>
            Pulls qty from one cell and lands it at another. A
            movement row is recorded either way.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {nonZeroPlacements.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Source placement
              </Label>
              <Select
                value={fromPlacementId}
                onValueChange={setFromPlacementId}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Pick a source…" />
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
              Destination cell
            </Label>
            <CellPicker
              value={toCellId}
              warehouseId={toCellRow?.warehouse?.id ?? null}
              itemId={lot.item_id}
              matchTags
              placeholder="Search cells…"
              onChange={(id, row) => {
                setToCellId(id);
                setToCellRow(row);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Quantity
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
            {fromPlacement && (
              <p className="text-[11px] text-muted-foreground">
                Source has {fromPlacement.qty} {symbol} on hand.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Photo
            </Label>
            {photoUrl ? (
              <div className="flex items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
                <Check className="size-4 text-emerald-600" />
                <span className="flex-1">Photo attached</span>
                <button
                  type="button"
                  onClick={() => setPhotoUrl(null)}
                  className="text-[11px] text-muted-foreground underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-border/60 bg-muted/40 text-sm font-medium">
                {photoUploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Camera className="size-4" />
                )}
                {photoUploading ? "Uploading…" : "Attach a photo"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={onPhoto}
                  className="hidden"
                  disabled={photoUploading}
                />
              </label>
            )}

            {!photoUrl && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11px] text-muted-foreground">
                  Or skip with a reason:
                </p>
                <Select value={skipReason} onValueChange={setSkipReason}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Pick a reason…" />
                  </SelectTrigger>
                  <SelectContent>
                    {SKIP_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
            {pending ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Move className="mr-1.5 size-4" />
            )}
            Move
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
