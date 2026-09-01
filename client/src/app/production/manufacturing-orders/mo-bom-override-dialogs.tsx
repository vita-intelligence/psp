"use client";

/**
 * Per-MO BOM override dialogs. Master BOM is never touched — every
 * mutation records a delta on the MO (`added` / `qty_changed` /
 * `removed`) that the effective-BOM helper layers on top when
 * projecting parts, booking, and the release-time shortage gate.
 *
 * All three dialogs are only rendered when `mo.can_override_bom`
 * (server-side gate: MO status ∈ {draft, prepared}). The parent
 * component enforces the same gate for the affordances that open
 * them.
 */

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
import {
  SearchPicker,
  type SearchPickerOption,
} from "@/components/forms/search-picker";
import {
  applyBomOverrideAction,
  revertBomOverrideAction,
} from "@/lib/production/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import type {
  ManufacturingOrder,
  ManufacturingOrderPart,
} from "@/lib/production/types";

interface ItemPickerOption extends SearchPickerOption {
  itemId: number;
  uomId: number | null;
  uomSymbol: string;
}

async function fetchItemOptions(
  query: string,
  signal?: AbortSignal,
): Promise<ItemPickerOption[]> {
  const qs = new URLSearchParams({ picker: "true", limit: "50" });
  if (query) qs.set("search", query);
  const res = await fetch(`/api/items?${qs.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    items: Array<{
      id: number;
      uuid: string;
      code: string | null;
      name: string;
      stock_uom?: { id?: number | null; symbol?: string | null } | null;
    }>;
  };
  return body.items.map((i) => ({
    id: i.id,
    itemId: i.id,
    label: i.name,
    code: i.code,
    sublabel: null,
    uomId: i.stock_uom?.id ?? null,
    uomSymbol: i.stock_uom?.symbol ?? "ea",
  }));
}

// -----------------------------------------------------------------
// Qty override — planner nudges the per-output qty on this MO only.
// -----------------------------------------------------------------

interface QtyEditProps {
  mo: ManufacturingOrder;
  part: ManufacturingOrderPart;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QtyOverrideDialog({ mo, part, open, onOpenChange }: QtyEditProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initial = part.line_qty ?? "";
  const [qty, setQty] = useState(initial);
  const uom =
    part.unit_of_measurement?.symbol ?? part.part?.stock_uom?.symbol ?? "";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = qty.trim();
    if (!trimmed || Number(trimmed) <= 0) {
      toast.error("Qty must be a positive number.");
      return;
    }
    startTransition(async () => {
      const res = await applyBomOverrideAction(mo.uuid, {
        action: "qty_changed",
        bom_line_id: part.id,
        to_qty: trimmed,
      });
      if (res.ok) {
        toast.success("Qty updated for this MO.");
        invalidateAudit("manufacturing_order", mo.id);
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Override qty for this MO</DialogTitle>
          <DialogDescription>
            Master BOM stays as-is. Only this run uses the new qty; the
            change is recorded on the MO with your name + timestamp.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
            <p className="font-medium">{part.part?.name ?? `Item #${part.part?.id ?? "?"}`}</p>
            {part.part?.code && (
              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                {part.part.code}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qty">Per-output qty {uom ? `(${uom})` : ""}</Label>
            <Input
              id="qty"
              type="number"
              step="any"
              min="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              Master BOM says {part.line_qty ?? "—"}.
              {part.is_fixed
                ? " Fixed line — the whole qty is used per batch, not per output."
                : " Multiplied by MO output qty to compute Required."}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              Save override
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------
// Remove line — reason required, per compliance guidance in CLAUDE.md.
// -----------------------------------------------------------------

interface RemoveProps {
  mo: ManufacturingOrder;
  part: ManufacturingOrderPart;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RemoveLineDialog({ mo, part, open, onOpenChange }: RemoveProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      toast.error("Give a reason for removing this line.");
      return;
    }
    startTransition(async () => {
      const res = await applyBomOverrideAction(mo.uuid, {
        action: "removed",
        bom_line_id: part.id,
        reason: reason.trim(),
      });
      if (res.ok) {
        toast.success("Line removed for this MO.");
        invalidateAudit("manufacturing_order", mo.id);
        onOpenChange(false);
        setReason("");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Remove component from this MO</DialogTitle>
          <DialogDescription>
            The master BOM stays untouched. This MO will neither book
            nor consume the line — the removal + reason is stored on the
            MO for audit.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
            <p className="font-medium">{part.part?.name ?? `Item #${part.part?.id ?? "?"}`}</p>
            {part.part?.code && (
              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                {part.part.code}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="remove-reason">Reason (shown in the audit log)</Label>
            <textarea
              id="remove-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              autoFocus
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="e.g. Individual capsules — no packaging needed for this run"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              Remove line
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------
// Add BOM line — inject a one-off component into this MO only.
// -----------------------------------------------------------------

interface AddLineProps {
  mo: ManufacturingOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddBomLineDialog({ mo, open, onOpenChange }: AddLineProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<ItemPickerOption | null>(null);
  const [qty, setQty] = useState("");
  // Default matches the natural mental model when adding a line to
  // a SPECIFIC MO — the operator is thinking about this run, not
  // about a per-finished-unit rate. The qty they type IS the total
  // for this MO. Advanced users can opt into the per-unit multiplier
  // via the checkbox below when they genuinely want the qty to scale
  // with ``mo.quantity``. Pre-flip the default was ``false`` (per-unit),
  // which made a "1 pouch" input on a 0.05-pack trial-batch MO become
  // ``1 × 0.05 = 0.05`` — physically nonsense for a count item — and
  // required the operator to hunt for a checkbox to get the obvious
  // behaviour.
  const [isFixed, setIsFixed] = useState(true);

  function reset() {
    setPicked(null);
    setQty("");
    setIsFixed(true);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) {
      toast.error("Pick an item first.");
      return;
    }
    const trimmed = qty.trim();
    if (!trimmed || Number(trimmed) <= 0) {
      toast.error("Qty must be a positive number.");
      return;
    }
    startTransition(async () => {
      const res = await applyBomOverrideAction(mo.uuid, {
        action: "added",
        item_id: picked.itemId,
        to_qty: trimmed,
        unit_of_measurement_id: picked.uomId,
        is_fixed: isFixed,
      });
      if (res.ok) {
        toast.success("Line added for this MO.");
        invalidateAudit("manufacturing_order", mo.id);
        reset();
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add a component to this MO</DialogTitle>
          <DialogDescription>
            The item joins THIS MO's BOM only. The master recipe stays
            as-is. Once you save, it books + picks like any other line.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Item</Label>
            <SearchPicker<ItemPickerOption>
              value={picked}
              onChange={setPicked}
              fetcher={fetchItemOptions}
              placeholder="Search items…"
              emptyHint="No items match that search."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-qty">
              {isFixed ? "Quantity for this MO" : "Per-output qty"}
              {picked?.uomSymbol ? ` (${picked.uomSymbol})` : ""}
            </Label>
            <Input
              id="add-qty"
              type="number"
              step="any"
              min="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {isFixed
                ? "The number you type is the total for this MO."
                : "The number will be multiplied by the MO's output qty to compute the total."}
            </p>
          </div>
          <label className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={!isFixed}
              onChange={(e) => setIsFixed(!e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5"
            />
            <span>
              <span className="font-medium">Multiply by output qty</span>{" "}
              <span className="text-muted-foreground">
                (advanced — for per-finished-unit BOM lines that should
                scale with this MO's stock quantity)
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              Add line
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------
// Small helper the parts table calls from an inline row control.
// -----------------------------------------------------------------

export function useRevertOverride(mo: ManufacturingOrder) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function revert(overrideUuid: string, successMsg: string) {
    startTransition(async () => {
      const res = await revertBomOverrideAction(mo.uuid, overrideUuid);
      if (res.ok) {
        toast.success(successMsg);
        invalidateAudit("manufacturing_order", mo.id);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return { revert, pending };
}
