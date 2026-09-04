"use client";

import { useState } from "react";
import { Check, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";

import {
  sendThreePlDispatchLabelAction,
  type SendThreePlDispatchLabelInput,
} from "@/lib/realtime/actions";

/**
 * Row-level "Send label to laptop" affordance for the mobile 3PL
 * hub. Compact icon-only button (rows already carry a Cancel
 * strip); tap pings the paired laptop's PrintBridgeListener which
 * pops the print-copies dialog for the ``three_pl_dispatch`` label.
 *
 * Same posture as ``SendLabelToLaptopButton`` on /m/lots/[uuid] —
 * fire-and-forget; a click reports success whether or not the
 * laptop tab happens to be subscribed right now.
 */
export function SendLabelToLaptopButton(props: SendThreePlDispatchLabelInput) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (sending) return;
    setSending(true);
    try {
      const res = await sendThreePlDispatchLabelAction(props);
      if (res.ok) {
        setSent(true);
        setTimeout(() => setSent(false), 2000);
        toast.success("Sent to laptop", {
          description: props.item_name ?? props.dispatch_uuid.slice(0, 8),
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
      title="Send order label to laptop"
      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground active:bg-muted disabled:opacity-60"
    >
      {sending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : sent ? (
        <Check className="size-3 text-emerald-600" />
      ) : (
        <Printer className="size-3" />
      )}
      Label
    </button>
  );
}
