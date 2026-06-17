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
  transitionManufacturingOrderAction,
  updateManufacturingOrderAction,
} from "@/lib/production/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import type { CompanyDefaults } from "@/lib/types";
import type {
  ManufacturingOrder,
  ManufacturingOrderPart,
  ManufacturingOrderRelation,
} from "@/lib/production/types";

interface Props {
  mo: ManufacturingOrder;
  part: ManufacturingOrderPart;
  child: ManufacturingOrderRelation;
  company: CompanyDefaults;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Adjust or cancel a sub-MO that was auto-spawned (or manually
 * added) to cover this ingredient line. Modelled on the
 * "Release stock item" dialog so the operator's mental model is
 * the same: lower the qty to release some, set to 0 / use the
 * Release-all button to cancel the whole sub-MO.
 *
 * Reducing qty hits update_manufacturing_order; cancelling hits the
 * transition endpoint with `cancelled`. Either way the parent's
 * coverage math recomputes on the next page render.
 */
export function ReleaseSubMoDialog({
  mo,
  part,
  child,
  company,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const uom =
    part.unit_of_measurement?.symbol ?? part.part?.stock_uom?.symbol ?? "";

  const [keep, setKeep] = useState(child.quantity);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editable = child.status === "draft" || child.status === "approved";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const n = Number(keep);
    if (!Number.isFinite(n) || n < 0) {
      setError("Quantity must be zero or more.");
      return;
    }

    if (!editable && n !== Number(child.quantity)) {
      setError(
        `Sub-MO is in "${child.status}" — qty can only be changed while in draft or approved.`,
      );
      return;
    }

    startTransition(async () => {
      if (n === 0) {
        const res = await transitionManufacturingOrderAction(
          child.uuid,
          "cancelled",
        );
        if (res.ok) {
          toast.success("Sub-MO cancelled.");
          invalidateAudit("manufacturing_order", mo.id);
          invalidateAudit("manufacturing_order", child.id);
          onOpenChange(false);
          router.refresh();
        } else {
          setError(res.detail);
        }
        return;
      }

      if (n >= Number(child.quantity)) {
        setError(
          `Quantity must be less than the planned amount (${child.quantity} ${uom}) to release. Use 0 to cancel the whole sub-MO.`,
        );
        return;
      }

      const res = await updateManufacturingOrderAction(child.uuid, {
        quantity: String(n),
      });

      if (res.ok) {
        toast.success(
          `Sub-MO reduced to ${formatCompanyNumber(String(n), company)} ${uom}.`,
        );
        invalidateAudit("manufacturing_order", mo.id);
        invalidateAudit("manufacturing_order", child.id);
        onOpenChange(false);
        router.refresh();
      } else {
        setError(res.detail);
      }
    });
  }

  function onCancelAll() {
    setError(null);
    startTransition(async () => {
      const res = await transitionManufacturingOrderAction(
        child.uuid,
        "cancelled",
      );
      if (res.ok) {
        toast.success("Sub-MO cancelled.");
        invalidateAudit("manufacturing_order", mo.id);
        invalidateAudit("manufacturing_order", child.id);
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
          <DialogTitle>Release sub-production</DialogTitle>
          <DialogDescription>
            Reduce the planned qty on{" "}
            <span className="font-mono text-foreground">
              {child.code ?? `MO #${child.id}`}
            </span>{" "}
            or cancel it entirely. Cancelling drops this MO&apos;s coverage
            and you&apos;ll see the gap as Partial.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Producing</dt>
            <dd>{part.part?.name ?? "—"}</dd>
            <dt className="text-muted-foreground">Sub-MO</dt>
            <dd className="font-mono">{child.code ?? `#${child.id}`}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="capitalize">{child.status.replace("_", " ")}</dd>
            <dt className="text-muted-foreground">Planned qty</dt>
            <dd className="font-mono">
              {formatCompanyNumber(child.quantity, company)} {uom}
            </dd>
          </dl>

          <div className="grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-3 sm:items-center">
            <Label htmlFor="keep" className="text-sm font-medium">
              Keep planned
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="keep"
                value={keep}
                onChange={(e) => setKeep(e.target.value)}
                inputMode="decimal"
                disabled={pending || !editable}
                className="h-10 max-w-[10rem] font-mono"
              />
              <span className="text-xs text-muted-foreground">{uom}</span>
            </div>
          </div>

          {!editable && (
            <p className="rounded-md border border-amber-500/30 bg-amber-50/40 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
              This sub-MO is already <span className="font-medium">{child.status.replace("_", " ")}</span> — you can only release the whole thing now.
            </p>
          )}

          <p className="text-[11px] text-muted-foreground">
            Lower the value to free some planned qty. Set to{" "}
            <span className="font-mono">0</span> to cancel the whole sub-MO.
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
              onClick={onCancelAll}
            >
              Cancel sub-MO
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Close
              </Button>
              <Button type="submit" disabled={pending || !editable}>
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
