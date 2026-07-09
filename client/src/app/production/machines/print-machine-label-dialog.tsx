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
import type { Machine, MachineSummary } from "@/lib/production/types";

interface Props {
  machine: Machine | MachineSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "How many labels?" modal for a machine, mirroring the lot flow.
 * Submitting opens the PDF endpoint in a new tab; the browser's PDF
 * viewer takes over for preview + print.
 */
export function PrintMachineLabelDialog({ machine, open, onOpenChange }: Props) {
  const [copiesText, setCopiesText] = useState("1");

  useEffect(() => {
    if (open) setCopiesText("1");
  }, [open, machine?.uuid]);

  function onPrint(e: React.FormEvent) {
    e.preventDefault();
    if (!machine) return;
    const n = parseInt(copiesText, 10);
    const copies = Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 1;
    const url = `/api/production/machines/${encodeURIComponent(
      machine.uuid,
    )}/label.pdf?copies=${copies}`;
    window.open(url, "_blank", "noopener");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Print machine label</DialogTitle>
          <DialogDescription>
            {machine
              ? `${machine.name}${machine.asset_tag ? " · " + machine.asset_tag : ""}.`
              : null}
            <br />
            How many labels do you want to print? Up to 100 labels.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onPrint} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="machine-label-copies" className="sr-only">
              Copies
            </Label>
            <Input
              id="machine-label-copies"
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
