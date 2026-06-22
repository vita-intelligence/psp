"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  Box,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  LockKeyhole,
  Pencil,
  Save,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import { CountryPicker } from "@/components/forms/country-picker";
import { CurrencyPicker } from "@/components/forms/currency-picker";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import type { StockLot } from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import { updateLotAction, type UpdateLotInput } from "@/lib/stock/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import { cn } from "@/lib/utils";

interface Props {
  lot: StockLot;
  canEdit: boolean;
  /** Fired on successful save so the EditModeToggle wrapper flips
   *  the page back to view mode. */
  onSavedSuccess?: () => void;
}

const STATUS_OPTIONS: StockLot["status"][] = [
  "requested",
  "received",
  "quarantine",
  "depleted",
  "disposed",
  "rejected",
];

const UNSET = "__unset__";

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
  package_length_mm: string;
  package_width_mm: string;
  package_height_mm: string;
  package_weight_kg: string;
  units_per_package: string;
  stack_factor: string;
};

/**
 * Identity + packaging edit form. One mega-form covering both
 * sections so a single Save persists everything atomically — same
 * pattern as the item edit page.
 *
 * Realtime collab per psp/CLAUDE.md: presence avatars, per-field
 * editing indicators, remote cursors, creator gate on the Save button.
 * The Edit toggle stays — until the creator presses Edit the form
 * renders read-only; once editing, peers may join and co-edit live.
 */
