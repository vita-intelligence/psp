"use client";

// QC edit surface on the desktop sign-off page.
//
// Renders the same LinesCard shape as the read-only server page but
// wraps it in a client component that can flip into an edit mode
// where every field the operator captured becomes an input. The QC
// reviewer stages every correction locally (drafts map keyed by
// item uuid), then clicks Save — one PATCH per dirty item to the
// ``/qc-edit`` endpoint, all inside a Save action. Approval still
// happens on mobile via the existing sign-off flow.
//
// Uses the same "stage drafts + Save" commit pattern as the shared
// FilterRow (components/data-table/filter-row.tsx): all edits are
// local until the explicit Save button fires. No accidental writes
// while the reviewer is mid-typing.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  PackageCheck,
  Pencil,
  Printer,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge-mini";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { qcEditItemAction } from "@/lib/goods-in/actions";
import { cn } from "@/lib/utils";
import type {
  Inspection,
  InspectionItem,
  InspectionItemPack,
  MaterialDecision,
  PackagingCondition,
} from "@/lib/goods-in/types";
import type { PurchaseOrder, PurchaseOrderLine } from "@/lib/types";

interface Props {
  inspection: Inspection;
  purchaseOrder: PurchaseOrder | null;
  viewerCanEdit: boolean;
}

const MATERIAL_DECISION_LABEL: Record<MaterialDecision, string> = {
  accept: "Accept",
  hold: "Hold",
  reject: "Reject",
};

const MATERIAL_DECISION_TONE: Record<
  MaterialDecision,
  "emerald" | "amber" | "destructive"
> = { accept: "emerald", hold: "amber", reject: "destructive" };

const PACKAGING_CONDITION_LABEL: Record<PackagingCondition, string> = {
  good: "Good",
  damaged: "Damaged",
};

// Local editable shape — mirrors ``InspectionItem`` but pack fields
// are all strings so the ``<input>`` value never fights the source of
// truth on partial keystrokes ("12" while typing "125" would coerce
// to number and re-render the input mid-type otherwise).
interface DraftPack {
  qty: string;
  package_length_mm: string;
  package_width_mm: string;
  package_height_mm: string;
  package_weight_kg: string;
  units_per_package: string;
  stack_factor: string;
  supplier_batch_no: string;
  country_of_origin: string;
  revision: string;
  manufactured_at: string;
  expiry_at: string;
}

interface DraftItem {
  qty_received: string;
  packaging_condition: PackagingCondition | "";
  packaging_condition_notes: string;
  material_decision: MaterialDecision;
  material_decision_reason: string;
  packs: DraftPack[];
}

function packToDraft(pack: InspectionItemPack): DraftPack {
  return {
    qty: pack.qty ?? "",
    package_length_mm:
      pack.package_length_mm != null ? String(pack.package_length_mm) : "",
    package_width_mm:
      pack.package_width_mm != null ? String(pack.package_width_mm) : "",
    package_height_mm:
      pack.package_height_mm != null ? String(pack.package_height_mm) : "",
    package_weight_kg:
      pack.package_weight_kg != null ? String(pack.package_weight_kg) : "",
    units_per_package:
      pack.units_per_package != null ? String(pack.units_per_package) : "",
    stack_factor:
      pack.stack_factor != null ? String(pack.stack_factor) : "1",
    supplier_batch_no: pack.supplier_batch_no ?? "",
    country_of_origin: pack.country_of_origin ?? "",
    revision: pack.revision ?? "",
    manufactured_at: pack.manufactured_at ?? "",
    expiry_at: pack.expiry_at ?? "",
  };
}

function itemToDraft(item: InspectionItem): DraftItem {
  return {
    qty_received: item.qty_received,
    packaging_condition: item.packaging_condition ?? "",
    packaging_condition_notes: item.packaging_condition_notes ?? "",
    material_decision: item.material_decision,
    material_decision_reason: item.material_decision_reason ?? "",
    packs: (item.packs ?? []).map(packToDraft),
  };
}

// Convert an integer-typed pack field back to its wire shape. Empty
// string means the reviewer cleared the field — send it back as the
// server-side null so the record stays honest instead of coercing
// to 0.
function toIntOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

function toNumOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

