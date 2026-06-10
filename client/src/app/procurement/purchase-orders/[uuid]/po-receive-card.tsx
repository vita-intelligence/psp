"use client";

import { useState } from "react";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PurchaseOrder, Warehouse } from "@/lib/types";
import { PoReceiveDialog } from "./po-receive-dialog";

interface Props {
  po: PurchaseOrder;
  warehouses: Warehouse[];
  canReceive: boolean;
}

export function POReceiveCard({ po, warehouses, canReceive }: Props) {
  const [open, setOpen] = useState(false);

  const outstanding = po.lines.reduce((acc, l) => {
    const r = Number(l.qty_ordered) - Number(l.qty_received || 0);
    return acc + (r > 0 ? r : 0);
  }, 0);

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Truck className="size-4 text-muted-foreground" />
            Receive against this PO
          </h2>
          <p className="text-xs text-muted-foreground">
            {outstanding > 0
              ? `${outstanding} units still outstanding across all lines.`
              : "Fully received."}
          </p>
        </div>
        {canReceive && outstanding > 0 && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Truck className="mr-1.5 size-4" />
            Record receipt
          </Button>
        )}
      </header>

      {canReceive && (
        <PoReceiveDialog
          po={po}
          warehouses={warehouses}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </section>
  );
}
