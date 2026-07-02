"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Loader2,
  Lock,
  LockKeyhole,
  Plus,
  Printer,
  Split,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import {
  createCellAction,
  deleteCellAction,
  splitCellsAction,
  updateCellAction,
} from "@/lib/storage-cells/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type {
  StorageCell,
  StorageCellPurpose,
  StorageLocation,
  StorageTag,
} from "@/lib/types";
import { CELL_PURPOSES, purposeMeta } from "@/lib/storage-cells/purpose";
import { cn } from "@/lib/utils";
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
  /** Whether the current user has the warehouse-edit permission.
   *  When false the dialog renders read-only — no channel join, no
   *  presence chips, no editable inputs. */
  canEdit?: boolean;
}

/**
 * Stack-of-shelves editor for one storage location. Cells are
 * displayed top-down (highest ordinal at the top of the list, just
 * like a real shelf) and CRUD'd one at a time so a typo on level 3
 * never blocks edits on level 1.
 *
 * No client-side draft buffer for *commits* — every change is a real
 * HTTP call so the audit log stays accurate. Network failures surface
 * in an inline ErrorBanner without blowing away the row the user was
 * editing.
 *
 * Realtime collab per psp/CLAUDE.md: every input broadcasts focus +
 * value; peers see who's typing in which level. Add/Delete/Split and
 * any per-cell Save are gated to the head of the room so two planners
 * can't double-commit the same shelf.
 */