function draftPackToWire(p: DraftPack): InspectionItemPack {
  return {
    qty: p.qty.trim() || "0",
    package_length_mm: toIntOrNull(p.package_length_mm) ?? 0,
    package_width_mm: toIntOrNull(p.package_width_mm) ?? 0,
    package_height_mm: toIntOrNull(p.package_height_mm) ?? 0,
    package_weight_kg: p.package_weight_kg.trim() || "0",
    units_per_package: toNumOrNull(p.units_per_package) ?? 0,
    stack_factor: toIntOrNull(p.stack_factor) ?? 1,
    supplier_batch_no: strOrNull(p.supplier_batch_no),
    country_of_origin: strOrNull(p.country_of_origin),
    revision: strOrNull(p.revision),
    manufactured_at: strOrNull(p.manufactured_at) ?? "",
    expiry_at: strOrNull(p.expiry_at) ?? "",
  };
}

// Serialise the whole item to the payload shape the QC-edit endpoint
// expects. Same wire format as ``upsertItemAction`` — the BE
// dispatches on the URL, not the body.
function draftItemToWire(d: DraftItem) {
  return {
    qty_received: d.qty_received,
    packaging_condition: d.packaging_condition || undefined,
    packaging_condition_notes: strOrNull(d.packaging_condition_notes),
    material_decision: d.material_decision,
    material_decision_reason: strOrNull(d.material_decision_reason),
    packs: d.packs.map(draftPackToWire),
  };
}

// Deep-equal enough for our shape — every field is a primitive string
// or number and drafts are always constructed from a fresh
// ``itemToDraft`` call, so ``JSON.stringify`` is safe + fast.
function sameDraft(a: DraftItem, b: DraftItem): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function QcLinesEditor({
  inspection,
  purchaseOrder,
  viewerCanEdit,
}: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [drafts, setDrafts] = useState<Record<string, DraftItem>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lineByUuid = useMemo(() => {
    const m = new Map<string, PurchaseOrderLine>();
    for (const l of purchaseOrder?.lines ?? []) m.set(l.uuid, l);
    return m;
  }, [purchaseOrder]);

  const items = useMemo(
    () =>
      inspection.items.map((it) => ({
        item: it,
        line: it.purchase_order_line_uuid
          ? (lineByUuid.get(it.purchase_order_line_uuid) ?? null)
          : null,
      })),
    [inspection.items, lineByUuid],
  );

  const baseDrafts = useMemo(() => {
    const map: Record<string, DraftItem> = {};
    for (const { item } of items) map[item.uuid] = itemToDraft(item);
    return map;
  }, [items]);

  const currentDrafts: Record<string, DraftItem> = useMemo(() => {
    if (mode === "read") return baseDrafts;
    return { ...baseDrafts, ...drafts };
  }, [mode, baseDrafts, drafts]);

  const dirtyItems = useMemo(() => {
    const out: Array<{ uuid: string; draft: DraftItem }> = [];
    for (const [uuid, draft] of Object.entries(currentDrafts)) {
      const base = baseDrafts[uuid];
      if (base && !sameDraft(base, draft)) out.push({ uuid, draft });
    }
    return out;
  }, [currentDrafts, baseDrafts]);

  const isDirty = dirtyItems.length > 0;

  function updateItem(uuid: string, partial: Partial<DraftItem>) {
    setDrafts((prev) => ({
      ...prev,
      [uuid]: { ...(prev[uuid] ?? baseDrafts[uuid]), ...partial },
    }));
  }

  function updatePack(
    itemUuid: string,
    idx: number,
    partial: Partial<DraftPack>,
  ) {
    setDrafts((prev) => {
      const base = prev[itemUuid] ?? baseDrafts[itemUuid];
      if (!base) return prev;
      const packs = base.packs.map((p, i) =>
        i === idx ? { ...p, ...partial } : p,
      );
      return { ...prev, [itemUuid]: { ...base, packs } };
    });
  }

  async function save() {
    if (dirtyItems.length === 0) return;
    setSaving(true);
    setError(null);
    for (const { uuid, draft } of dirtyItems) {
      // Find the PO line uuid for this inspection item — the endpoint
      // is keyed on line uuid, not item uuid, because the operator's
      // upsert flow keyed the same way.
      const inspectionItem = inspection.items.find((it) => it.uuid === uuid);
      const lineUuid = inspectionItem?.purchase_order_line_uuid;
      if (!lineUuid) continue;
      const res = await qcEditItemAction(
        inspection.uuid,
        lineUuid,
        draftItemToWire(draft),
      );
      if (!res.ok) {
        setError(
          res.detail ??
            "Couldn't save your corrections. Nothing has been changed on the server yet — try again.",
        );
        setSaving(false);
        return;
      }
    }
    setDrafts({});
    setMode("read");
    setSaving(false);
    // Server-side page uses ``force-dynamic`` — a hard router refresh
    // re-runs the data loader so every card re-renders with the
    // freshly-saved values (including the audit-triggered timestamps).
    router.refresh();
  }

  function cancelEdit() {
    setDrafts({});
    setError(null);
    setMode("read");
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <PackageCheck className="size-4" />
          Per-line decisions
        </h2>
        {viewerCanEdit && mode === "read" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setMode("edit")}
            className="h-7 gap-1.5 text-xs"
          >
            <Pencil className="size-3" />
            Edit
          </Button>
        )}
        {mode === "edit" && (
          <span className="text-[11px] uppercase tracking-wide text-brand">
            Editing — changes are staged locally until Save
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No per-line decisions recorded yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map(({ item, line }) => (
            <LineCard
              key={item.uuid}
              item={item}
              line={line}
              inspectionUuid={inspection.uuid}
              mode={mode}
              draft={currentDrafts[item.uuid]}
              base={baseDrafts[item.uuid]}
              onChange={(partial) => updateItem(item.uuid, partial)}
              onPackChange={(idx, partial) =>
                updatePack(item.uuid, idx, partial)
              }
              onResetItem={() =>
                setDrafts((prev) => {
                  const next = { ...prev };
                  delete next[item.uuid];
                  return next;
                })
              }
            />
          ))}
        </ul>
      )}

      {mode === "edit" && (
        // Same footer shape as the shared FilterRow's Apply strip —
        // Reset on the left when there's anything to discard, Save on
        // the right, disabled until at least one field diverges from
        // the operator's original write.
        <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {isDirty ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDrafts({})}
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                disabled={saving}
              >
                <RotateCcw className="size-3" />
                Discard all corrections
              </Button>
            ) : (
              <span />
            )}
            {isDirty && (
              <span className="text-[11px] text-muted-foreground">
                {dirtyItems.length === 1
                  ? "1 line changed"
                  : `${dirtyItems.length} lines changed`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancelEdit}
              disabled={saving}
              className="h-8 gap-1.5 text-xs"
            >
              <X className="size-3" />
              Cancel edit
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={!isDirty || saving}
              className="h-8 gap-1.5 text-xs"
            >
              {saving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Save className="size-3" />
              )}
              Save corrections
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {mode === "edit" && !error && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Approval still happens on your phone via the mobile sign-off flow —
          this desktop surface just lets you fix the operator&apos;s entries
          first. Corrections land on the audit trail with your identity + a
          before/after diff.
        </p>
      )}
    </section>
  );
}

