"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  cancelDispatchAction,
  cancelShipmentAndReturnAction,
} from "@/lib/three-pl/actions";

type Kind = "dispatch" | "shipment";

/**
 * Row-level Cancel button on the mobile 3PL hub. Tap surfaces an
 * inline confirm strip (a full dialog is overkill for the phone).
 *
 * kind="dispatch" — the Move tab. Cancelling only touches the
 *   pending Dispatch row; nothing has moved physically yet.
 *
 * kind="shipment" — the Paperwork + Pickup tabs. Cancelling flips
 *   the shipment to cancelled AND kicks the source dispatch into
 *   return_pending, so the picker sees a walk-back task on the
 *   Return tab. That's the important part — a Paperwork/Pickup
 *   cancel implies goods are still on the dispatch shelf and owe
 *   a walk home.
 */
export function CancelRowButton({ kind, uuid }: { kind: Kind; uuid: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res =
        kind === "dispatch"
          ? await cancelDispatchAction(uuid)
          : await cancelShipmentAndReturnAction(uuid);
      if (!res.ok) {
        toast.error(res.detail);
        setConfirming(false);
        return;
      }
      if (kind === "dispatch") {
        toast.success("Dispatch cancelled.");
      } else {
        toast.success("Cancelled. Walk the lot back on the Return tab.");
      }
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground active:bg-muted"
      >
        <X className="size-3" />
        Cancel
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="text-muted-foreground">
        {kind === "shipment"
          ? "Cancel + walk it back?"
          : "Cancel this dispatch?"}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        onClick={() => setConfirming(false)}
        disabled={pending}
      >
        No
      </Button>
      <Button
        variant="destructive"
        size="sm"
        className="h-7 px-2"
        onClick={submit}
        disabled={pending}
      >
        {pending && <Loader2 className="mr-1 size-3 animate-spin" />}
        Yes
      </Button>
    </div>
  );
}
