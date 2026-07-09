"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Machine, MachineSummary } from "@/lib/production/types";
import { PrintMachineLabelDialog } from "./print-machine-label-dialog";

interface Props {
  machine: Machine | MachineSummary;
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "default";
}

/**
 * "Print label" button + dialog wrapper. Kept client-side so the
 * detail page (server component) can drop it in as `actions` on the
 * PageHeader without leaking client state into the RSC boundary.
 */
export function PrintMachineLabelButton({
  machine,
  size = "sm",
  variant = "outline",
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <Printer className="mr-1.5 size-4" />
        Print label
      </Button>
      <PrintMachineLabelDialog
        machine={machine}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