function LineCard({
  item,
  line,
  inspectionUuid,
  mode,
  draft,
  base,
  onChange,
  onPackChange,
  onResetItem,
}: {
  item: InspectionItem;
  line: PurchaseOrderLine | null;
  inspectionUuid: string;
  mode: "read" | "edit";
  draft: DraftItem | undefined;
  base: DraftItem | undefined;
  onChange: (partial: Partial<DraftItem>) => void;
  onPackChange: (idx: number, partial: Partial<DraftPack>) => void;
  onResetItem: () => void;
}) {
  const d = draft ?? base;
  if (!d || !base) return null;
  const itemDirty = !sameDraft(base, d);
  const isEdit = mode === "edit";

  return (
    <li
      className={cn(
        "space-y-2 rounded-md border px-3 py-2.5",
        itemDirty
          ? "border-brand/40 bg-brand/[0.03]"
          : "border-border/40",
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          {line?.item?.uuid ? (
            <Link
              href={`/production/items/${line.item.uuid}`}
              className="block truncate text-sm font-medium underline-offset-2 hover:underline"
            >
              {line.item.name}
            </Link>
          ) : (
            <p className="truncate text-sm font-medium">
              {line?.item?.name ?? "Unknown item"}
            </p>
          )}
          {line?.vendor_part_no && (
            <p className="font-mono text-[11px] text-muted-foreground">
              {line.vendor_part_no}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Received {item.qty_received}
            {line?.qty_ordered ? ` of ${line.qty_ordered}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {isEdit ? (
            <select
              value={d.material_decision}
              onChange={(e) =>
                onChange({
                  material_decision: e.target.value as MaterialDecision,
                })
              }
              className="h-7 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="accept">Accept</option>
              <option value="hold">Hold</option>
              <option value="reject">Reject</option>
            </select>
          ) : (
            <Badge tone={MATERIAL_DECISION_TONE[d.material_decision]}>
              {MATERIAL_DECISION_LABEL[d.material_decision]}
            </Badge>
          )}
          {itemDirty && (
            <button
              type="button"
              onClick={onResetItem}
              className="text-[10px] font-medium text-brand hover:underline"
            >
              Reset this line
            </button>
          )}
        </div>
      </div>

      {isEdit && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-[11px]">
            <span className="uppercase tracking-wide text-muted-foreground">
              Packaging condition
            </span>
            <select
              value={d.packaging_condition}
              onChange={(e) =>
                onChange({
                  packaging_condition: e.target.value as PackagingCondition | "",
                })
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">— not set</option>
              <option value="good">Good</option>
              <option value="damaged">Damaged</option>
            </select>
          </label>
          <label className="space-y-1 text-[11px]">
            <span className="uppercase tracking-wide text-muted-foreground">
              Packaging condition note
            </span>
            <Input
              value={d.packaging_condition_notes}
              onChange={(e) =>
                onChange({ packaging_condition_notes: e.target.value })
              }
              placeholder="Optional — what the operator observed"
              className="h-8 text-xs"
            />
          </label>
          <label className="space-y-1 text-[11px] sm:col-span-2">
            <span className="uppercase tracking-wide text-muted-foreground">
              Material decision reason
            </span>
            <Input
              value={d.material_decision_reason}
              onChange={(e) =>
                onChange({ material_decision_reason: e.target.value })
              }
              placeholder="Why hold / reject — mandatory for anything other than Accept"
              className="h-8 text-xs"
            />
          </label>
        </div>
      )}

      {!isEdit && d.packaging_condition && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Badge tone={d.packaging_condition === "good" ? "emerald" : "amber"}>
            Packaging: {PACKAGING_CONDITION_LABEL[d.packaging_condition]}
          </Badge>
        </div>
      )}

      {d.packs.length > 0 && line && (
        <PacksEditor
          inspectionUuid={inspectionUuid}
          lineUuid={line.uuid}
          packs={d.packs}
          uomSymbol={
            line.item?.stock_uom?.symbol ??
            line.item?.stock_uom?.code ??
            null
          }
          mode={mode}
          onPackChange={onPackChange}
        />
      )}
    </li>
  );
}

function PacksEditor({
  inspectionUuid,
  lineUuid,
  packs,
  uomSymbol,
  mode,
  onPackChange,
}: {
  inspectionUuid: string;
  lineUuid: string;
  packs: DraftPack[];
  uomSymbol: string | null;
  mode: "read" | "edit";
  onPackChange: (idx: number, partial: Partial<DraftPack>) => void;
}) {
  const isEdit = mode === "edit";
  return (
    <div className="space-y-2 rounded-md border border-border/30 bg-muted/20 p-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Packs · {packs.length}
        </p>
        <p className="text-[10px] text-muted-foreground">
          Quarantine label per pack
        </p>
      </div>
      <ul className="space-y-2">
        {packs.map((pack, idx) => {
          const href =
            `/api/m/inspections/${encodeURIComponent(inspectionUuid)}` +
            `/quarantine-label.pdf?line_uuid=${encodeURIComponent(lineUuid)}` +
            `&pack_index=${idx}&copies=1`;
          if (isEdit) {
            return (
              <li
                key={idx}
                className="space-y-2 rounded-md border border-border/40 bg-background/60 p-3"
              >
                <p className="text-sm font-semibold">Pack {idx + 1}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  <PackInput
                    label={`Qty ${uomSymbol ? `(${uomSymbol})` : ""}`}
                    value={pack.qty}
                    onChange={(v) => onPackChange(idx, { qty: v })}
                    mono
                    inputMode="decimal"
                  />
                  <PackInput
                    label="Length (mm)"
                    value={pack.package_length_mm}
                    onChange={(v) =>
                      onPackChange(idx, { package_length_mm: v })
                    }
                    mono
                    inputMode="numeric"
                  />
                  <PackInput
                    label="Width (mm)"
                    value={pack.package_width_mm}
                    onChange={(v) =>
                      onPackChange(idx, { package_width_mm: v })
                    }
                    mono
                    inputMode="numeric"
                  />
                  <PackInput
                    label="Height (mm)"
                    value={pack.package_height_mm}
                    onChange={(v) =>
                      onPackChange(idx, { package_height_mm: v })
                    }
                    mono
                    inputMode="numeric"
                  />
                  <PackInput
                    label="Weight (kg)"
                    value={pack.package_weight_kg}
                    onChange={(v) =>
                      onPackChange(idx, { package_weight_kg: v })
                    }
                    mono
                    inputMode="decimal"
                  />
                  <PackInput
                    label="Units per pack"
                    value={pack.units_per_package}
                    onChange={(v) =>
                      onPackChange(idx, { units_per_package: v })
                    }
                    mono
                    inputMode="decimal"
                  />
                  <PackInput
                    label="Stack factor"
                    value={pack.stack_factor}
                    onChange={(v) => onPackChange(idx, { stack_factor: v })}
                    mono
                    inputMode="numeric"
                  />
                  <PackInput
                    label="Batch"
                    value={pack.supplier_batch_no}
                    onChange={(v) =>
                      onPackChange(idx, { supplier_batch_no: v })
                    }
                    mono
                  />
                  <PackInput
                    label="Country of origin"
                    value={pack.country_of_origin}
                    onChange={(v) =>
                      onPackChange(idx, { country_of_origin: v })
                    }
                    mono
                    placeholder="ISO 3166-1 (GB, IT, …)"
                  />
                  <PackInput
                    label="Manufactured"
                    value={pack.manufactured_at}
                    onChange={(v) =>
                      onPackChange(idx, { manufactured_at: v })
                    }
                    mono
                    type="date"
                  />
                  <PackInput
                    label="Expiry / best before"
                    value={pack.expiry_at}
                    onChange={(v) => onPackChange(idx, { expiry_at: v })}
                    mono
                    type="date"
                  />
                  <PackInput
                    label="Revision"
                    value={pack.revision}
                    onChange={(v) => onPackChange(idx, { revision: v })}
                    mono
                  />
                </div>
              </li>
            );
          }
          const hasDims =
            pack.package_length_mm ||
            pack.package_width_mm ||
            pack.package_height_mm;
          return (
            <li
              key={idx}
              className="space-y-2 rounded-md border border-border/40 bg-background/60 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">
                  Pack {idx + 1}
                  <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                    {pack.qty || "—"}
                    {uomSymbol ? ` ${uomSymbol}` : ""}
                  </span>
                </p>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] font-medium hover:bg-muted"
                  title="Print quarantine label for this pack"
                >
                  <Printer className="size-3" />
                  Print
                </a>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3 md:grid-cols-4">
                <ReadField
                  label="Dimensions (mm)"
                  value={
                    hasDims
                      ? `${pack.package_length_mm || "—"}×${pack.package_width_mm || "—"}×${pack.package_height_mm || "—"}`
                      : null
                  }
                />
                <ReadField label="Weight (kg)" value={pack.package_weight_kg || null} />
                <ReadField label="Units per pack" value={pack.units_per_package || null} />
                <ReadField
                  label="Stack factor"
                  value={
                    pack.stack_factor
                      ? `${pack.stack_factor}${pack.stack_factor === "1" ? " (no vertical stacking)" : ""}`
                      : null
                  }
                />
                <ReadField label="Batch" value={pack.supplier_batch_no || null} />
                <ReadField label="Country of origin" value={pack.country_of_origin || null} />
                <ReadField label="Manufactured" value={pack.manufactured_at || null} />
                <ReadField label="Expiry / best before" value={pack.expiry_at || null} />
                <ReadField label="Revision" value={pack.revision || null} />
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PackInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
  type,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: "date";
  inputMode?: "numeric" | "decimal";
}) {
  return (
    <label className="min-w-0 space-y-0.5 text-[11px]">
      <span className="block uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        inputMode={inputMode}
        className={cn("h-7 text-xs", mono && "font-mono")}
      />
    </label>
  );
}

function ReadField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={
          value == null
            ? "text-xs text-muted-foreground/60"
            : "truncate font-mono text-xs font-medium text-foreground"
        }
        title={value ?? undefined}
      >
        {value ?? "— not recorded"}
      </dd>
    </div>
  );
}
