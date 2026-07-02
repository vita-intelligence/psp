"use client";

import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import type { StockLot } from "@/lib/types";

/**
 * One row on the mobile /m/putaway list. Compact — just enough for
 * the operator to pick the right lot. The full breadcrumb + floor
 * plan lives on the lot detail page (tap the row).
 */
export function PutawayRow({ lot }: { lot: StockLot }) {
  return (
    <li>
      <Link
        href={`/m/lots/${lot.uuid}`}
        className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-3 active:bg-muted"
      >
        <div className="flex-1 space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs font-semibold">
              {lot.code ?? `#${lot.id}`}
            </span>
            {lot.needs_release_quarantine_move ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300">
                <ShieldCheck className="size-2.5" />
                → Finished quarantine
              </span>
            ) : (
              <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                Unregistered
              </span>
            )}
          </div>
          <p className="truncate text-sm font-medium">
            {lot.item?.name ?? "—"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {lot.qty_on_hand ?? "—"} {lot.unit_of_measurement?.symbol ?? ""}
          </p>
          {lot.needs_release_quarantine_move && (
            <p className="text-[10px] text-sky-700 dark:text-sky-400">
              BRCGS 5.6 — scan into any finished-quarantine cell.
            </p>
          )}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}
