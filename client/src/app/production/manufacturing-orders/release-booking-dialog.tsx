"use client";

import { useState, useTransition } from "react";
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
import { formatCompanyNumber } from "@/lib/format/company";
import {
  deleteBookingAction,
  updateBookingAction,
} from "@/lib/production/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import type { CompanyDefaults } from "@/lib/types";
import type {
  ManufacturingOrder,
  ManufacturingOrderBooking,
  ManufacturingOrderPart,
} from "@/lib/production/types";

interface Props {
  mo: ManufacturingOrder;
  part: ManufacturingOrderPart;
  booking: ManufacturingOrderBooking;
  company: CompanyDefaults;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * MRPEasy "Release stock item" dialog. Operator types a smaller qty
 * to release only part of the booking; submitting `0` (or clicking
 * Release all) deletes the row entirely.
 */
export function ReleaseBookingDialog({
  mo,
  part,
  booking,
  company,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const uom =
    part.unit_of_measurement?.symbol ?? part.part?.stock_uom?.symbol ?? "";
  const [keep, setKeep] = useState(booking.quantity);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const n = Number(keep);
    if (!Number.isFinite(n) || n < 0) {
      setError("Quantity must be zero or more.");
      return;
    }

    startTransition(async () => {
      if (n === 0) {
        const res = await deleteBookingAction(mo.uuid, booking.uuid);
        if (res.ok) {
          toast.success("Booking released.");
          invalidateAudit("manufacturing_order", mo.id);
          onOpenChange(false);
          router.refresh();
        } else {
          setError(res.detail);
        }
        return;
      }

      if (n >= Number(booking.quantity)) {
        setError(
          `Quantity must be less than the booked amount (${booking.quantity} ${uom}) to release. Use 0 to release the entire booking.`,
        );
        return;
      }

      const res = await updateBookingAction(mo.uuid, booking.uuid, {
        quantity: String(n),
      });
      if (res.ok) {
        toast.success(
          `Booking reduced to ${formatCompanyNumber(String(n), company)} ${uom}.`,
        );
        invalidateAudit("manufacturing_order", mo.id);
        onOpenChange(false);
        router.refresh();
      } else {
        setError(res.detail);
      }
    });
  }

  async function onReleaseAll() {
    setError(null);
    startTransition(async () => {
      const res = await deleteBookingAction(mo.uuid, booking.uuid);
      if (res.ok) {
        toast.success("Booking released.");
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Release stock item</DialogTitle>
          <DialogDescription>
            Reduce the booked qty on lot{" "}
            <span className="font-mono text-foreground">
              {booking.stock_lot?.code ?? "?"}
            </span>{" "}
            or release the whole booking.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Stock item</dt>
            <dd>{part.part?.name ?? "—"}</dd>
            <dt className="text-muted-foreground">Booked</dt>
            <dd className="font-mono">
              {formatCompanyNumber(booking.quantity, company)} {uom}
            </dd>
            <dt className="text-muted-foreground">Consumed</dt>
            <dd className="font-mono">
              {formatCompanyNumber(booking.consumed_quantity, company)} {uom}
            </dd>
            <dt className="text-muted-foreground">Lot</dt>
            <dd className="font-mono">{booking.stock_lot?.code ?? "—"}</dd>
            <dt className="text-muted-foreground">Storage</dt>
            <dd>{booking.storage_location?.name ?? "—"}</dd>
          </dl>

          <div className="grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-3 sm:items-center">
            <Label htmlFor="keep" className="text-sm font-medium">
              Keep booked
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="keep"
                value={keep}
                onChange={(e) => setKeep(e.target.value)}
                inputMode="decimal"
                disabled={pending}
                className="h-10 max-w-[10rem] font-mono"
              />
              <span className="text-xs text-muted-foreground">{uom}</span>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Lower the value to release some qty back to the lot. Set to{" "}
            <span className="font-mono">0</span> to release the entire
            booking.
          </p>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/[0.04] px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={pending}
              onClick={onReleaseAll}
            >
              Release all
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
