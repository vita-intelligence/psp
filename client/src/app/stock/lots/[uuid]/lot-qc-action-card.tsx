"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { usePageLeadership } from "@/components/realtime/page-lock-guard";
import { recordLotEventAction } from "@/lib/stock/actions";

/**
 * Inline QC action card on the lot detail page. Surfaces a "Mark as
 * QC-passed" button for lots stuck at status `received` or
 * `quarantine` — the manual path for opening-balance / non-PO lots
 * that have no Goods-In Inspection to ride on.
 *
 * Hidden once the lot is past QC (available / on_hold / etc.) and
 * for viewers without `stock.qc`. The BE re-checks the permission, so
 * a missing client-side gate would just surface as a 403 toast — but
 * we hide the card anyway to keep the surface honest.
 */
export function LotQcActionCard({
  lotUuid,
  lotStatus,
  itemName,
  sourceKind,
  canRecordQc,
  pageId,
}: {
  lotUuid: string;
  lotStatus: string;
  itemName: string | null;
  sourceKind: string | null;
  canRecordQc: boolean;
  pageId?: string;
}) {
  const router = useRouter();
  const { isLeader, leader } = usePageLeadership(pageId ?? "", !pageId);
  const locked = !!pageId && !isLeader && !!leader;
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  if (!canRecordQc) return null;
  if (lotStatus !== "received" && lotStatus !== "quarantine") return null;

  const isOpeningBalance = sourceKind === "opening_balance";
  const headline = isOpeningBalance
    ? "Opening-balance lot — waiting on QC clearance."
    : "Lot is awaiting QC clearance.";

  const blurb = isOpeningBalance
    ? "This lot was created as part of an opening-balance snapshot, so it never went through a Goods-In inspection. Record a QC-pass event so it can be booked against MOs and released to production."
    : "Lots stay at status `received` until a QC verdict fires. Record a QC-pass here only when the goods bypass the Goods-In inspection workflow (e.g. a manual lot you've already inspected offline).";

  function onPassQc() {
    if (locked) return;
    startTransition(async () => {
      const res = await recordLotEventAction(
        lotUuid,
        "qc_passed",
        reason.trim() ||
          (isOpeningBalance
            ? "Opening-balance lot — QC cleared retroactively"
            : null),
      );
      if (!res.ok) {
        toast.error(res.detail ?? "Couldn't mark the lot as QC-passed.");
        return;
      }
      toast.success(
        itemName
          ? `${itemName} marked as QC-passed.`
          : "Lot marked as QC-passed.",
      );
      setReason("");
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-950/30">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" />
        <div className="space-y-1">
          <h2 className="text-sm font-semibold leading-tight">{headline}</h2>
          <p className="text-sm text-muted-foreground">{blurb}</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="qc-reason"
          className="text-xs uppercase tracking-wider text-muted-foreground"
        >
          Reason (optional)
        </Label>
        <Textarea
          id="qc-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this lot being cleared without a Goods-In inspection?"
          rows={2}
          disabled={pending}
        />
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          onClick={onPassQc}
          disabled={pending || locked}
          title={locked ? "Only the head of the room can act here." : undefined}
          className="gap-1"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="size-3.5" />
          )}
          Mark as QC-passed
        </Button>
      </div>
    </section>
  );
}
