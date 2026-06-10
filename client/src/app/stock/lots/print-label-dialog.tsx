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
import type { StockLot } from "@/lib/types";

interface Props {
  lot: StockLot | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "How many labels?" modal, MRPEasy-style. Submitting opens the PDF
 * endpoint in a new tab — the browser's PDF viewer takes over for
 * the actual preview + print.
 *
 * Stays a controlled component (parent owns `open` + `lot`) so the
 * list table can swap lots in/out without remounting.
 */
export function PrintLabelDialog({ lot, open, onOpenChange }: Props) {
  // Stored as a string so the user can pass through transient
  // intermediate states (empty, "10", "100") without the controlled
  // input fighting them — clamping mid-keystroke was rejecting "99"
  // and "100" on the spinner. Final clamp happens on submit.
  const [copiesText, setCopiesText] = useState("1");

  // Reset back to 1 every time the modal opens for a new lot.
  useEffect(() => {
    if (open) setCopiesText("1");
  }, [open, lot?.uuid]);

  function onPrint(e: React.FormEvent) {
    e.preventDefault();
    if (!lot) return;
    const n = parseInt(copiesText, 10);
    const copies = Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 1;
    const url = `/api/stock/lots/${encodeURIComponent(lot.uuid)}/label.pdf?copies=${copies}`;
    window.open(url, "_blank", "noopener");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Print label</DialogTitle>
          <DialogDescription>
            {lot
              ? `Lot ${lot.code ?? lot.id}${lot.item ? " · " + lot.item.name : ""}.`
              : null}
            <br />
            How many labels do you want to print? Up to 100 labels.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onPrint} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="label-copies" className="sr-only">
              Copies
            </Label>
            <Input
              id="label-copies"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              step={1}
              value={copiesText}
              onChange={(e) => setCopiesText(e.target.value)}
              onBlur={(e) => {
                // Snap to a valid value on blur so the displayed
                // number always reflects what we'd actually print.
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
