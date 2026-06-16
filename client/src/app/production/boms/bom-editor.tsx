"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner } from "@/components/forms/error-banner";
import { Badge } from "@/components/ui/badge-mini";
import {
  SearchPicker,
  type SearchPickerOption,
} from "@/components/forms/search-picker";
import type { ErrorDebug } from "@/lib/errors/types";
import type { Item } from "@/lib/types";
import type { BOM, BOMPartSummary } from "@/lib/production/types";
import { invalidateAudit } from "@/lib/audit/invalidator";
import {
  createBOMAction,
  deleteBOMAction,
  setBOMPrimaryAction,
  updateBOMAction,
} from "@/lib/production/actions";

interface Props {
  /** Existing BOM in edit mode, null when creating fresh. */
  bom: BOM | null;
  /** Output item — required for create mode. Locked once a BOM is
   *  saved so the FK never silently re-targets. */
  outputItem: Item | BOMPartSummary | null;
  canEdit: boolean;
  canDelete: boolean;
}

interface PartOption extends SearchPickerOption {
  uuid: string;
  name: string;
  uomSymbol: string | null;
  uomId: number | null;
}

interface LineDraft {
  tempId: string;
  partId: number | null;
  partLabel: string;
  partOption: PartOption | null;
  qty: string;
  isFixed: boolean;
  notes: string;
  uomId: number | null;
  uomSymbol: string | null;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tmp-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyLine(): LineDraft {
  return {
    tempId: newId(),
    partId: null,
    partLabel: "",
    partOption: null,
    qty: "",
    isFixed: false,
    notes: "",
    uomId: null,
    uomSymbol: null,
  };
}

function hydrateLines(bom: BOM | null): LineDraft[] {
  if (!bom || !bom.lines || bom.lines.length === 0) return [emptyLine()];
  return bom.lines
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((l) => ({
      tempId: newId(),
      partId: l.part_id,
      partLabel: l.part?.name ?? `Item #${l.part_id}`,
      partOption: l.part
        ? {
            id: l.part.id,
            uuid: l.part.uuid,
            label: l.part.name,
            name: l.part.name,
            code: l.part.code,
            uomSymbol: l.part.stock_uom?.symbol ?? l.part.stock_uom?.code ?? null,
            uomId: l.part.stock_uom?.id ?? null,
          }
        : null,
      qty: l.qty != null ? String(l.qty) : "",
      isFixed: !!l.is_fixed,
      notes: l.notes ?? "",
      uomId: l.unit_of_measurement?.id ?? l.part?.stock_uom?.id ?? null,
      uomSymbol:
        l.unit_of_measurement?.symbol ??
        l.part?.stock_uom?.symbol ??
        l.part?.stock_uom?.code ??
        null,
    }));
}

/**
 * BOM editor — header + parts table. Mirrors the MRPEasy layout
 * (number / name / parts grid). Save replaces the line set
 * wholesale on the BE.
 */
export function BOMEditor({ bom, outputItem, canEdit, canDelete }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  const isCreate = !bom;
  const [name, setName] = useState(bom?.name ?? "");
  const [notes, setNotes] = useState(bom?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() => hydrateLines(bom));

  // Auto-seed a sensible name on create from the output item's name.
  // The operator can overwrite before save.
  useEffect(() => {
    if (!isCreate) return;
    if (name.trim() !== "") return;
    if (outputItem) setName(`${outputItem.name} BOM`);
  }, [isCreate, outputItem, name]);

  function patchLine(tempId: string, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((l) => (l.tempId === tempId ? { ...l, ...patch } : l)),
    );
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(tempId: string) {
    setLines((prev) => {
      const next = prev.filter((l) => l.tempId !== tempId);
      return next.length === 0 ? [emptyLine()] : next;
    });
  }

  const completeLines = useMemo(
    () => lines.filter((l) => l.partId != null && Number(l.qty) > 0),
    [lines],
  );

  function onSave() {
    if (pending) return;
    setError(null);

    if (!name.trim()) {
      setError({ detail: "Name is required.", code: "missing_name" });
      return;
    }
    if (completeLines.length === 0) {
      setError({
        detail: "Add at least one part with a positive quantity.",
        code: "missing_lines",
      });
      return;
    }
    if (isCreate && !outputItem) {
      setError({
        detail: "Pick an output item before saving.",
        code: "missing_item",
      });
      return;
    }

    const payload = {
      item_id: outputItem ? (outputItem as { id: number }).id : undefined,
      name: name.trim(),
      notes: notes.trim() || null,
      lines: completeLines.map((l, idx) => ({
        part_id: l.partId!,
        qty: String(Number(l.qty)),
        unit_of_measurement_id: l.uomId ?? undefined,
        is_fixed: l.isFixed,
        notes: l.notes.trim() || null,
        sort_order: idx,
      })),
    };

    startTransition(async () => {
      const res = isCreate
        ? await createBOMAction(payload)
        : await updateBOMAction(bom!.uuid, payload);
      if (res.ok) {
        toast.success(isCreate ? "BOM created" : "BOM saved");
        invalidateAudit("bom", res.bom.id);
        router.push(`/production/boms/${res.bom.uuid}`);
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  function onSetPrimary() {
    if (!bom || pending || bom.is_primary) return;
    startTransition(async () => {
      const res = await setBOMPrimaryAction(bom.uuid);
      if (res.ok) {
        toast.success("Primary BOM updated");
        invalidateAudit("bom", bom.id);
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  function onDelete() {
    if (!bom || pending) return;
    if (
      !window.confirm(
        `Delete "${bom.name}"? This removes the recipe and all its lines.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await deleteBOMAction(bom.uuid);
      if (res.ok) {
        toast.success("BOM deleted");
        invalidateAudit("bom", bom.id);
        router.push("/production/boms");
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <ErrorBanner
          detail={error.detail}
          code={error.code}
          debug={error.debug}
        />
      )}

      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold tracking-tight">Header</h2>
            <p className="text-xs text-muted-foreground">
              {outputItem ? (
                <>
                  Output: <span className="font-medium">{outputItem.name}</span>
                  {outputItem.code && (
                    <span className="ml-1.5 font-mono text-[11px]">
                      ({outputItem.code})
                    </span>
                  )}
                </>
              ) : (
                "Pick an output item from the Item detail page to start a BOM."
              )}
            </p>
          </div>
          {bom && (
            <div className="flex flex-wrap items-center gap-1.5">
              {bom.is_primary ? (
                <Badge tone="emerald">
                  <Star className="size-2.5" />
                  Primary
                </Badge>
              ) : (
                canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onSetPrimary}
                    disabled={pending}
                  >
                    <Star className="mr-1.5 size-3.5" />
                    Make primary
                  </Button>
                )
              )}
              {!bom.is_active && <Badge tone="muted">Archived</Badge>}
            </div>
          )}
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="bom-name" className="text-xs uppercase tracking-wider text-muted-foreground">
              Name
            </Label>
            <Input
              id="bom-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard recipe"
              disabled={!canEdit}
            />
          </div>
          {bom?.code && (
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Number
              </Label>
              <p className="font-mono text-sm">{bom.code}</p>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="bom-notes" className="text-xs uppercase tracking-wider text-muted-foreground">
            Notes (optional)
          </Label>
          <Textarea
            id="bom-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Variant info, process notes, etc."
            disabled={!canEdit}
          />
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold tracking-tight">Parts</h2>
            <p className="text-xs text-muted-foreground">
              One row per component. Fixed qty = per-batch overhead
              (cleaning consumables, in-process samples) that doesn't
              scale with the output qty.
            </p>
          </div>
          {canEdit && (
            <Button type="button" size="sm" variant="outline" onClick={addLine}>
              <Plus className="mr-1.5 size-3.5" />
              Add part
            </Button>
          )}
        </header>

        <div className="overflow-x-auto rounded-md border border-border/60">
          <table className="min-w-[760px] text-xs">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-1.5 text-left">#</th>
                <th className="px-2 py-1.5 text-left">Part</th>
                <th className="w-24 px-2 py-1.5 text-right">Qty</th>
                <th className="w-16 px-2 py-1.5 text-left">UoM</th>
                <th className="w-16 px-2 py-1.5 text-center" title="Fixed = per-batch overhead, independent of output qty">
                  Fixed
                </th>
                <th className="px-2 py-1.5 text-left">Notes</th>
                <th className="w-8 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {lines.map((l, idx) => (
                <LineRow
                  key={l.tempId}
                  index={idx}
                  line={l}
                  canEdit={canEdit}
                  onPatch={(patch) => patchLine(l.tempId, patch)}
                  onRemove={() => removeLine(l.tempId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => router.push("/production/boms")}
            disabled={pending}
          >
            Back
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {bom && canDelete && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDelete}
              disabled={pending}
              className="text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Delete
            </Button>
          )}
          {canEdit && (
            <Button type="button" size="sm" onClick={onSave} disabled={pending}>
              {pending ? "Saving…" : isCreate ? "Create BOM" : "Save changes"}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

function LineRow({
  index,
  line,
  canEdit,
  onPatch,
  onRemove,
}: {
  index: number;
  line: LineDraft;
  canEdit: boolean;
  onPatch: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}) {
  async function searchParts(q: string): Promise<PartOption[]> {
    try {
      const url = q
        ? `/api/items?search=${encodeURIComponent(q)}&limit=25`
        : `/api/items?limit=25`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return [];
      const body = (await res.json()) as { items?: Item[] };
      const items = body.items ?? [];
      return items.map((i) => ({
        id: i.id,
        uuid: i.uuid,
        label: i.name,
        name: i.name,
        code: i.code,
        uomSymbol: i.stock_uom?.symbol ?? null,
        uomId: i.stock_uom?.id ?? null,
      }));
    } catch {
      return [];
    }
  }

  return (
    <tr>
      <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
        {index + 1}
      </td>
      <td className="px-2 py-1.5 align-top">
        <SearchPicker<PartOption>
          value={line.partOption ?? null}
          onChange={(opt) =>
            onPatch({
              partOption: opt,
              partId: opt ? opt.id : null,
              partLabel: opt?.label ?? "",
              uomId: opt?.uomId ?? line.uomId,
              uomSymbol: opt?.uomSymbol ?? line.uomSymbol,
            })
          }
          fetcher={searchParts}
          placeholder="Search item by name or code…"
          renderRow={(opt) => (
            <div className="min-w-0">
              <p className="truncate text-sm">{opt.name}</p>
              {opt.code && (
                <p className="font-mono text-[10px] text-muted-foreground">
                  {opt.code}
                </p>
              )}
            </div>
          )}
          disabled={!canEdit}
        />
      </td>
      <td className="px-2 py-1.5 text-right align-top">
        <Input
          type="text"
          inputMode="decimal"
          value={line.qty}
          onChange={(e) => onPatch({ qty: e.target.value })}
          placeholder="1"
          aria-label={`Line ${index + 1} qty`}
          className="h-8 text-right font-mono text-xs"
          disabled={!canEdit}
        />
      </td>
      <td className="px-2 py-1.5 align-top text-[11px] text-muted-foreground">
        {line.uomSymbol ?? "—"}
      </td>
      <td className="px-2 py-1.5 text-center align-top">
        <input
          type="checkbox"
          checked={line.isFixed}
          onChange={(e) => onPatch({ isFixed: e.target.checked })}
          aria-label={`Line ${index + 1} fixed quantity`}
          className="size-4"
          disabled={!canEdit}
        />
      </td>
      <td className="px-2 py-1.5 align-top">
        <Input
          type="text"
          value={line.notes}
          onChange={(e) => onPatch({ notes: e.target.value })}
          placeholder="Optional"
          aria-label={`Line ${index + 1} notes`}
          className="h-8 text-xs"
          disabled={!canEdit}
        />
      </td>
      <td className="px-1 py-1.5 text-center align-top">
        {canEdit && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove line ${index + 1}`}
            className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
}
