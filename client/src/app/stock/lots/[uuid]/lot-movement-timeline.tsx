"use client";

import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ImageOff,
  Move,
  Package,
  PackageMinus,
  PackagePlus,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import type { StockLotCellSummary, StockMovement } from "@/lib/types";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import { formatCompanyDate, formatCompanyNumber } from "@/lib/format/company";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/users/user-avatar";

interface Props {
  movements: StockMovement[];
  uomSymbol: string;
  /** Company-configured display name for system-managed cells.
   *  Falls back to "Holding Room" when the company hasn't set one. */
  holdingName: string;
}

/**
 * Vertical timeline. One row per movement, newest first (already
 * sorted by the backend). Each row leads with a kind chip, then the
 * qty delta, the from→to breadcrumb if it's a move, actor + relative
 * time on the right, and the photo as a clickable thumb that opens a
 * lightbox.
 */
export function LotMovementTimeline({
  movements,
  uomSymbol,
  holdingName,
}: Props) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (movements.length === 0) {
    return (
      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="mb-4 flex items-center gap-2">
          <RefreshCcw className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Movement history</h2>
        </header>
        <p className="text-sm text-muted-foreground">
          No movements recorded yet.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center gap-2">
        <RefreshCcw className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">Movement history</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {movements.length}
        </span>
      </header>

      <ol className="relative space-y-4 border-l border-border/60 pl-5">
        {movements.map((m) => (
          <Row
            key={m.uuid}
            movement={m}
            uomSymbol={uomSymbol}
            holdingName={holdingName}
            onOpenPhoto={() => m.photo_url && setLightbox(m.photo_url)}
          />
        ))}
      </ol>

      <Lightbox url={lightbox} onClose={() => setLightbox(null)} />
    </section>
  );
}

