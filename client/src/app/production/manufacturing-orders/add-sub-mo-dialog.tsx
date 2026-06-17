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
import { createManufacturingOrderAction } from "@/lib/production/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import type { CompanyDefaults } from "@/lib/types";
import type {
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
 * Manually spawn another sub-MO under the same ingredient line.
 * Use case: the auto-spawned sub-MO produced less than planned
 * (spillage / yield loss on powder) — operator tops up by adding a
 * second sub-MO for the missing qty. Pre-fills item + site + the
 * remaining-needed gap so it's a one-click confirm in the common
 * case.
 */
export function AddSubMoDialog({
  mo,
  part,
  company,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const uom =
    part.unit_of_measurement?.symbol ?? part.part?.stock_uom?.symbol ?? "";

  const required = Number(part.required_qty ?? "0");
  const booked = Number(part.booked_qty ?? "0");
  const pending = Number(part.pending_from_sub_mos_qty ?? "0");
  const stillNeeded = Math.max(required - booked - pending, 0);

  const [qty, setQty] = useState<string>(
    stillNeeded > 0 ? String(stillNeeded) : "",
  );
  const [creating, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!part.part) return null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }

    startTransition(async () => {
      // Find the primary BOM for the part on the server side via the
      // existing MO-create flow — it auto-resolves bom_id when missing.
      const res = await createManufacturingOrderAction({
        warehouse_id: mo.warehouse_id,
        item_id: part.part!.id,
        quantity: String(n),
        start_at: mo.start_at,
        finish_at: mo.start_at,
        assigned_to_id: mo.assigned_to_id,
        revision: mo.revision,
        // Linking to parent so it shows in the roadmap + blocks
        // parent's in_progress transition until completed.
        parent_mo_id: mo.id,
      });

      if (res.ok) {
        toast.success(
          `Sub-MO ${res.mo.code ?? `#${res.mo.id}`} created for ${formatCompanyNumber(String(n), company)} ${uom} of ${part.part!.name}.`,
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a sub-MO</DialogTitle>
          <DialogDescription>
            Spawn another sub-production run for{" "}
            <span className="font-medium text-foreground">
              {part.part.name}
            </span>{" "}
            under this MO. Use when the auto-spawned sub-MO produced less
            than planned or when you simply need a top-up.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Required</dt>
            <dd className="font-mono">
              {formatCompanyNumber(part.required_qty ?? "0", company)} {uom}
            </dd>
            <dt className="text-muted-foreground">Booked from stock</dt>
            <dd className="font-mono">
              {formatCompanyNumber(part.booked_qty ?? "0", company)} {uom}
            </dd>
            <dt className="text-muted-foreground">Pending sub-MOs</dt>
            <dd className="font-mono">
              {formatCompanyNumber(
                part.pending_from_sub_mos_qty ?? "0",
                company,
              )}{" "}
              {uom}
            </dd>
            <dt className="text-muted-foreground">Still needed</dt>
            <dd
              className={
                stillNeeded > 0
                  ? "font-mono font-semibold text-amber-700 dark:text-amber-300"
                  : "font-mono font-semibold text-emerald-700 dark:text-emerald-300"
              }
            >
              {formatCompanyNumber(String(stillNeeded), company)} {uom}
            </dd>
          </dl>

          <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-3 sm:items-center">
            <Label htmlFor="qty" className="text-sm font-medium">
              Sub-MO qty
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="qty"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                inputMode="decimal"
                disabled={creating}
                placeholder="0"
                className="h-10 max-w-[10rem] font-mono"
              />
              <span className="text-xs text-muted-foreground">{uom}</span>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            The sub-MO inherits the parent&apos;s site, schedule, and assignee.
            It also auto-books FEFO + cascades its own sub-MOs if needed.
          </p>

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
              disabled={creating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create sub-MO
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
