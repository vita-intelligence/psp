"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Box, Loader2, Truck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { ErrorBanner } from "@/components/forms/error-banner";
import type { PurchaseOrder, Warehouse } from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import { receivePOAction } from "@/lib/purchase-orders/actions";

interface Props {
  po: PurchaseOrder;
  warehouses: Warehouse[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PoReceiveDialog({ po, warehouses, open, onOpenChange }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  const [warehouseId, setWarehouseId] = useState("");
  const [batch, setBatch] = useState("");
  const [pkgLength, setPkgLength] = useState("100");
  const [pkgWidth, setPkgWidth] = useState("100");
  const [pkgHeight, setPkgHeight] = useState("100");
  const [pkgWeight, setPkgWeight] = useState("1");
  const [unitsPer, setUnitsPer] = useState("1");
  const [stack, setStack] = useState("1");

  // Initial per-line qty defaults to remaining (ordered − received).
  const initialQty = useMemo(() => {
    const m: Record<string, string> = {};
    for (const l of po.lines) {
      const remaining = Number(l.qty_ordered) - Number(l.qty_received || 0);
      m[l.uuid] = remaining > 0 ? String(remaining) : "0";
    }
    return m;
  }, [po.lines]);
  const [lineQty, setLineQty] = useState<Record<string, string>>(initialQty);

  function setQty(lineUuid: string, value: string) {
    setLineQty((q) => ({ ...q, [lineUuid]: value }));
  }

  const eligibleLines = po.lines.filter(
    (l) =>
      Number(l.qty_ordered) - Number(l.qty_received || 0) > 0,
  );

  const canSubmit =
    warehouseId !== "" &&
    eligibleLines.some((l) => Number(lineQty[l.uuid] || 0) > 0);

  function onSubmit() {
    if (!canSubmit) return;
    setError(null);
    const lines = eligibleLines
      .map((l) => ({ line_uuid: l.uuid, qty: lineQty[l.uuid] || "0" }))
      .filter((x) => Number(x.qty) > 0);

    startTransition(async () => {
      const res = await receivePOAction(po.uuid, {
        warehouse_id: Number(warehouseId),
        supplier_batch_no: batch.trim() || null,
        package_length_mm: Number(pkgLength),
        package_width_mm: Number(pkgWidth),
        package_height_mm: Number(pkgHeight),
        package_weight_kg: pkgWeight,
        units_per_package: Number(unitsPer),
        stack_factor: Number(stack),
        lines,
      });
      if (res.ok) {
        toast.success("Receipt recorded");
        onOpenChange(false);
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="size-4 text-muted-foreground" />
            Receive against PO
          </DialogTitle>
          <DialogDescription>
            Each line creates a lot tagged with{" "}
            <span className="font-mono">{po.code ?? `#${po.id}`}</span>. Lot
            lands in the warehouse's Holding Room until you scan it onto a
            shelf.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {error && (
            <ErrorBanner
              detail={error.detail}
              code={error.code}
              debug={error.debug}
            />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Warehouse
              </Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Pick a warehouse…" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Supplier batch
              </Label>
              <Input
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                placeholder="BATCH-AA-42"
              />
            </div>
          </div>

          <details className="rounded-md border border-border/60 px-3 py-2 text-sm">
            <summary className="flex cursor-pointer items-center gap-2 font-medium">
              <Box className="size-4 text-muted-foreground" />
              Packaging (applies to all lines)
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <PkgField label="Length (mm)" value={pkgLength} onChange={setPkgLength} />
              <PkgField label="Width (mm)" value={pkgWidth} onChange={setPkgWidth} />
              <PkgField label="Height (mm)" value={pkgHeight} onChange={setPkgHeight} />
              <PkgField label="Weight (kg)" value={pkgWeight} onChange={setPkgWeight} />
              <PkgField label="Units / pkg" value={unitsPer} onChange={setUnitsPer} />
              <PkgField label="Stack factor" value={stack} onChange={setStack} />
            </div>
          </details>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Lines
            </Label>
            <div className="overflow-hidden rounded-md border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Remaining</th>
                    <th className="px-3 py-2 text-right font-medium">Receive now</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {eligibleLines.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-xs text-muted-foreground">
                        Nothing left to receive on this PO.
                      </td>
                    </tr>
                  ) : (
                    eligibleLines.map((l) => {
                      const remaining =
                        Number(l.qty_ordered) - Number(l.qty_received || 0);
                      return (
                        <tr key={l.uuid}>
                          <td className="px-3 py-2">
                            <p className="text-sm font-medium">
                              {l.item?.name ?? `Item #${l.item_id}`}
                            </p>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-sm text-muted-foreground">
                            {remaining}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              className="h-8 w-24 font-mono"
                              inputMode="decimal"
                              value={lineQty[l.uuid] ?? ""}
                              onChange={(e) => setQty(l.uuid, e.target.value)}
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={pending || !canSubmit}>
            {pending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Record receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PkgField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <Input
        className="h-8 font-mono"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