function Row({
  movement,
  uomSymbol,
  holdingName,
  onOpenPhoto,
}: {
  movement: StockMovement;
  uomSymbol: string;
  holdingName: string;
  onOpenPhoto: () => void;
}) {
  const prefs = useFormatPrefs();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const KindIcon = kindIcon(movement.kind);
  const tone = kindTone(movement.kind);
  const delta = formatCompanyNumber(movement.delta_qty, prefs);
  const sign = Number(movement.delta_qty) >= 0 ? "+" : "";

  return (
    <li className="relative">
      <span
        className={`absolute -left-[27px] top-1.5 inline-flex size-6 items-center justify-center rounded-full ring-2 ring-background ${tone.bg}`}
      >
        <KindIcon className={`size-3.5 ${tone.icon}`} />
      </span>

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone.chip}`}
            >
              {movement.kind}
            </span>
            <span className="font-mono text-sm font-semibold">
              {sign}
              {delta} {uomSymbol}
            </span>
          </div>

          {(movement.from_cell || movement.to_cell) && (
            <BreadcrumbRow
              from={movement.from_cell}
              to={movement.to_cell}
              holdingName={holdingName}
            />
          )}

          {movement.reason && (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium">Reason:</span> {movement.reason}
            </p>
          )}

          {movement.skip_photo_reason && !movement.photo_url && (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium">Skipped photo:</span>{" "}
              {humaniseSkipReason(movement.skip_photo_reason)}
            </p>
          )}
        </div>

        <div className="flex items-start gap-3">
          {movement.photo_url ? (
            <button
              type="button"
              onClick={onOpenPhoto}
              className="overflow-hidden rounded-md border border-border/60 transition-colors hover:border-foreground/30"
              aria-label="Open photo"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={movement.photo_url}
                alt="Movement photo"
                className="size-12 object-cover"
              />
            </button>
          ) : (
            <span className="inline-flex size-12 items-center justify-center rounded-md border border-dashed border-border/60 text-muted-foreground/40">
              <ImageOff className="size-4" />
            </span>
          )}

          <div className="min-w-0 text-right">
            <div className="flex items-center justify-end gap-1.5">
              {movement.actor && (
                <UserAvatar
                  name={movement.actor.name}
                  email={movement.actor.email}
                  avatar={movement.actor.avatar}
                  sizeClassName="size-5"
                  fallbackClassName="text-[9px]"
                />
              )}
              <span className="text-xs font-medium">
                {movement.actor?.name ?? "System"}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground" suppressHydrationWarning>
              {mounted
                ? relative(movement.occurred_at)
                : formatCompanyDate(movement.occurred_at, prefs)}
            </p>
          </div>
        </div>
      </div>
    </li>
  );
}

function BreadcrumbRow({
  from,
  to,
  holdingName,
}: {
  from: StockLotCellSummary | null;
  to: StockLotCellSummary | null;
  holdingName: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <CellLabel cell={from} fallback="—" holdingName={holdingName} />
      <ArrowRight className="size-3" />
      <CellLabel cell={to} fallback="—" holdingName={holdingName} />
    </div>
  );
}

function CellLabel({
  cell,
  fallback,
  holdingName,
}: {
  cell: StockLotCellSummary | null;
  fallback: string;
  holdingName: string;
}) {
  if (!cell) return <span className="italic">{fallback}</span>;
  // System cells get the operator-facing name. The (System) floor +
  // duplicated location-name leak is what triggered the rename.
  const isSystem =
    cell.system_kind === "unregistered" ||
    cell.storage_location?.system_kind === "unregistered" ||
    cell.floor?.system_kind === "unregistered";

  if (isSystem) {
    return (
      <span className="truncate">
        {cell.warehouse?.name ? `${cell.warehouse.name} · ` : ""}
        {holdingName}
      </span>
    );
  }

  // Real cells render company-numbered codes (SL00004 · CELL00011)
  // so the timeline matches what shows on the placements card and
  // what admins configured under Settings → Numbering.
  const locationCode = cell.storage_location?.code?.trim();
  const cellCode = cell.code?.trim();
  const parts: string[] = [];
  if (cell.warehouse?.name) parts.push(cell.warehouse.name);
  if (locationCode) parts.push(locationCode);
  if (cellCode && cellCode !== locationCode) parts.push(cellCode);
  return (
    <span className="truncate">
      {parts.length > 0 ? parts.join(" · ") : fallback}
    </span>
  );
}

function Lightbox({
  url,
  onClose,
}: {
  url: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!url} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl border-0 bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">Movement photo</DialogTitle>
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Movement photo, full size"
            className="max-h-[80vh] w-full rounded-md object-contain"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const KIND_ICON: Record<string, typeof Move> = {
  receive: PackagePlus,
  move: Move,
  consume: PackageMinus,
  adjust: ArrowUp,
  dispose: Trash2,
};
const KIND_TONE: Record<
  string,
  { bg: string; icon: string; chip: string }
> = {
  receive: {
    bg: "bg-emerald-500/15",
    icon: "text-emerald-700 dark:text-emerald-400",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  move: {
    bg: "bg-sky-500/15",
    icon: "text-sky-700 dark:text-sky-400",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  consume: {
    bg: "bg-zinc-500/15",
    icon: "text-zinc-600 dark:text-zinc-400",
    chip: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  },
  adjust: {
    bg: "bg-amber-500/15",
    icon: "text-amber-700 dark:text-amber-400",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  dispose: {
    bg: "bg-red-500/15",
    icon: "text-red-700 dark:text-red-400",
    chip: "bg-red-500/10 text-red-700 dark:text-red-400",
  },
};

function kindIcon(kind: StockMovement["kind"]) {
  return KIND_ICON[kind] ?? Package;
}
function kindTone(kind: StockMovement["kind"]) {
  return (
    KIND_TONE[kind] ?? {
      bg: "bg-muted",
      icon: "text-muted-foreground",
      chip: "bg-muted text-muted-foreground",
    }
  );
}

function humaniseSkipReason(raw: string): string {
  return raw.replace(/_/g, " ");
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
