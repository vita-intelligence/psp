"use client";

import { useState } from "react";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendOpenUrlAction } from "@/lib/realtime/actions";

/**
 * Phone → laptop URL bridge for an equipment scan. Broadcasts a
 * `open_url` PubSub event to the operator's laptop channel; the
 * root layout's listener pops a confirmation and navigates the
 * open tab. Fires-and-forgets — reports success whether or not the
 * operator's laptop happens to be subscribed right now.
 */
interface Props {
  readonly uuid: string;
  readonly title: string;
}

export function SendToLaptopButton({ uuid, title }: Props) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onClick() {
    if (sending) return;
    setSending(true);
    try {
      const res = await sendOpenUrlAction({
        path: `/equipment/${uuid}`,
        title: title.slice(0, 120),
      });
      if (res.ok) {
        setSent(true);
        toast.success("Sent to laptop", { description: title });
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
          <ExternalLink className="size-5" />
        )}
      </span>
      <div className="flex-1 min-w-0 text-left">
        <p className="text-sm font-semibold">
          {sent ? "Sent to laptop" : "Send to laptop"}
        </p>
        <p className="text-xs text-muted-foreground">
          {sent
            ? "Your laptop just navigated to this equipment. Tap again to resend."
            : "Open the desktop detail page on your paired laptop."}
        </p>
      </div>
    </button>
  );
}