export function LotEditForm({ lot, canEdit, onSavedSuccess }: Props) {
  const router = useRouter();
  const resource = `stock-lot:${lot.uuid}`;
  useFormPresenceBeacon(resource);

  const initial = useMemo(() => snapshot(lot), [lot]);

  type CommitPayload = { kind: "saved"; state: DraftSnapshot };

  const {
    state: draft,
    setField,
    resetState,
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
  } = useLiveForm<DraftSnapshot>({
    resource,
    disabled: !canEdit,
    initialState: initial,
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "saved") {
        toast.success("Saved", {
          description: `${creator?.name ?? "The host"} just saved the lot.`,
        });
        setOriginal(msg.state);
        resetState(msg.state);
        setEditing(false);
        // Peer just wrote an audit row our local Activity card doesn't
        // have yet — nudge it to refetch the timeline.
        invalidateAudit("stock_lot", lot.id);
        router.refresh();
      }
    },
  });

  const [original, setOriginal] = useState<DraftSnapshot>(() => snapshot(lot));
  // Keep `original` in sync when the parent re-fetches the lot
  // (e.g. after router.refresh). This is the "clean" baseline for
  // dirty tracking — never tied to peer-broadcast state.
  useEffect(() => {
    setOriginal(snapshot(lot));
    resetState(snapshot(lot));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lot]);

  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [topError, setTopError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const dirtyKeys = useMemo(
    () =>
      (Object.keys(original) as Array<keyof DraftSnapshot>).filter(
        (k) => (original[k] ?? "") !== (draft[k] ?? ""),
      ),
    [original, draft],
  );
  const isDirty = dirtyKeys.length > 0;

  function update<K extends keyof DraftSnapshot>(
    key: K,
    value: DraftSnapshot[K],
  ) {
    setField(key, value);
    setFieldErrors((e) => {
      if (!e[String(key)]) return e;
      const next = { ...e };
      delete next[String(key)];
      return next;
    });
  }

  function onCancel() {
    resetState(original);
    setTopError(null);
    setFieldErrors({});
    setEditing(false);
  }

  function onSave() {
    if (!canEdit || !isCreator || !isDirty) return;
    const payload = buildPayload(original, draft);

    setTopError(null);
    setFieldErrors({});

    startTransition(async () => {
      const res = await updateLotAction(lot.uuid, payload);
      if (res.ok) {
        toast.success(`Saved ${lot.code ?? `lot #${lot.id}`}`);
        setOriginal(draft);
        // Fan out the success to peer editors — they reset their
        // dirty baseline + refresh the Activity card. The audit row
        // we just wrote needs an explicit nudge on this client too
        // so our own AuditHistoryCard refetches.
        broadcastCommit({ kind: "saved", state: draft });
        invalidateAudit("stock_lot", lot.id);
        setEditing(false);
        onSavedSuccess?.();
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

  // Cursor anchor + size observer (mirrors the vendor pattern).
  const cursorAnchorRef = useRef<HTMLDivElement | null>(null);
  const [anchorSize, setAnchorSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  useEffect(() => {
    const el = cursorAnchorRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      setAnchorSize({ w: rect.width, h: rect.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => hideCursor(), [hideCursor]);

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

  if (joinError) {
    return <JoinErrorCard error={joinError} />;
  }

  // `editing` AND `canEdit` gate the inputs; the outer fieldset's
  // `disabled` is the source of truth so we don't have to thread
  // `disabled` into every Field.
  const inputsDisabled = !canEdit || !editing || pending;

  return (
    <div
      ref={cursorAnchorRef}
      onMouseMove={onCursorMove}
      onMouseLeave={hideCursor}
      className="relative space-y-4"
    >
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
        <div className="flex items-center gap-2">
          <CollabAvatars peers={presence} />
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
        </div>
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
            fieldEditors={fieldEditors}
            focusField={focusField}
            blurField={blurField}
          />
          <PackagingSection
            draft={draft}
            onChange={update}
            fieldErrors={fieldErrors}
            fieldEditors={fieldEditors}
            focusField={focusField}
            blurField={blurField}
          />
        </div>

        {canEdit && editing && (
          <>
            {!isCreator && creator && (
              <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Only{" "}
                  <span className="font-medium text-foreground">
                    {creator.name}
                  </span>{" "}
                  can save from this room. Your edits sync to them live.
                </span>
              </div>
            )}
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
                {isCreator && (
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
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={onSave}
                  disabled={pending || !isCreator || !isDirty}
                  title={
                    isCreator
                      ? undefined
                      : creator
                        ? `Only ${creator.name} can save from this room.`
                        : undefined
                  }
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
          </>
        )}
      </fieldset>
    </div>
  );
}

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
    available_from: lot.available_from ? lot.available_from.slice(0, 16) : "",
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

  // status is computed by the backend from the event stream — never
  // sent in an edit payload. Workers trigger actions, the system records
  // events, the projection updates status.
  diff("supplier_batch_no", (v) => v);
  diff("country_of_origin", (v) => v);
  diff("revision", (v) => v);
  // source_kind + source_ref are system-set at create time and read-only
  // in the UI — never send them in an edit payload.
  diff("unit_cost", (v) => v);
  diff("currency", (v) => v.toUpperCase());
  diff("manufactured_at", (v) => v);
  diff("expiry_at", (v) => v);
  diff("available_from", (v) => new Date(v).toISOString());

  diff("package_length_mm", (v) => Number.parseInt(v, 10));
  diff("package_width_mm", (v) => Number.parseInt(v, 10));
  diff("package_height_mm", (v) => Number.parseInt(v, 10));
  diff("package_weight_kg", (v) => v);
  diff("units_per_package", (v) => Number.parseInt(v, 10));
  diff("stack_factor", (v) => Number.parseInt(v, 10));

  return out;
}

interface SectionProps {
  draft: DraftSnapshot;
  onChange: <K extends keyof DraftSnapshot>(
    key: K,
    value: DraftSnapshot[K],
  ) => void;
  fieldErrors: Record<string, string[]>;
  fieldEditors: Record<
    string,
    import("@/lib/realtime/use-live-form").CollabPeer | null
  >;
  focusField: (field: string) => void;
  blurField: (field: string) => void;
}

/**
 * Read-only render of `source_ref` with a deep-link to the source
 * record when the kind has a routable detail page in the app. For
 * the two routable kinds the ref IS the source's UUID, so we link
 * straight there + show a short label ("Open MO →" / "Open PO →")
 * instead of pasting the raw UUID in mono — the long string was
 * unreadable AND clickable-but-not-obvious.
 *
 * Non-routable kinds (opening_balance, manual, adjustment, return)
 * keep the original mono-text style — those refs are free-form
 * descriptions like "Q1-2026 audit" that don't deep-link anywhere.
 */
function SourceRefDisplay({
  sourceKind,
  sourceRef,
}: {
  sourceKind: string;
  sourceRef: string;
}) {
  if (!sourceRef) {
    return (
      <div className="flex h-9 items-center rounded-md border border-border/60 bg-muted/30 px-3 text-sm text-muted-foreground">
        —
      </div>
    );
  }

  const link = resolveSourceLink(sourceKind, sourceRef);

  if (link) {
    return (
      <Link
        href={link.href}
        className="group flex h-9 items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-3 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
      >
        <span className="truncate">
          <span className="font-medium">{link.label}</span>
          <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
            {sourceRef.slice(0, 8)}…
          </span>
        </span>
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
      </Link>
    );
  }

  return (
    <div className="flex h-9 items-center rounded-md border border-border/60 bg-muted/30 px-3 font-mono text-sm text-muted-foreground">
      <span className="truncate">{sourceRef}</span>
    </div>
  );
}

function resolveSourceLink(
  sourceKind: string,
  sourceRef: string,
): { href: string; label: string } | null {
  switch (sourceKind) {
    case "purchase_order":
      return {
        href: `/procurement/purchase-orders/${encodeURIComponent(sourceRef)}`,
        label: "Open PO",
      };
    case "manufacturing_order":
      return {
        href: `/production/manufacturing-orders/${encodeURIComponent(sourceRef)}`,
        label: "Open MO",
      };
    default:
      return null;
  }
}

function labelSourceKind(value: string): string | null {
  switch (value) {
    case "purchase_order":
      return "Purchase order";
    case "manufacturing_order":
      return "Manufacturing order";
    case "opening_balance":
      return "Opening balance";
    case "return":
      return "Return";
    case "adjustment":
      return "Adjustment";
    case "manual":
      return "Manual";
    default:
      return null;
  }
}

function IdentitySection({
  draft,
  onChange,
  fieldErrors,
  fieldEditors,
  focusField,
  blurField,
}: SectionProps) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center gap-2">
        <FileText className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">Identity</h2>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Status is system-computed from the event stream (receive,
            QC verdict, hold, dispose). Workers trigger action buttons
            elsewhere on this page; the display here is read-only. */}
        <Field
          id="status_display"
          label="Status"
          editor={fieldEditors.status}
        >
          <div className="flex h-9 items-center rounded-md border border-border/60 bg-muted/30 px-3 text-sm font-medium capitalize text-muted-foreground">
            {draft.status}
          </div>
        </Field>

        <Field
          id="supplier_batch_no"
          label="Supplier batch"
          error={fieldErrors.supplier_batch_no?.[0]}
          editor={fieldEditors.supplier_batch_no}
        >
          <Input
            id="supplier_batch_no"
            value={draft.supplier_batch_no}
            onChange={(e) => onChange("supplier_batch_no", e.target.value)}
            onFocus={() => focusField("supplier_batch_no")}
            onBlur={() => blurField("supplier_batch_no")}
            placeholder="BATCH-AA-42"
            className="h-9 font-mono"
          />
        </Field>

        <Field
          id="country_of_origin"
          label="Country of origin"
          error={fieldErrors.country_of_origin?.[0]}
          editor={fieldEditors.country_of_origin}
        >
          <CountryPicker
            id="country_of_origin"
            value={draft.country_of_origin}
            onChange={(v) => onChange("country_of_origin", v ?? "")}
            onFocus={() => focusField("country_of_origin")}
            onBlur={() => blurField("country_of_origin")}
          />
        </Field>

        <Field
          id="revision"
          label="Revision"
          error={fieldErrors.revision?.[0]}
          editor={fieldEditors.revision}
        >
          <Input
            id="revision"
            value={draft.revision}
            onChange={(e) => onChange("revision", e.target.value)}
            onFocus={() => focusField("revision")}
            onBlur={() => blurField("revision")}
            placeholder="V00"
            className="h-9 font-mono"
          />
        </Field>

        {/* Source kind + ref are SYSTEM-set at create time by the flow
            that produced this lot (PO receive vs manual vs MO finish).
            Workers don't pick them — read-only display preserves the
            traceability evidence. */}
        <Field
          id="source_kind_display"
          label="Source kind"
          editor={fieldEditors.source_kind}
        >
          <div className="flex h-9 items-center rounded-md border border-border/60 bg-muted/30 px-3 text-sm text-muted-foreground">
            {labelSourceKind(draft.source_kind) ?? (
              <span className="italic text-muted-foreground/70">
                Not set
              </span>
            )}
          </div>
        </Field>

        <Field
          id="source_ref_display"
          label="Source reference"
          editor={fieldEditors.source_ref}
        >
          <SourceRefDisplay
            sourceKind={draft.source_kind}
            sourceRef={draft.source_ref}
          />
        </Field>

        <Field
          id="manufactured_at"
          label="Manufactured"
          error={fieldErrors.manufactured_at?.[0]}
          editor={fieldEditors.manufactured_at}
        >
          <Input
            id="manufactured_at"
            type="date"
            value={draft.manufactured_at}
            onChange={(e) => onChange("manufactured_at", e.target.value)}
            onFocus={() => focusField("manufactured_at")}
            onBlur={() => blurField("manufactured_at")}
            className="h-9"
          />
        </Field>

        <Field
          id="expiry_at"
          label="Expires"
          error={fieldErrors.expiry_at?.[0]}
          editor={fieldEditors.expiry_at}
        >
          <Input
            id="expiry_at"
            type="date"
            value={draft.expiry_at}
            onChange={(e) => onChange("expiry_at", e.target.value)}
            onFocus={() => focusField("expiry_at")}
            onBlur={() => blurField("expiry_at")}
            className="h-9"
          />
        </Field>

        <Field
          id="available_from"
          label="Available from"
          error={fieldErrors.available_from?.[0]}
          editor={fieldEditors.available_from}
        >
          <Input
            id="available_from"
            type="datetime-local"
            value={draft.available_from}
            onChange={(e) => onChange("available_from", e.target.value)}
            onFocus={() => focusField("available_from")}
            onBlur={() => blurField("available_from")}
            className="h-9"
          />
        </Field>

        <Field
          id="unit_cost"
          label="Unit cost"
          error={fieldErrors.unit_cost?.[0]}
          editor={fieldEditors.unit_cost}
        >
          <div className="flex gap-2">
            <Input
              id="unit_cost"
              value={draft.unit_cost}
              onChange={(e) => onChange("unit_cost", e.target.value)}
              onFocus={() => focusField("unit_cost")}
              onBlur={() => blurField("unit_cost")}
              placeholder="5.15"
              className="h-9 font-mono"
              inputMode="decimal"
            />
            <CurrencyPicker
              id="currency"
              value={draft.currency}
              onChange={(v) => onChange("currency", v ?? "")}
              onFocus={() => focusField("currency")}
              onBlur={() => blurField("currency")}
              compact
              className="w-28"
            />
          </div>
        </Field>
      </div>

      {/*
       * The old "Notes" textarea is gone — the polymorphic Comments
       * thread on the lot detail page handles discussion (timestamped,
       * attributable, peer-visible). The `stock_lots.notes` DB column
       * is left intact so historic data isn't lost.
       */}
    </section>
  );
}

function PackagingSection({
  draft,
  onChange,
  fieldErrors,
  fieldEditors,
  focusField,
  blurField,
}: SectionProps) {
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
          id="package_length_mm"
          label="Length (mm)"
          error={fieldErrors.package_length_mm?.[0]}
          editor={fieldEditors.package_length_mm}
        >
          <Input
            id="package_length_mm"
            value={draft.package_length_mm}
            onChange={(e) =>
              onChange("package_length_mm", e.target.value.replace(/\D/g, ""))
            }
            onFocus={() => focusField("package_length_mm")}
            onBlur={() => blurField("package_length_mm")}
            placeholder="e.g. 400"
            className="h-9 font-mono"
            inputMode="numeric"
          />
        </Field>
        <Field
          id="package_width_mm"
          label="Width (mm)"
          error={fieldErrors.package_width_mm?.[0]}
          editor={fieldEditors.package_width_mm}
        >
          <Input
            id="package_width_mm"
            value={draft.package_width_mm}
            onChange={(e) =>
              onChange("package_width_mm", e.target.value.replace(/\D/g, ""))
            }
            onFocus={() => focusField("package_width_mm")}
            onBlur={() => blurField("package_width_mm")}
            placeholder="e.g. 400"
            className="h-9 font-mono"
            inputMode="numeric"
          />
        </Field>
        <Field
          id="package_height_mm"
          label="Height (mm)"
          error={fieldErrors.package_height_mm?.[0]}
          editor={fieldEditors.package_height_mm}
        >
          <Input
            id="package_height_mm"
            value={draft.package_height_mm}
            onChange={(e) =>
              onChange("package_height_mm", e.target.value.replace(/\D/g, ""))
            }
            onFocus={() => focusField("package_height_mm")}
            onBlur={() => blurField("package_height_mm")}
            placeholder="e.g. 600"
            className="h-9 font-mono"
            inputMode="numeric"
          />
        </Field>
        <Field
          id="package_weight_kg"
          label="Net weight (kg)"
          error={fieldErrors.package_weight_kg?.[0]}
          editor={fieldEditors.package_weight_kg}
        >
          <Input
            id="package_weight_kg"
            value={draft.package_weight_kg}
            onChange={(e) => onChange("package_weight_kg", e.target.value)}
            onFocus={() => focusField("package_weight_kg")}
            onBlur={() => blurField("package_weight_kg")}
            placeholder="e.g. 25.000"
            className="h-9 font-mono"
            inputMode="decimal"
          />
        </Field>
        <Field
          id="units_per_package"
          label="Units / package"
          error={fieldErrors.units_per_package?.[0]}
          editor={fieldEditors.units_per_package}
        >
          <Input
            id="units_per_package"
            value={draft.units_per_package}
            onChange={(e) =>
              onChange("units_per_package", e.target.value.replace(/\D/g, ""))
            }
            onFocus={() => focusField("units_per_package")}
            onBlur={() => blurField("units_per_package")}
            placeholder="1"
            className="h-9 font-mono"
            inputMode="numeric"
          />
        </Field>
        <Field
          id="stack_factor"
          label="Stack factor"
          error={fieldErrors.stack_factor?.[0]}
          editor={fieldEditors.stack_factor}
        >
          <Input
            id="stack_factor"
            value={draft.stack_factor}
            onChange={(e) =>
              onChange("stack_factor", e.target.value.replace(/\D/g, ""))
            }
            onFocus={() => focusField("stack_factor")}
            onBlur={() => blurField("stack_factor")}
            placeholder="1"
            className="h-9 font-mono"
            inputMode="numeric"
          />
        </Field>
      </div>
    </section>
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
      tone: "amber",
      title: `Form is at capacity`,
      detail: error.limit
        ? `Up to ${error.limit} people can edit this lot at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      tone: "muted",
      title: "You can't edit here",
      detail:
        "Ask an admin for the `stock.edit` permission to join this form.",
    },
    bad_topic: {
      icon: AlertCircle,
      tone: "destructive",
      title: "Unknown form",
      detail: "We couldn't find this form. The link may have been malformed.",
    },
    unknown: {
      icon: AlertCircle,
      tone: "destructive",
      title: "Couldn't open the form",
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

function Field({
  id,
  label,
  error,
  editor,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  editor: import("@/lib/realtime/use-live-form").CollabPeer | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className="text-[11px] uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </Label>
      <div className="relative">
        {children}
        <FieldEditingIndicator peer={editor} />
      </div>
      {error && (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
