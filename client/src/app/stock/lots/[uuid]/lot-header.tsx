"use client";

import { useState } from "react";
import Link from "next/link";
import { HandCoins, Move, Printer, Package, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageLeadership } from "@/components/realtime/page-lock-guard";
import type { StockLot } from "@/lib/types";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import { formatCompanyNumber } from "@/lib/format/company";
import { PrintLabelDialog } from "../print-label-dialog";
import { MoveLotDialog } from "./move-lot-dialog";
import { AdjustQtyDialog } from "./adjust-qty-dialog";
import { IssueDialog } from "./issue-dialog";

/**
 * Hero card: lot code, item, status chip, qty on hand, top-line
 * actions. The Print label CTA reuses the existing dialog from the
 * list page (same modal, same PDF endpoint).
 */
export function LotHeader({
  lot,
  canMove,
  canAdjust,
  pageId,
}: {
  lot: StockLot;
  canMove: boolean;
  canAdjust: boolean;
  pageId?: string;
}) {
  const prefs = useFormatPrefs();
  const { isLeader, leader } = usePageLeadership(pageId ?? "", !pageId);
  const locked = !!pageId && !isLeader && !!leader;
  const [printOpen, setPrintOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);

  // Issue is the consumables draw-down flow — PPE, sanitiser, spare
  // parts, food-grade lube. Only surface the CTA when this lot is a
  // consumable AND currently available; other statuses aren't
  // meaningful to "issue" (quarantine still needs QC, rejected
  // shouldn't leave, etc).
  const isIssuableConsumable =
    lot.item?.item_type === "consumable" && lot.status === "available";

  const qtyOnHand = formatCompanyNumber(lot.qty_on_hand, prefs);
  const qtyReceived = formatCompanyNumber(lot.qty_received, prefs);
  const symbol = lot.unit_of_measurement?.symbol ?? "";

  return (
    <header className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <Package className="size-4 text-muted-foreground" />
            <span className="font-mono text-xs font-semibold text-muted-foreground">
              {lot.code ?? `#${lot.id}`}
            </span>
            <StatusChip status={lot.status} />
          </div>
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {lot.item?.uuid ? (
              <Link
                href={`/production/items/${lot.item.uuid}`}
                className="underline-offset-2 hover:underline"
              >
                {lot.item.name}
              </Link>
            ) : (
              lot.item?.name ?? "—"
            )}
          </h1>
          {lot.item?.code && lot.item?.uuid && (
            <p className="text-xs text-muted-foreground">
              <Link
                href={`/production/items/${lot.item.uuid}`}
                className="font-mono hover:text-foreground"
              >
                {lot.item.code}
              </Link>
              {lot.item.external_sku ? ` · ${lot.item.external_sku}` : ""}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPrintOpen(true)}
          >
            <Printer className="mr-1.5 size-4" />
            Print label
          </Button>
          {canAdjust && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (locked) return;
                setAdjustOpen(true);
              }}
              disabled={locked}
              title={locked ? "Only the head of the room can act here." : undefined}
            >
              <Scale className="mr-1.5 size-4" />
              Adjust qty
            </Button>
          )}
          {canAdjust && isIssuableConsumable && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (locked) return;
                setIssueOpen(true);
              }}
              disabled={locked}
              title={locked ? "Only the head of the room can act here." : undefined}
            >
              <HandCoins className="mr-1.5 size-4" />
              Issue
            </Button>
          )}
          {canMove && (
            <Button
              size="sm"
              onClick={() => {
                if (locked) return;
                setMoveOpen(true);
              }}
              disabled={locked}
              title={locked ? "Only the head of the room can act here." : undefined}
            >
              <Move className="mr-1.5 size-4" />
              Move
            </Button>
          )}
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Stat label="On hand" value={`${qtyOnHand} ${symbol}`} accent />
        <Stat label="Received" value={`${qtyReceived} ${symbol}`} />
        <Stat
          label="Placements"
          value={`${lot.placements.length}`}
        />
      </dl>

      <PrintLabelDialog
        lot={lot}
        open={printOpen}
        onOpenChange={setPrintOpen}
      />
      {canMove && (
        <MoveLotDialog lot={lot} open={moveOpen} onOpenChange={setMoveOpen} />
      )}
      {canAdjust && (
        <AdjustQtyDialog
          lot={lot}
          open={adjustOpen}
          onOpenChange={setAdjustOpen}
        />
      )}
      {canAdjust && isIssuableConsumable && (
        <IssueDialog lot={lot} open={issueOpen} onOpenChange={setIssueOpen} />
      )}
    </header>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={
          accent
            ? "mt-0.5 font-mono text-lg font-semibold tracking-tight"
            : "mt-0.5 font-mono text-sm"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function StatusChip({ status }: { status: StockLot["status"] }) {
  const tone: Record<StockLot["status"], string> = {
    expected:
      "bg-indigo-500/10 text-indigo-700 ring-indigo-500/30 dark:text-indigo-400",
    requested:
      "bg-indigo-500/10 text-indigo-700 ring-indigo-500/30 dark:text-indigo-400",
    received:
      "bg-sky-500/10 text-sky-700 ring-sky-500/30 dark:text-sky-400",
    quarantine:
      "bg-orange-500/10 text-orange-700 ring-orange-500/30 dark:text-orange-400",
    awaiting_release:
      "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-400",
    available:
      "bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-400",
    on_hold:
      "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-400",
    depleted:
      "bg-zinc-500/10 text-zinc-600 ring-zinc-500/30 dark:text-zinc-400",
    disposed: "bg-red-500/10 text-red-700 ring-red-500/30 dark:text-red-400",
    rejected: "bg-red-500/10 text-red-700 ring-red-500/30 dark:text-red-400",
    canceled: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/30 dark:text-zinc-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone[status] ?? tone.received}`}
    >
      {status}
    </span>
  );
}
