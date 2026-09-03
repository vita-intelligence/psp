"use client";

import { useState } from "react";
import { Check, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";

import { sendStockLotLabelAction } from "@/lib/realtime/actions";

/**
 * Phone → laptop print bridge, keyed on a stock lot.
 *
 * Same posture as the goods-in wizard's "Send to laptop" button
 * (see `mobile-inspection-wizard.tsx :: sendQuarantineLabelAction`),
 * just for the regular stock label rather than the quarantine
 * variant. Fires-and-forgets — Phoenix PubSub, so a click reports
 * success whether or not the operator's laptop tab happens to be
 * subscribed right now.
 */
interface Props {
  readonly lotUuid: string;
  readonly lotCode: string;
  readonly itemName: string;
  readonly qty: string;
  readonly uomSymbol: string | null;
  readonly supplierBatchNo: string | null;
}

export function SendLabelToLaptopButton({
  lotUuid,
  lotCode,
  itemName,
  qty,
  uomSymbol,
  supplierBatchNo,
}: Props) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onClick() {
    if (sending) return;
    setSending(true);
    try {
      const res = await sendStockLotLabelAction({
        lot_uuid: lotUuid,
        lot_code: lotCode,
        item_name: itemName,
        qty,
        uom_symbol: uomSymbol,
        supplier_batch_no: supplierBatchNo,
      });
      if (res.ok) {
        setSent(true);
        toast.success("Sent to laptop", {
          description: `${itemName} · ${lotCode}`,
        });
      } else {
        toast.error("Couldn't reach the laptop", { description: res.detail });
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={sending}
      className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-4 active:bg-muted disabled:opacity-70"
    >
      <span className="grid size-9 place-items-center rounded-full bg-brand/15 text-brand">
        {sending ? (
          <Loader2 className="size-5 animate-spin" />
        ) : sent ? (
          <Check className="size-5" />
        ) : (
          <Printer className="size-5" />
        )}
      </span>
      <div className="flex-1 min-w-0 text-left">
        <p className="text-sm font-semibold">
          {sent ? "Sent to laptop" : "Send label to laptop"}
        </p>
        <p className="text-xs text-muted-foreground">
          {sent
            ? "Print dialog is open on your laptop. Tap again to resend."
            : "Opens the print dialog on your laptop — pick copies, hit print."}
        </p>
      </div>
    </button>
  );
}
