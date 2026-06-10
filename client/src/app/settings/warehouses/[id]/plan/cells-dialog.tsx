"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Plus, Printer, Split, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorBanner } from "@/components/forms/error-banner";
import {
  createCellAction,
  deleteCellAction,
  splitCellsAction,
  updateCellAction,
} from "@/lib/storage-cells/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type { StorageCell, StorageLocation, StorageTag } from "@/lib/types";
import { RackElevationSvg } from "./rack-elevation-svg";
import { TagPicker } from "./tag-picker";

interface CellsDialogProps {
  warehouseUuid: string;
  /** Caller passes the rack's outer height (depth_m in the schema —
   *  named "Total height" in the UI) so the editor can show
   *  elevation per level and warn on overshoot. */
  location: Pick<StorageLocation, "uuid" | "name" | "cells"> & {
    depth_m?: string | number | null;
  };
  /** Company-wide tag registry — passed straight to the per-cell
   *  TagPicker so each level can pick its own override tags. */
  storageTags: StorageTag[];
  /** Open/close passed in so the parent controls (LocationBody owns
   *  the button that triggers this). */
  trigger: React.ReactNode;
  /** Optional controlled open — used by the LocationBody to pop the
   *  dialog automatically right after a brand-new rack is saved. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Stack-of-shelves editor for one storage location. Cells are
 * displayed top-down (highest ordinal at the top of the list, just
 * like a real shelf) and CRUD'd one at a time so a typo on level 3
 * never blocks edits on level 1.
 *
 * No client-side draft buffer — every change is a real HTTP call so
 * the audit log + realtime channel stay accurate. Network failures
 * surface in an inline ErrorBanner without blowing away the row the
 * user was editing.
 */
export function CellsDialog({
  warehouseUuid,
  location,
  storageTags,
  trigger,
  open: openProp,
  onOpenChange,
}: CellsDialogProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  };
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  // Render top-down — level 5 at the top, level 1 at the bottom —
  // matches how warehouse operators speak about shelves.
  const cells = [...(location.cells ?? [])].sort(
    (a, b) => b.ordinal - a.ordinal,
  );
  // Bottom-up order is what we hand to the SVG (it expects ordinal
  // ascending and flips visually).
  const cellsBottomUp = [...(location.cells ?? [])].sort(
    (a, b) => a.ordinal - b.ordinal,
  );

  const totalHeight_m = numberOrNull(location.depth_m);
  const sumHeights_m = cellsBottomUp.reduce(
    (acc, c) => acc + (numberOrNull(c.height_m) ?? 0),
    0,
  );
  const overshoot_m =
    totalHeight_m !== null && sumHeights_m - totalHeight_m > 0.005
      ? sumHeights_m - totalHeight_m
      : 0;
  // Pre-compute elevations bottom-up so each row can look its own up.
  const elevationsByUuid = useMemo(() => {
    const map = new Map<string, { base_m: number; top_m: number }>();
    let cursor = 0;
    for (const c of cellsBottomUp) {
      const h = numberOrNull(c.height_m) ?? 0;
      map.set(c.uuid, { base_m: cursor, top_m: cursor + h });
      cursor += h;
    }
    return map;
  }, [cellsBottomUp]);

  function refreshAndClearError() {
    setActionError(null);
    router.refresh();
  }

  function onAdd() {
    setActionError(null);
    startTransition(async () => {
      // No `tags` key in the payload — the backend seeds new levels
      // with the rack's tags so the operator doesn't have to repeat
      // themselves. They can prune any inherited tag on the row
      // itself afterwards.
      const res = await createCellAction(warehouseUuid, location.uuid, {});
      if (!res.ok) {
        setActionError(res);
        return;
      }
      refreshAndClearError();
    });
  }

  function onPatch(cellUuid: string, patch: Partial<CellPatch>) {
    setActionError(null);
    startTransition(async () => {
      const res = await updateCellAction(
        warehouseUuid,
        location.uuid,
        cellUuid,
        patch,
      );
      if (!res.ok) {
        setActionError(res);
        return;
      }
      refreshAndClearError();
    });
  }

  function onDelete(cellUuid: string) {
    setActionError(null);
    startTransition(async () => {
      const res = await deleteCellAction(
        warehouseUuid,
        location.uuid,
        cellUuid,
      );
      if (!res.ok) {
        setActionError(res);
        return;
      }
      refreshAndClearError();
    });
  }

