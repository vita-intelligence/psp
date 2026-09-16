"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Equipment } from "@/lib/equipment/types";

interface Props {
  equipment: Equipment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "How many labels?" modal for the equipment PDF endpoint. Mirrors
 * the stock-lot print dialog so operators recognise it. Submitting
 * opens the PDF endpoint in a new tab — the browser's PDF viewer
 * handles preview + print.
 */
export function PrintEquipmentLabelDialog({ equipment, open, onOpenChange }: Props) {
  // Stored as a string so the user can pass through transient states
  // (empty, "10", "100") without the controlled input fighting them.
  // Final clamp happens on submit / blur.
  const [copiesText, setCopiesText] = useState("1");

  useEffect(() => {
    if (open) setCopiesText("1");
  }, [open, equipment?.uuid]);

  function onPrint(e: React.FormEvent) {
    e.preventDefault();
    if (!equipment) return;
    const n = parseInt(copiesText, 10);
    const copies = Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 1;
    const url = `/api/equipment/${encodeURIComponent(equipment.uuid)}/label.pdf?copies=${copies}`;
    window.open(url, "_blank", "noopener");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Print equipment label</DialogTitle>
          <DialogDescription>
            {equipment ? (
              <>
                {equipment.item?.name ?? equipment.model ?? "Equipment"} ·{" "}
                <span className="font-mono">{equipment.serial_number}</span>
                <br />
              </>
            ) : null}
            100×60 mm thermal label with QR that scans to the mobile
            page. Up to 100 copies.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onPrint} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="equipment-label-copies" className="sr-only">
              Copies
            </Label>
            <Input
              id="equipment-label-copies"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              step={1}
              value={copiesText}
              onChange={(e) => setCopiesText(e.target.value)}
              onBlur={(e) => {
                const n = parseInt(e.target.value, 10);
                const clamped = Number.isFinite(n)
                  ? Math.max(1, Math.min(100, n))
                  : 1;
                setCopiesText(String(clamped));
              }}
              autoFocus
              className="h-11 text-lg"
            />
          </div>

          <DialogFooter className="sm:justify-stretch">
            <Button type="submit" className="w-full" size="lg">
              <Printer className="mr-1.5 size-4" />
              Print
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
