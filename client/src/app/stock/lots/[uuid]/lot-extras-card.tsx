"use client";

/**
 * Two small cards bundled together: return-picks (production →
 * warehouse) and direct lot files. Both render only when there's
 * data to show so the lot page stays compact for plain receives.
 */

import { useState } from "react";
import {
  ArrowRight,
  FileText,
  Image as ImageIcon,
  PackageCheck,
  Paperclip,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  StockLotCellSummary,
  StockLotFile,
  StockLotReturnPick,
} from "@/lib/types";
import {
  formatCompanyDate,
  formatCompanyNumber,
  type FormatPrefs,
} from "@/lib/format/company";
import { UserAvatar } from "@/components/users/user-avatar";

export function LotReturnPicksCard({
  picks,
  uomSymbol,
  holdingName,
  prefs,
}: {
  picks: StockLotReturnPick[];
  uomSymbol: string;
  holdingName: string;
  prefs: FormatPrefs;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  if (picks.length === 0) return null;

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center gap-2">
        <PackageCheck className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">
          Return picks (production → warehouse)
        </h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {picks.length}
        </span>
      </header>

      <ul className="space-y-3">
        {picks.map((r) => (
          <li
            key={r.uuid}
            className="rounded-md border border-border/60 bg-card/60 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CellLabel
                  cell={r.picked_from_cell}
                  fallback="—"
                  holdingName={holdingName}
                />
                <ArrowRight className="size-3" />
                <CellLabel
                  cell={r.placed_to_cell}
                  fallback="—"
                  holdingName={holdingName}
                />
              </div>
              <span className="font-mono text-sm font-semibold">
                {formatCompanyNumber(r.qty, prefs)} {uomSymbol}
              </span>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <PickStamp
                label="Picked from production"
                actor={r.picked_by}
                at={r.picked_at}
                photoUrl={r.picked_photo_url}
                prefs={prefs}
                onOpenPhoto={setLightbox}
              />
              <PickStamp
                label="Placed in warehouse"
                actor={r.placed_by}
                at={r.placed_at}
                photoUrl={r.placed_photo_url}
                prefs={prefs}
                onOpenPhoto={setLightbox}
              />
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-w-3xl border-0 bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">Return pick photo</DialogTitle>
          {lightbox && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox}
              alt="Return-pick photo, full size"
              className="max-h-[80vh] w-full rounded-md object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function LotFilesCard({
  files,
  prefs,
}: {
  files: StockLotFile[];
  prefs: FormatPrefs;
}) {
  if (files.length === 0) return null;

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <Paperclip className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">
          Attached files
        </h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {files.length}
        </span>
      </header>

      <ul className="space-y-1.5">
        {files.map((f) => {
          const Icon = f.kind === "photo" ? ImageIcon : FileText;
          const inner = (
            <span className="inline-flex items-center gap-1.5">
              <Icon className="size-3.5" />
              {f.filename}
              <span className="text-[10px] text-muted-foreground">
                · {f.kind}
              </span>
              <span className="text-[10px] text-muted-foreground">
                · {formatCompanyDate(f.inserted_at, prefs)}
              </span>
              {f.uploaded_by && (
                <span className="text-[10px] text-muted-foreground">
                  · {f.uploaded_by.name}
                </span>
              )}
            </span>
          );
          return (
            <li key={f.uuid} className="text-xs">
              {f.url ? (
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand hover:underline"
                >
                  {inner}
                </a>
              ) : (
                <span className="text-muted-foreground">{inner}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PickStamp({
  label,
  actor,
  at,
  photoUrl,
  prefs,
  onOpenPhoto,
}: {
  label: string;
  actor: { id: number; name: string; email: string; avatar?: string | null } | null;
  at: string | null;
  photoUrl: string | null;
  prefs: FormatPrefs;
  onOpenPhoto: (url: string) => void;
}) {
  if (!at || !actor) {
    return (
      <div className="rounded-md border border-dashed border-border/40 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
        <p className="font-semibold uppercase tracking-wider">{label}</p>
        <p className="mt-0.5">Pending</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border/40 bg-muted/30 px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-0.5 flex items-center gap-2">
        <UserAvatar
          name={actor.name}
          email={actor.email}
          avatar={actor.avatar ?? null}
          sizeClassName="size-5"
          fallbackClassName="text-[9px]"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium">{actor.name}</p>
          <p className="text-[10px] text-muted-foreground">
            {formatCompanyDate(at, prefs)}
          </p>
        </div>
        {photoUrl && (
          <button
            type="button"
            onClick={() => onOpenPhoto(photoUrl)}
            className="overflow-hidden rounded border border-border/60 hover:border-foreground/30"
            aria-label="Open photo"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl}
              alt="Photo"
              className="size-9 object-cover"
            />
          </button>
        )}
      </div>
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
