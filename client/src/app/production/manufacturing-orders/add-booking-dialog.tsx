"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatCompanyDate,
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";
import { createBookingAction } from "@/lib/production/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import type { CompanyDefaults } from "@/lib/types";
import type {
  BookableLot,
  ManufacturingOrder,
  ManufacturingOrderPart,
} from "@/lib/production/types";

interface Props {
  mo: ManufacturingOrder;
  part: ManufacturingOrderPart;
  company: CompanyDefaults;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * MRPEasy "Add a booking" dialog. Lists the eligible lots for the
 * picked part with their live available qty so two operators can't
 * over-reserve the same lot.
 */
export function AddBookingDialog({
  mo,
  part,
  company,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [lots, setLots] = useState<BookableLot[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [qty, setQty] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const itemId = part.part?.id;
  const uom =
    part.unit_of_measurement?.symbol ?? part.part?.stock_uom?.symbol ?? "";

  useEffect(() => {
    if (!open || !itemId) return;
    let alive = true;
    setLoading(true);
    fetch(
      `/api/production/manufacturing-orders/${encodeURIComponent(mo.uuid)}/bookable-lots?item_id=${itemId}`,
      { cache: "no-store" },
    )
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((body: { items?: BookableLot[] }) => {
        if (!alive) return;
        setLots(body.items ?? []);
      })
      .catch(() => alive && setLots([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, itemId, mo.uuid]);

  const picked = lots.find((l) => l.id === pickedId) ?? null;

  // Pre-fill qty to the smaller of (still-needed, lot.available) when
  // the operator picks a lot. They can override.
  function onPickLot(lot: BookableLot) {
    setPickedId(lot.id);
    setError(null);
    const required = part.required_qty ? Number(part.required_qty) : 0;
    const booked = part.booked_qty ? Number(part.booked_qty) : 0;
    const stillNeeded = Math.max(required - booked, 0);
    const available = Number(lot.available_qty);
    const suggested = Math.min(stillNeeded, available);
    setQty(
      Number.isFinite(suggested) && suggested > 0 ? String(suggested) : "",
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked || !itemId) {
      setError("Pick a lot first.");
      return;
    }
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }
    setError(null);

    startTransition(async () => {
      const res = await createBookingAction(mo.uuid, {
        item_id: itemId,
        stock_lot_id: picked.id,
        storage_cell_id: picked.storage_location?.id ?? null,
        quantity: String(n),
      });
      if (res.ok) {
        toast.success(
          `Booked ${formatCompanyNumber(String(n), company)} ${uom} of ${picked.code ?? "lot"}.`,
        );
        invalidateAudit("manufacturing_order", mo.id);
        onOpenChange(false);
        router.refresh();
      } else {
        setError(res.detail);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add a booking</DialogTitle>
          <DialogDescription>
            Reserve a quantity of{" "}
            <span className="font-medium text-foreground">
              {part.part?.name ?? "this item"}
            </span>{" "}
            from a specific lot. The qty is held against this MO until
            consumed or released.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Eligible lots
            </Label>
            {loading ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading lots…
              </div>
            ) : lots.length === 0 ? (
              <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
                No lots are available for this item. Receive stock or
                create a lot first.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-md border border-border/60">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="w-6 px-2 py-1.5" />
                      <th className="px-2 py-1.5 text-left">Lot</th>
                      <th className="px-2 py-1.5 text-left">Status</th>
                      <th className="px-2 py-1.5 text-left">Storage</th>
                      <th className="px-2 py-1.5 text-left">Expiry</th>
                      <th className="px-2 py-1.5 text-right">Unit cost</th>
                      <th className="px-2 py-1.5 text-right">Available</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {lots.map((lot) => (
                      <tr
                        key={lot.id}
                        onClick={() => onPickLot(lot)}
                        className={
                          pickedId === lot.id
                            ? "cursor-pointer bg-brand/10"
                            : "cursor-pointer hover:bg-muted/40"
                        }
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="radio"
                            checked={pickedId === lot.id}
                            onChange={() => onPickLot(lot)}
                            className="size-3.5"
                          />
                        </td>
                        <td className="px-2 py-1.5 font-mono">
                          {lot.code ?? `#${lot.id}`}
                        </td>
                        <td className="px-2 py-1.5 capitalize">
                          {lot.status}
                        </td>
                        <td className="px-2 py-1.5">
                          {lot.storage_location?.name ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[11px]">
                          {lot.expiry_at
                            ? formatCompanyDate(lot.expiry_at, company)
                            : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {lot.unit_cost
                            ? formatCompanyMoney(lot.unit_cost, company)
                            : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {formatCompanyNumber(lot.available_qty, company)} {uom}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4 sm:items-center">
            <Label htmlFor="qty" className="text-sm font-medium">
              Quantity
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="qty"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                inputMode="decimal"
                disabled={!picked || pending}
                placeholder="0"
                className="h-10 max-w-[12rem] font-mono"
              />
              <span className="text-xs text-muted-foreground">{uom}</span>
              {picked && (
                <span className="text-[11px] text-muted-foreground">
                  · max{" "}
                  <span className="font-medium text-foreground">
                    {formatCompanyNumber(picked.available_qty, company)} {uom}
                  </span>
                </span>
              )}
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/[0.04] px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!picked || pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Book
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
