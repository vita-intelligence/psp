"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
  updateCellAction,
} from "@/lib/storage-cells/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type { StorageCell, StorageLocation } from "@/lib/types";

interface CellsDialogProps {
  warehouseUuid: string;
  location: Pick<StorageLocation, "uuid" | "name" | "cells">;
  /** Open/close passed in so the parent controls (LocationBody owns
   *  the button that triggers this). */
  trigger: React.ReactNode;
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
  trigger,
}: CellsDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  // Render top-down — level 5 at the top, level 1 at the bottom —
  // matches how warehouse operators speak about shelves.
  const cells = [...(location.cells ?? [])].sort(
    (a, b) => b.ordinal - a.ordinal,
  );

  function refreshAndClearError() {
    setActionError(null);
    router.refresh();
  }

  function onAdd() {
    setActionError(null);
    startTransition(async () => {
      const res = await createCellAction(warehouseUuid, location.uuid, {
        // Server picks the next free ordinal — leave it off and the
        // new level lands on top. Display label is "Level N" derived
        // from ordinal, so no need to store a name.
        tags: [],
      });
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

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setActionError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cells · {location.name}</DialogTitle>
          <DialogDescription>
            Subdivide this location into stacked levels — each with
            its own dimensions, weight limit, and classification tags.
            Bottom level sits at the floor (ordinal 0).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {cells.length === 0
                ? "No cells defined yet — treat as a single bulk zone, or add levels below."
                : `${cells.length} level${cells.length === 1 ? "" : "s"} (top to bottom)`}
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

          {actionError && (
            <ErrorBanner
              detail={actionError.detail}
              code={actionError.code}
              debug={actionError.debug}
            />
          )}

          <ul className="space-y-2">
            {cells.map((cell) => (
              <li
                key={cell.uuid}
                className="rounded-md border border-border/60 bg-muted/30 p-3"
              >
                <CellRow
                  cell={cell}
                  disabled={pending}
                  onPatch={(patch) => onPatch(cell.uuid, patch)}
                  onDelete={() => onDelete(cell.uuid)}
                />
              </li>
            ))}
          </ul>

          {cells.length === 0 && (
            <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
              When you don&apos;t add cells, the system treats this
              location as one bulk capacity using the location&apos;s
              own dimensions.
            </div>
          )}
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
  disabled,
  onPatch,
  onDelete,
}: {
  cell: StorageCell;
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
  const [tagsStr, setTagsStr] = useState((cell.tags ?? []).join(", "));

  const commitTags = () => {
    const parsed = tagsStr
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
    onPatch({ tags: parsed });
  };

  return (
    <fieldset disabled={disabled} className="contents">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Level {cell.ordinal + 1}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="h-7 text-xs text-destructive hover:text-destructive"
        >
          <Trash2 className="mr-1 size-3" />
          Remove
        </Button>
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

        <div className="space-y-1">
          <Label className="text-[11px]">Tags</Label>
          <Input
            value={tagsStr}
            onChange={(e) => setTagsStr(e.target.value)}
            onBlur={commitTags}
            placeholder="cold, allergen-nuts, raw-oil"
            className="h-8 font-mono text-xs"
          />
          <p className="text-[10px] text-muted-foreground">
            Comma-separated. Free-form labels — the segregation rules
            engine reads these later (cold → must match a cold cell,
            quarantine → cell goes exclusive, etc.).
          </p>
        </div>
      </div>
    </fieldset>
  );
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
