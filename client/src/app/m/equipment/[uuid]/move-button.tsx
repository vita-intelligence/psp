import Link from "next/link";
import { Move } from "lucide-react";

/**
 * Entry point for the mobile move flow — mirrors the lot flow's
 * "Move to shelf" card. Navigates to a dedicated
 * `/m/equipment/[uuid]/move/` route so the wizard has the full
 * viewport (camera step, floor-plan preview, step counter) rather
 * than a cramped dialog.
 */
export function MoveButton({ uuid }: { uuid: string }) {
  return (
    <Link
      href={`/m/equipment/${uuid}/move`}
      className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-4 active:bg-muted"
    >
      <span className="grid size-9 place-items-center rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-400">
        <Move className="size-5" />
      </span>
      <div className="flex-1 min-w-0 text-left">
        <p className="text-sm font-semibold">Move to a cell</p>
        <p className="text-xs text-muted-foreground">
          Pick a cell, get walking directions, scan the shelf QR to
          confirm — or record a free-text off-floor location.
        </p>
      </div>
    </Link>
  );
}