export function CellsDialog({
  warehouseUuid,
  location,
  storageTags,
  trigger,
  open: openProp,
  onOpenChange,
  canEdit = true,
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

  // One channel per warehouse plan editor — the dialog is per-location
  // but the broader plan is per-warehouse and operators commonly hop
  // between racks; sharing the room keeps presence coherent across
  // racks. (See plan editor for the same resource shape.)
  const resource = `warehouse-cells:${warehouseUuid}`;
  useFormPresenceBeacon(resource);

  // The form "state" mirrors per-cell drafts (width / depth / height /
  // max weight + tags + purpose) keyed by `<cellUuid>_<field>`. Sending
  // these through the live form lets peers see edits in flight; the
  // HTTP commit on blur is unchanged. We seed lazily — only cells the
  // user actually touches enter the state map.
  type DraftState = Record<string, string | string[] | null>;
  const initialDraft = useMemo<DraftState>(() => ({}), []);

  const {
    state: liveDraft,
    setField,
    presence,
    fieldEditors,
    focusField,
    blurField,
    joinError,
    creator,
    isCreator,
    cursors,
    setCursor,
    hideCursor,
    broadcastCommit,
  } = useLiveForm<DraftState>({
    resource,
    // Viewers don't join the channel — backend would 403 the join.
    // The dialog is opened from the plan editor by users with
    // `warehouses.edit`; closed dialog also disconnects via unmount.
    disabled: !canEdit || !open,
    initialState: initialDraft,
    onCommit: (raw) => {
      // Any peer's successful action invalidates our view — refresh
      // so the rack list, levels list, and Activity card all catch up.
      const msg = raw as { kind?: string } | null;
      if (!msg) return;
      router.refresh();
    },
  });

  // Cursor anchor — `DialogContent` is the natural box, but we can't
  // ref it directly without a wrapper. The inner div is the anchor.
  const cursorAnchorRef = useRef<HTMLDivElement | null>(null);
  const [anchorSize, setAnchorSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  useEffect(() => {
    const el = cursorAnchorRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setAnchorSize({ w: rect.width, h: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  // Hide our cursor on unmount / dialog close so peers don't see a
  // stale arrow sitting where we last moved.
  useEffect(() => {
    return () => hideCursor();
  }, [hideCursor]);

  const onCursorMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = cursorAnchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setCursor(x, y);
    },
    [setCursor],
  );

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
    // Fan out the change to peer editors so they refetch too —
    // without this they keep showing pre-edit cell state until
    // their own router.refresh fires (which only happens on a
    // local action).
    broadcastCommit({ kind: "cell-changed" });
  }

  function onAdd() {
    if (!isCreator) return;
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
    if (!isCreator) return;
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
    if (!isCreator) return;
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
    if (!isCreator) return;
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

  // Non-creator peers must not be able to fire HTTP actions. Combined
  // with the per-action `isCreator` short-circuits this is belt + braces
  // — keep both so a future ref-equality change doesn't bypass the gate.
  const inputsDisabled = !canEdit || !isCreator || pending;

  if (canEdit && joinError) {
    // Render the join error as the dialog body so the operator sees a
    // hard reason instead of a broken empty form.
    return (
      <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Levels · {location.name}</DialogTitle>
          </DialogHeader>
          <JoinErrorCard error={joinError} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setActionError(null);
          hideCursor();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <div
          ref={cursorAnchorRef}
          onMouseMove={onCursorMove}
          onMouseLeave={hideCursor}
          className="relative"
        >
          {/* Remote cursors layer — anchored to the dialog body. */}
          <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-xl">
            {Object.entries(cursors).map(([id, cursor]) => (
              <RemoteCursor
                key={id}
                cursor={cursor}
                anchorWidth={anchorSize.w}
                anchorHeight={anchorSize.h}
              />
            ))}
          </div>

          <DialogHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1.5">
                <DialogTitle>Levels · {location.name}</DialogTitle>
                <DialogDescription>
                  Stack this rack into levels — each with its own
                  width × depth × height, weight limit, and tags. Levels
                  inherit the rack&apos;s footprint and tags at creation;
                  edit either to make a level more specific. Allocation
                  reads each level&apos;s own tag set.
                </DialogDescription>
              </div>
              <CollabAvatars peers={presence} />
            </div>
          </DialogHeader>

          <div className="space-y-3 pt-2">
            {canEdit && !isCreator && creator && (
              <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Only{" "}
                  <span className="font-medium text-foreground">
                    {creator.name}
                  </span>{" "}
                  can edit levels from this room. Your view updates live.
                </span>
              </div>
            )}

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
                    // Always lead with the cell's own name (what the
                    // physical label shows). Falls back to a 1-indexed
                    // synthetic only when the operator hasn't named it.
                    ordinalDisplay: levelDisplayLabel(c),
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
                    disabled={inputsDisabled}
                    title={
                      !isCreator && creator
                        ? `Only ${creator.name} can edit from this room.`
                        : undefined
                    }
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
                    disabled={inputsDisabled}
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
                          disabled={inputsDisabled}
                          liveDraft={liveDraft}
                          setField={setField}
                          focusField={focusField}
                          blurField={blurField}
                          fieldEditors={fieldEditors}
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
  purpose: StorageCellPurpose;
  notes: string | null;
}

type LiveDraft = Record<string, string | string[] | null>;
type LiveSetField = (key: string, value: string | string[] | null) => void;
type FieldEditorsMap = Record<
  string,
  import("@/lib/realtime/use-live-form").CollabPeer | null
>;

function CellRow({
  cell,
  elevation,
  storageTags,
  disabled,
  liveDraft,
  setField,
  focusField,
  blurField,
  fieldEditors,
  onPatch,
  onDelete,
}: {
  cell: StorageCell;
  elevation: { base_m: number; top_m: number } | null;
  storageTags: StorageTag[];
  disabled: boolean;
  liveDraft: LiveDraft;
  setField: LiveSetField;
  focusField: (field: string) => void;
  blurField: (field: string) => void;
  fieldEditors: FieldEditorsMap;
  onPatch: (patch: Partial<CellPatch>) => void;
  onDelete: () => void;
}) {
  const keyFor = (field: string) => `cell:${cell.uuid}:${field}`;
  // Live draft wins over the persisted value so peers see what we're
  // typing. Falls back to the persisted cell value on first render or
  // when nobody has touched the field yet.
  const draftFor = (field: string, fallback: string) => {
    const k = keyFor(field);
    const v = liveDraft[k];
    if (typeof v === "string") return v;
    return fallback;
  };

  const purpose = purposeMeta(cell.purpose);

  return (
    <fieldset disabled={disabled} className="contents">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          {/* Source of truth = cell.name, which IS the label that gets
              printed on the QR sticker. Synthesised "Level N" was
              1-indexed for humans but collided with operators who
              named cells "Level 0" (0-indexed) — two numbers for the
              same physical shelf. */}
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {levelDisplayLabel(cell)}
          </p>
          {/* Decision-driven cell intent. Drives the auto-router — a
              lot that flips to `quarantine` lands in a quarantine
              cell, not whichever shelf happened to be free. */}
          <span
            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${purpose.chipClassName}`}
            title={purpose.description}
          >
            {purpose.label}
          </span>
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
            disabled={disabled}
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
          <CollabField
            id={keyFor("width_m")}
            label="Width (m)"
            value={draftFor("width_m", cell.width_m == null ? "" : String(cell.width_m))}
            onChange={(v) => setField(keyFor("width_m"), v)}
            onFocus={() => focusField(keyFor("width_m"))}
            onBlur={(v) => {
              blurField(keyFor("width_m"));
              onPatch({ width_m: v.length === 0 ? null : v });
            }}
            editor={fieldEditors[keyFor("width_m")]}
          />
          <CollabField
            id={keyFor("depth_m")}
            label="Depth (m)"
            value={draftFor("depth_m", cell.depth_m == null ? "" : String(cell.depth_m))}
            onChange={(v) => setField(keyFor("depth_m"), v)}
            onFocus={() => focusField(keyFor("depth_m"))}
            onBlur={(v) => {
              blurField(keyFor("depth_m"));
              onPatch({ depth_m: v.length === 0 ? null : v });
            }}
            editor={fieldEditors[keyFor("depth_m")]}
          />
          <CollabField
            id={keyFor("height_m")}
            label="Height (m)"
            value={draftFor("height_m", cell.height_m == null ? "" : String(cell.height_m))}
            onChange={(v) => setField(keyFor("height_m"), v)}
            onFocus={() => focusField(keyFor("height_m"))}
            onBlur={(v) => {
              blurField(keyFor("height_m"));
              onPatch({ height_m: v.length === 0 ? null : v });
            }}
            editor={fieldEditors[keyFor("height_m")]}
          />
        </div>

        <CollabField
          id={keyFor("max_weight_kg")}
          label="Max weight (kg)"
          value={draftFor(
            "max_weight_kg",
            cell.max_weight_kg == null ? "" : String(cell.max_weight_kg),
          )}
          onChange={(v) => setField(keyFor("max_weight_kg"), v)}
          onFocus={() => focusField(keyFor("max_weight_kg"))}
          onBlur={(v) => {
            blurField(keyFor("max_weight_kg"));
            onPatch({ max_weight_kg: v.length === 0 ? null : v });
          }}
          editor={fieldEditors[keyFor("max_weight_kg")]}
        />

        {/* Purpose select — every cell carries an intent. The
            auto-router reads this column when a lot's lifecycle
            event flips its status: quarantine lots route here,
            rejected lots to a `rejected` cell, etc. */}
        <div className="space-y-1">
          <Label className="text-[11px]">Purpose</Label>
          <div className="relative">
            <select
              value={cell.purpose ?? "regular"}
              disabled={disabled}
              onFocus={() => focusField(keyFor("purpose"))}
              onBlur={() => blurField(keyFor("purpose"))}
              onChange={(e) =>
                onPatch({
                  purpose: e.target.value as StorageCellPurpose,
                })
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            >
              {CELL_PURPOSES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <FieldEditingIndicator peer={fieldEditors[keyFor("purpose")]} />
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">
            {purpose.description}
          </p>
        </div>

        <div className="relative">
          <TagPicker
            value={cell.tags ?? []}
            known={storageTags}
            kind="cell"
            label="Level tags"
            help="These tags decide what stock can land here. Seeded from the rack when the level was created — add or remove freely to make this level more specific."
            readOnly={disabled}
            onCommit={(tags) => onPatch({ tags })}
            systemReserved={CELL_PURPOSES.map((p) => ({
              key: p.value,
              label: p.label,
              description: p.description,
              chipClassName: p.chipClassName,
              helpText:
                "Reserved — set via the Purpose dropdown above, not as a tag.",
            }))}
          />
          <FieldEditingIndicator peer={fieldEditors[keyFor("tags")]} />
        </div>
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

/**
 * Headline label for a level — what we render in the level list, on
 * the rack-elevation SVG, and anywhere else the operator sees a
 * level reference. Rule: use the cell's `name` (which IS what the
 * printed QR label shows) verbatim; only when the operator hasn't
 * named it fall back to a 1-indexed synthetic `Level N`. Never
 * synthesise on top of a real name — that's the bug that made cells
 * named `Level 0` show up as `Level 1`.
 */
function levelDisplayLabel(cell: { name?: string | null; ordinal: number }): string {
  const trimmed = (cell.name ?? "").trim();
  if (trimmed) return trimmed;
  return `Level ${cell.ordinal + 1}`;
}

function CollabField({
  id,
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  editor,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  onBlur: (v: string) => void;
  editor: import("@/lib/realtime/use-live-form").CollabPeer | null;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]" htmlFor={id}>
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={(e) => onBlur(e.target.value.trim())}
          className="h-8 text-xs"
        />
        <FieldEditingIndicator peer={editor} />
      </div>
    </div>
  );
}

function JoinErrorCard({
  error,
}: {
  error: import("@/lib/realtime/use-live-form").JoinError;
}) {
  const config = {
    form_full: {
      icon: AlertCircle,
      tone: "amber" as const,
      title: `Form is at capacity`,
      detail: error.limit
        ? `Up to ${error.limit} people can edit this plan at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      tone: "muted" as const,
      title: "You can't edit here",
      detail:
        "Ask an admin for the `warehouses.edit` permission to join this plan.",
    },
    bad_topic: {
      icon: AlertCircle,
      tone: "destructive" as const,
      title: "Unknown form",
      detail: "We couldn't find this plan. The link may have been malformed.",
    },
    unknown: {
      icon: AlertCircle,
      tone: "destructive" as const,
      title: "Couldn't open the plan",
      detail: "Something went wrong on our end. Please try again.",
    },
  }[error.reason];

  const Icon = config.icon;
  const toneClass =
    config.tone === "amber"
      ? "border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20"
      : config.tone === "destructive"
        ? "border-destructive/30 bg-destructive/[0.03]"
        : "border-border/60 bg-muted/30";
  const iconClass =
    config.tone === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : config.tone === "destructive"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <Card className={cn("border", toneClass)}>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-background">
          <Icon className={cn("size-6", iconClass)} />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold">{config.title}</p>
          <p className="text-xs text-muted-foreground">{config.detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}