  function onSplit(levels: number) {
    if (!Number.isFinite(levels) || levels < 1 || levels > 30) return;
    setActionError(null);
    // Use the rack's total height when known so the resulting levels
    // match the operator's stated geometry. Without a total, default
    // to 1m levels — they can adjust per-row afterwards.
    const perLevel_m =
      totalHeight_m !== null && totalHeight_m > 0
        ? Number((totalHeight_m / levels).toFixed(3))
        : 1;
    const heights = Array.from({ length: levels }, () => perLevel_m);
    startTransition(async () => {
      const res = await splitCellsAction(
        warehouseUuid,
        location.uuid,
        heights,
      );
      if (!res.ok) {
        setActionError(res);
        return;
      }
      refreshAndClearError();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setActionError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Levels · {location.name}</DialogTitle>
          <DialogDescription>
            Stack this rack into levels — each with its own
            width × depth × height, weight limit, and tags. Levels
            inherit the rack&apos;s footprint and tags at creation;
            edit either to make a level more specific. Allocation
            reads each level&apos;s own tag set.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {overshoot_m > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Levels sum to{" "}
                <strong className="font-semibold">
                  {sumHeights_m.toFixed(2)} m
                </strong>
                {totalHeight_m !== null && (
                  <>
                    {" "}but the rack is{" "}
                    <strong className="font-semibold">
                      {totalHeight_m.toFixed(2)} m
                    </strong>{" "}
                    tall — over by {overshoot_m.toFixed(2)} m. Trim a
                    level or raise the rack&apos;s total height.
                  </>
                )}
              </span>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-[200px_1fr]">
            <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Side view
              </p>
              <RackElevationSvg
                width={180}
                variant="full"
                totalHeight_m={totalHeight_m}
                levels={cellsBottomUp.map((c) => ({
                  uuid: c.uuid,
                  ordinalDisplay: c.ordinal + 1,
                  height_m: numberOrNull(c.height_m),
                  max_weight_kg: numberOrNull(c.max_weight_kg),
                  width_m: numberOrNull(c.width_m),
                  depth_m: numberOrNull(c.depth_m),
                }))}
              />
              <p className="text-[10px] leading-snug text-muted-foreground">
                Floor at the bottom. Dashed line = rack&apos;s declared
                total height. Hover a level for its dimensions.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {cells.length === 0
                    ? "No levels yet — split this rack into equal levels or add one at a time."
                    : `${cells.length} level${cells.length === 1 ? "" : "s"} · ${sumHeights_m.toFixed(2)} m used${totalHeight_m !== null ? ` of ${totalHeight_m.toFixed(2)} m` : ""}`}
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={onAdd}
                  disabled={pending}
                >
                  {pending ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <Plus className="mr-1.5 size-3.5" />
                  )}
                  Add level
                </Button>
              </div>

              {cells.length === 0 && (
                <SplitHelper
                  totalHeight_m={totalHeight_m}
                  disabled={pending}
                  onSplit={onSplit}
                />
              )}

              {actionError && (
                <ErrorBanner
                  detail={actionError.detail}
                  code={actionError.code}
                  debug={actionError.debug}
                />
              )}

              <ul className="space-y-2">
                {cells.map((cell) => {
                  const elev = elevationsByUuid.get(cell.uuid);
                  return (
                    <li
                      key={cell.uuid}
                      className="rounded-md border border-border/60 bg-muted/30 p-3"
                    >
                      <CellRow
                        cell={cell}
                        elevation={elev ?? null}
                        storageTags={storageTags}
                        disabled={pending}
                        onPatch={(patch) => onPatch(cell.uuid, patch)}
                        onDelete={() => onDelete(cell.uuid)}
                      />
                    </li>
                  );
                })}
              </ul>

              {cells.length === 0 && (
                <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
                  Until you add levels, this location is treated as one
                  bulk capacity with the rack&apos;s outer dimensions.
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface CellPatch {
  name: string | null;
  width_m: string | number | null;
  depth_m: string | number | null;
  height_m: string | number | null;
  max_weight_kg: string | number | null;
  tags: string[];
  notes: string | null;
}

function CellRow({
  cell,
  elevation,
  storageTags,
  disabled,
  onPatch,
  onDelete,
}: {
  cell: StorageCell;
  elevation: { base_m: number; top_m: number } | null;
  storageTags: StorageTag[];
  disabled: boolean;
  onPatch: (patch: Partial<CellPatch>) => void;
  onDelete: () => void;
}) {
  // Local draft so the user can keep typing without each keystroke
  // round-tripping. Commit on blur — the audit log + realtime
  // channel fire once per coherent edit, not once per character.
  const [w, setW] = useState(cell.width_m ?? "");
  const [d, setD] = useState(cell.depth_m ?? "");
  const [h, setH] = useState(cell.height_m ?? "");
  const [maxW, setMaxW] = useState(cell.max_weight_kg ?? "");

  return (
    <fieldset disabled={disabled} className="contents">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Level {cell.ordinal + 1}
          </p>
          {elevation && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {elevation.base_m.toFixed(2)} m → {elevation.top_m.toFixed(2)} m
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <a
            href={`/api/storage-cells/${cell.uuid}/label.pdf?copies=1`}
            target="_blank"
            rel="noopener"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Print QR label for this shelf"
            aria-label="Print QR label"
          >
            <Printer className="size-3.5" />
          </a>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            aria-label="Remove level"
            title="Remove this level"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-2 space-y-2">
        <div className="grid grid-cols-3 gap-1.5">
          <Field
            label="Width (m)"
            value={w}
            onChange={setW}
            onCommit={(v) => onPatch({ width_m: v })}
          />
          <Field
            label="Depth (m)"
            value={d}
            onChange={setD}
            onCommit={(v) => onPatch({ depth_m: v })}
          />
          <Field
            label="Height (m)"
            value={h}
            onChange={setH}
            onCommit={(v) => onPatch({ height_m: v })}
          />
        </div>

        <Field
          label="Max weight (kg)"
          value={maxW}
          onChange={setMaxW}
          onCommit={(v) => onPatch({ max_weight_kg: v })}
        />

        <TagPicker
          value={cell.tags ?? []}
          known={storageTags}
          kind="cell"
          label="Level tags"
          help="These tags decide what stock can land here. Seeded from the rack when the level was created — add or remove freely to make this level more specific."
          readOnly={disabled}
          onCommit={(tags) => onPatch({ tags })}
        />
      </div>
    </fieldset>
  );
}

function SplitHelper({
  totalHeight_m,
  disabled,
  onSplit,
}: {
  totalHeight_m: number | null;
  disabled: boolean;
  onSplit: (levels: number) => void;
}) {
  const [count, setCount] = useState("2");
  const parsed = Number.parseInt(count, 10);
  const valid = Number.isFinite(parsed) && parsed >= 1 && parsed <= 30;
  const previewPer_m =
    valid && totalHeight_m !== null && totalHeight_m > 0
      ? totalHeight_m / parsed
      : null;

  return (
    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/[0.04] p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-foreground">
        <Split className="size-3.5 text-primary" />
        Split rack into equal levels
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        Most racks have evenly-spaced shelves. Pick how many and we&apos;ll
        seed them in one go — you can fine-tune any level afterwards.
        {totalHeight_m === null && (
          <>
            {" "}Set the rack&apos;s total height on the location panel to
            get auto-computed level heights.
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {[2, 3, 4, 5].map((n) => (
          <Button
            key={n}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onSplit(n)}
            className="h-7 text-xs"
          >
            {n} levels
          </Button>
        ))}
      </div>
      <div className="flex items-end gap-2 pt-1">
        <div className="space-y-1">
          <Label className="text-[10px]">Custom</Label>
          <Input
            type="number"
            min={1}
            max={30}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="h-8 w-20 text-xs"
            disabled={disabled}
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={disabled || !valid}
          onClick={() => valid && onSplit(parsed)}
          className="h-8"
        >
          Split
        </Button>
        {previewPer_m !== null && (
          <p className="pb-1 text-[10px] text-muted-foreground">
            ≈ {previewPer_m.toFixed(2)} m per level
          </p>
        )}
      </div>
    </div>
  );
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function Field({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  value: string | number | null;
  onChange: (v: string) => void;
  onCommit: (v: string | null) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      <Input
        type="text"
        inputMode="decimal"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          const v = e.target.value.trim();
          onCommit(v.length === 0 ? null : v);
        }}
        className="h-8 text-xs"
      />
    </div>
  );
}
