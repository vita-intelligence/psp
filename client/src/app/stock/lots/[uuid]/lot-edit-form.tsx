"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Box, FileText, Loader2, Lock, Pencil, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { StockLot } from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import { updateLotAction, type UpdateLotInput } from "@/lib/stock/actions";

interface Props {
  lot: StockLot;
  canEdit: boolean;
}

const STATUS_OPTIONS: StockLot["status"][] = [
  "requested",
  "received",
  "quarantine",
  "depleted",
  "disposed",
  "rejected",
];

/**
 * Identity + packaging edit form. One mega-form covering both
 * sections so a single Save persists everything atomically — same
 * pattern as the item edit page.
 *
 * Default state is read-only display; an explicit Edit button flips
 * the section into edit mode so the operator never accidentally
 * tabs into a field and changes a value. Save persists and drops
 * back to read-only; Cancel discards.
 *
 * Without `stock.edit` the Edit button stays hidden and the form
 * renders as a permanent read-only view.
 */
export function LotEditForm({ lot, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [topError, setTopError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const initial = useMemo(() => snapshot(lot), [lot]);
  const [draft, setDraft] = useState(initial);

  // When the upstream lot prop changes (router.refresh after save),
  // reset the draft to the new baseline. Otherwise we'd keep the
  // stale dirty diff against the pre-save snapshot.
  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const dirtyKeys = useMemo(
    () =>
      (Object.keys(initial) as Array<keyof typeof initial>).filter(
        (k) => (initial[k] ?? "") !== (draft[k] ?? ""),
      ),
    [initial, draft],
  );
  const isDirty = dirtyKeys.length > 0;

  function update<K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
    setFieldErrors((e) => {
      if (!e[String(key)]) return e;
      const { [String(key)]: _, ...rest } = e;
      void _;
      return rest;
    });
  }

  function onCancel() {
    setDraft(initial);
    setTopError(null);
    setFieldErrors({});
    setEditing(false);
  }

  function onSave() {
    if (!canEdit || !isDirty) return;
    const payload = buildPayload(initial, draft);

    setTopError(null);
    setFieldErrors({});

    startTransition(async () => {
      const res = await updateLotAction(lot.uuid, payload);
      if (res.ok) {
        toast.success(`Saved ${lot.code ?? `lot #${lot.id}`}`);
        // Flip back to read-only — the next-render `useEffect` above
        // will re-snapshot once the parent's revalidated lot prop
        // lands.
        setEditing(false);
        router.refresh();
      } else {
        setTopError({
          detail: res.detail,
          code: res.code,
          debug: res.debug,
        });
        setFieldErrors(res.fields ?? {});
      }
    });
  }

  // `editing` AND `canEdit` gate the inputs; the outer fieldset's
  // `disabled` is the source of truth so we don't have to thread
  // `disabled` into every Field.
  const inputsDisabled = !canEdit || !editing || pending;

  return (
    <div className="space-y-4">
      {/* Header sits outside the disabled fieldset so the Edit button
          stays clickable in the default read-only state. */}
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {!canEdit && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
              <Lock className="size-3" />
              Read-only — needs <span className="font-mono">stock.edit</span>
            </span>
          )}
          {canEdit && !editing && (
            <span className="text-[11px] text-muted-foreground">
              Read-only view — press Edit to change anything.
            </span>
          )}
        </div>
        {canEdit && !editing && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
          >
            <Pencil className="mr-1.5 size-4" />
            Edit
          </Button>
        )}
      </header>

      <fieldset disabled={inputsDisabled} className="space-y-4 border-0 p-0">

      {topError && (
        <ErrorBanner
          detail={topError.detail}
          code={topError.code}
          debug={topError.debug}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <IdentitySection
          draft={draft}
          onChange={update}
          fieldErrors={fieldErrors}
        />
        <PackagingSection
          draft={draft}
          onChange={update}
          fieldErrors={fieldErrors}
        />
      </div>

      {canEdit && editing && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/95 px-4 py-3 shadow-md backdrop-blur">
          <div className="text-xs text-muted-foreground">
            {isDirty ? (
              <>
                <span className="font-semibold text-foreground">
                  {dirtyKeys.length} change
                  {dirtyKeys.length === 1 ? "" : "s"}
                </span>{" "}
                ready to save.
              </>
            ) : (
              <>Editing — make a change then Save.</>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={pending}
            >
              <Undo2 className="mr-1.5 size-4" />
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onSave}
              disabled={pending || !isDirty}
            >
              {pending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 size-4" />
              )}
              Save changes
            </Button>
          </div>
        </div>
      )}
      </fieldset>
    </div>
  );
}

type DraftSnapshot = {
  status: string;
  supplier_batch_no: string;
  country_of_origin: string;
  revision: string;
  source_kind: string;
  source_ref: string;
  unit_cost: string;
  currency: string;
  manufactured_at: string;
  expiry_at: string;
  available_from: string;
  notes: string;
  package_length_mm: string;
  package_width_mm: string;
  package_height_mm: string;
  package_weight_kg: string;
  units_per_package: string;
  stack_factor: string;
};

function snapshot(lot: StockLot): DraftSnapshot {
  return {
    status: lot.status,
    supplier_batch_no: lot.supplier_batch_no ?? "",
    country_of_origin: lot.country_of_origin ?? "",
    revision: lot.revision ?? "",
    source_kind: lot.source_kind ?? "",
    source_ref: lot.source_ref ?? "",
    unit_cost: lot.unit_cost ?? "",
    currency: lot.currency ?? "",
    manufactured_at: lot.manufactured_at ?? "",
    expiry_at: lot.expiry_at ?? "",
    available_from: lot.available_from
      ? lot.available_from.slice(0, 16)
      : "",
    notes: lot.notes ?? "",
    package_length_mm: lot.package_length_mm?.toString() ?? "",
    package_width_mm: lot.package_width_mm?.toString() ?? "",
    package_height_mm: lot.package_height_mm?.toString() ?? "",
    package_weight_kg: lot.package_weight_kg ?? "",
    units_per_package: lot.units_per_package?.toString() ?? "",
    stack_factor: lot.stack_factor?.toString() ?? "",
  };
}

function buildPayload(
  initial: DraftSnapshot,
  draft: DraftSnapshot,
): UpdateLotInput {
  // Only send changed fields. Backend overwrites whatever's sent, so
  // omitting unchanged fields keeps the audit diff tight.
  const out: UpdateLotInput = {};

  function diff<K extends keyof DraftSnapshot>(
    key: K,
    convert: (v: string) => UpdateLotInput[keyof UpdateLotInput],
  ) {
    if (initial[key] === draft[key]) return;
    const value = draft[key].trim();
    (out as Record<string, unknown>)[key] =
      value === "" ? null : convert(value);
  }

  diff("status", (v) => v as StockLot["status"]);
  diff("supplier_batch_no", (v) => v);
  diff("country_of_origin", (v) => v);
  diff("revision", (v) => v);
  diff("source_kind", (v) => v as StockLot["source_kind"]);
  diff("source_ref", (v) => v);
  diff("unit_cost", (v) => v);
  diff("currency", (v) => v.toUpperCase());
  diff("manufactured_at", (v) => v);
  diff("expiry_at", (v) => v);
  diff("available_from", (v) => new Date(v).toISOString());
  diff("notes", (v) => v);

  // Packaging — integers, weight is a decimal string.
  diff("package_length_mm", (v) => Number.parseInt(v, 10));
  diff("package_width_mm", (v) => Number.parseInt(v, 10));
  diff("package_height_mm", (v) => Number.parseInt(v, 10));
  diff("package_weight_kg", (v) => v);
  diff("units_per_package", (v) => Number.parseInt(v, 10));
  diff("stack_factor", (v) => Number.parseInt(v, 10));

  return out;
}

function IdentitySection({
  draft,
  onChange,
  fieldErrors,
}: {
  draft: DraftSnapshot;
  onChange: <K extends keyof DraftSnapshot>(
    key: K,
    value: DraftSnapshot[K],
  ) => void;
  fieldErrors: Record<string, string[]>;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center gap-2">
        <FileText className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">Identity</h2>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status" error={fieldErrors.status?.[0]}>
          <Select
            value={draft.status}
            onValueChange={(v) => onChange("status", v as DraftSnapshot["status"])}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Supplier batch"
          error={fieldErrors.supplier_batch_no?.[0]}
        >
          <Input
            value={draft.supplier_batch_no}
            onChange={(e) => onChange("supplier_batch_no", e.target.value)}
            placeholder="BATCH-AA-42"
            className="h-9 font-mono"
          />
        </Field>

        <Field
          label="Country of origin"
          error={fieldErrors.country_of_origin?.[0]}
        >
          <Input
            value={draft.country_of_origin}
            onChange={(e) => onChange("country_of_origin", e.target.value)}
            placeholder="IT"
            className="h-9"
          />
        </Field>

        <Field label="Revision" error={fieldErrors.revision?.[0]}>
          <Input
            value={draft.revision}
            onChange={(e) => onChange("revision", e.target.value)}
            placeholder="V00"
            className="h-9 font-mono"
          />
        </Field>

        <Field label="Source kind" error={fieldErrors.source_kind?.[0]}>
          <Select
            value={draft.source_kind || "__unset__"}
            onValueChange={(v) =>
              onChange("source_kind", v === "__unset__" ? "" : v)
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unset__">—</SelectItem>
              <SelectItem value="purchase_order">Purchase order</SelectItem>
              <SelectItem value="manufacturing_order">
                Manufacturing order
              </SelectItem>
              <SelectItem value="opening_balance">Opening balance</SelectItem>
              <SelectItem value="return">Return</SelectItem>
              <SelectItem value="adjustment">Adjustment</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Source reference" error={fieldErrors.source_ref?.[0]}>
          <Input
            value={draft.source_ref}
            onChange={(e) => onChange("source_ref", e.target.value)}
            placeholder="PO00438"
            className="h-9 font-mono"
          />
        </Field>

        <Field label="Manufactured" error={fieldErrors.manufactured_at?.[0]}>
          <Input
            type="date"
            value={draft.manufactured_at}
            onChange={(e) => onChange("manufactured_at", e.target.value)}
            className="h-9"
          />
        </Field>

        <Field label="Expires" error={fieldErrors.expiry_at?.[0]}>
          <Input
            type="date"
            value={draft.expiry_at}
            onChange={(e) => onChange("expiry_at", e.target.value)}
            className="h-9"
          />
        </Field>

        <Field label="Available from" error={fieldErrors.available_from?.[0]}>
          <Input
            type="datetime-local"
            value={draft.available_from}
            onChange={(e) => onChange("available_from", e.target.value)}
            className="h-9"
          />
        </Field>

        <Field label="Unit cost" error={fieldErrors.unit_cost?.[0]}>
          <div className="flex gap-2">
            <Input
              value={draft.unit_cost}
              onChange={(e) => onChange("unit_cost", e.target.value)}
              placeholder="5.15"
              className="h-9 font-mono"
              inputMode="decimal"
            />
            <Input
              value={draft.currency}
              onChange={(e) =>
                onChange("currency", e.target.value.toUpperCase())
              }
              placeholder="GBP"
              className="h-9 w-20 font-mono"
              maxLength={3}
            />
          </div>
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Notes" error={fieldErrors.notes?.[0]}>
          <Textarea
            value={draft.notes}
            onChange={(e) => onChange("notes", e.target.value)}
            placeholder="Anything that needs surfacing on the lot detail page"
            rows={3}
          />
        </Field>
      </div>
    </section>
  );
}

function PackagingSection({
  draft,
  onChange,
  fieldErrors,
}: {
  draft: DraftSnapshot;
  onChange: <K extends keyof DraftSnapshot>(
    key: K,
    value: DraftSnapshot[K],
  ) => void;
  fieldErrors: Record<string, string[]>;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center gap-2">
        <Box className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">Packaging</h2>
        <span className="ml-auto rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
          Required
        </span>
      </header>

      <p className="mb-3 text-[11px] text-muted-foreground">
        Drives the put-away fit-check (volumetric + weight). Update if a
        supplier ships the same SKU in a different package this batch.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Length (mm)"
          error={fieldErrors.package_length_mm?.[0]}
        >
          <Input
            value={draft.package_length_mm}
            onChange={(e) =>
              onChange("package_length_mm", e.target.value.replace(/\D/g, ""))
            }
            placeholder="e.g. 400"
            className="h-9 font-mono"
            inputMode="numeric"
          />
        </Field>
        <Field label="Width (mm)" error={fieldErrors.package_width_mm?.[0]}>
          <Input
            value={draft.package_width_mm}
            onChange={(e) =>
              onChange("package_width_mm", e.target.value.replace(/\D/g, ""))
            }
            placeholder="e.g. 400"
            className="h-9 font-mono"
            inputMode="numeric"
          />
        </Field>
        <Field
          label="Height (mm)"
          error={fieldErrors.package_height_mm?.[0]}
        >
          <Input
            value={draft.package_height_mm}
            onChange={(e) =>
              onChange("package_height_mm", e.target.value.replace(/\D/g, ""))
            }
            placeholder="e.g. 600"
            className="h-9 font-mono"
            inputMode="numeric"
          />
        </Field>
        <Field
          label="Net weight (kg)"
          error={fieldErrors.package_weight_kg?.[0]}
        >
          <Input
            value={draft.package_weight_kg}
            onChange={(e) => onChange("package_weight_kg", e.target.value)}
            placeholder="e.g. 25.000"
            className="h-9 font-mono"
            inputMode="decimal"
          />
        </Field>
        <Field
          label="Units / package"
          error={fieldErrors.units_per_package?.[0]}
        >
          <Input
            value={draft.units_per_package}
            onChange={(e) =>
              onChange("units_per_package", e.target.value.replace(/\D/g, ""))
            }
            placeholder="1"
            className="h-9 font-mono"
            inputMode="numeric"
          />
        </Field>
        <Field label="Stack factor" error={fieldErrors.stack_factor?.[0]}>
          <Input
            value={draft.stack_factor}
            onChange={(e) =>
              onChange("stack_factor", e.target.value.replace(/\D/g, ""))
            }
            placeholder="1"
            className="h-9 font-mono"
            inputMode="numeric"
          />
        </Field>
      </div>
    </section>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
      {error && (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
