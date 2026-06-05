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
import { toast } from "sonner";
import { AlertCircle, Loader2, Lock, LockKeyhole, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import { FieldError } from "@/components/forms/field-error";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm, type JoinError } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { invalidateAudit, subscribeRestore } from "@/lib/audit/invalidator";
import {
  createUnitAction,
  deleteUnitAction,
  updateUnitAction,
} from "@/lib/units/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type { UnitDimension, UnitOfMeasurement } from "@/lib/types";

interface FormProps {
  /** `null` ⇒ new unit; otherwise the row being edited. */
  unit: UnitOfMeasurement | null;
  canEdit: boolean;
}

const DIMENSION_OPTIONS: Array<{ value: UnitDimension; label: string }> = [
  { value: "mass", label: "Mass (kg, g, lb…)" },
  { value: "volume", label: "Volume (L, mL…)" },
  { value: "count", label: "Count (pcs, dozen…)" },
  { value: "length", label: "Length (m, cm, mm…)" },
  { value: "area", label: "Area (m², cm²…)" },
  { value: "time", label: "Time (s, min, h…)" },
];

interface FormState {
  name: string;
  symbol: string;
  dimension: UnitDimension;
  factor_to_base: string;
  is_base: boolean;
  is_active: boolean;
}

function initialFrom(unit: UnitOfMeasurement | null): FormState {
  if (!unit) {
    return {
      name: "",
      symbol: "",
      dimension: "mass",
      factor_to_base: "1",
      is_base: false,
      is_active: true,
    };
  }
  return {
    name: unit.name,
    symbol: unit.symbol,
    dimension: unit.dimension,
    factor_to_base: unit.factor_to_base,
    is_base: unit.is_base,
    is_active: unit.is_active,
  };
}

export function UnitForm({ unit, canEdit }: FormProps) {
  const router = useRouter();
  const isEdit = unit !== null;
  const resource = unit
    ? `unit-of-measurement:${unit.uuid}`
    : "unit-of-measurement:new";

  // Tell the lobby presence layer "I'm currently on this form" so the
  // list page can show "X is drafting/editing Y" badges.
  useFormPresenceBeacon(resource);

  // Discriminated commit-payload union — what the room creator pushes
  // to peers on a successful save / create.
  type CommitPayload =
    | { kind: "created"; uuid: string; name: string }
    | { kind: "saved"; state: FormState };

  const {
    state,
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
  } = useLiveForm<FormState>({
    resource,
    // Viewers (no `units.manage`) skip the channel — backend would 403
    // the join anyway. They get the static initial state and a clean
    // read-only form.
    disabled: !canEdit,
    initialState: useMemo(() => initialFrom(unit), [unit]),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Unit created", {
          description: `${creator?.name ?? "The host"} just finalized "${msg.name}".`,
        });
        router.push("/settings/units-of-measurement");
      } else if (msg.kind === "saved") {
        toast.success("Saved", {
          description: `${creator?.name ?? "The host"} just saved the form.`,
        });
        setOriginal(msg.state);
        resetState(msg.state);
        if (unit) invalidateAudit("unit_of_measurement", unit.id);
      }
    },
  });

  // Anchor for the live-cursor coordinate space. Senders normalise
  // mouse position against this element's bounding rect; receivers
  // multiply back out — same anchor, same visual position regardless
  // of screen size.
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
  }, []);

  // Hide our cursor on unmount so peers don't see a stale arrow sitting
  // where we last moved before navigating away.
  useEffect(() => {
    return () => hideCursor();
  }, [hideCursor]);

  // Restore-version listener — Activity-card "Restore" dispatches the
  // row's `state_after`; convert it back into form state and replace
  // local. User then reviews + Saves to record it as a new audit event.
  useEffect(() => {
    if (!unit) return;
    return subscribeRestore("unit_of_measurement", unit.id, (raw) => {
      const r = raw as Partial<UnitOfMeasurement> & Record<string, unknown>;
      const restored: FormState = {
        name: typeof r.name === "string" ? r.name : "",
        symbol: typeof r.symbol === "string" ? r.symbol : "",
        dimension: (r.dimension as UnitDimension) ?? "mass",
        factor_to_base:
          typeof r.factor_to_base === "string" ? r.factor_to_base : "1",
        is_base: Boolean(r.is_base),
        is_active: r.is_active !== false,
      };
      resetState(restored);
    });
  }, [unit, resetState]);

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

  const [original, setOriginal] = useState<FormState>(() => initialFrom(unit));
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  // The base unit *defines* its dimension's scale, so its factor must
  // be 1 by definition. Keep the UI in sync so users can't submit a
  // contradiction the changeset would then reject.
  function onToggleBase(next: boolean) {
    setField("is_base", next);
    if (next) setField("factor_to_base", "1");
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setFieldErrors({});

    startTransition(async () => {
      const payload = {
        name: state.name.trim(),
        symbol: state.symbol.trim(),
        dimension: state.dimension,
        factor_to_base: state.factor_to_base.trim(),
        is_base: state.is_base,
        is_active: state.is_active,
      };

      const res = isEdit
        ? await updateUnitAction(unit!.uuid, payload)
        : await createUnitAction(payload);

      if (!res.ok) {
        setFieldErrors(res.fields ?? {});
        setActionError(res);
        return;
      }

      toast.success(isEdit ? "Unit updated" : "Unit created");
      setOriginal(state);

      // Refresh the Activity card without a page reload.
      invalidateAudit("unit_of_measurement", res.unit.id);

      // Broadcast: peers receiving `created` route back to the list;
      // peers receiving `saved` reset their baseline + toast.
      if (isEdit) {
        broadcastCommit({ kind: "saved", state });
      } else {
        broadcastCommit({
          kind: "created",
          uuid: res.unit.uuid,
          name: res.unit.name,
        });
      }
      router.push("/settings/units-of-measurement");
      router.refresh();
    });
  }

  function onReset() {
    resetState(original);
    setFieldErrors({});
    setActionError(null);
  }

  function onDelete() {
    if (!unit) return;
    if (
      !window.confirm(
        `Delete "${unit.name}" (${unit.symbol})? Anything currently expressed in this unit will need re-assigning.`,
      )
    ) {
      return;
    }
    setActionError(null);
    startTransition(async () => {
      const res = await deleteUnitAction(unit.uuid);
      if (!res.ok) {
        setActionError(res);
        return;
      }
      toast.success("Unit removed");
      router.push("/settings/units-of-measurement");
      router.refresh();
    });
  }

  if (joinError) {
    return <JoinErrorCard error={joinError} isEdit={isEdit} />;
  }

  return (
    <div
      ref={cursorAnchorRef}
      onMouseMove={canEdit ? onCursorMove : undefined}
      onMouseLeave={canEdit ? hideCursor : undefined}
      className="relative rounded-lg border border-border/60 bg-background p-5"
    >
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Remote-cursor layer — anchored to the form so coordinates
          stay in sync with the actual bounding box, not the viewport. */}
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-lg">
        {Object.entries(cursors).map(([id, cursor]) => (
          <RemoteCursor
            key={id}
            cursor={cursor}
            anchorWidth={anchorSize.w}
            anchorHeight={anchorSize.h}
          />
        ))}
      </div>

      {/* Header strip: code + collab avatars + read-only badge */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {isEdit && unit?.code ? (
          <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
            <span className="font-medium text-muted-foreground">Code</span>
            <span className="font-mono">{unit.code}</span>
            <span className="text-muted-foreground/70">
              — auto-generated from your Numbering format
            </span>
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          <CollabAvatars peers={presence} />
          {!canEdit && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              <LockKeyhole className="size-3" />
              Read-only
            </span>
          )}
        </div>
      </div>

      <fieldset disabled={!canEdit || pending} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="u-name" className="text-sm">
              Name
            </Label>
            <div className="relative">
              <Input
                id="u-name"
                value={state.name}
                onChange={(e) => setField("name", e.target.value)}
                onFocus={() => focusField("name")}
                onBlur={() => blurField("name")}
                placeholder="Kilogram"
                maxLength={60}
                required
              />
              <FieldEditingIndicator peer={fieldEditors.name} />
            </div>
            <FieldError messages={fieldErrors.name} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="u-symbol" className="text-sm">
              Symbol
            </Label>
            <div className="relative">
              <Input
                id="u-symbol"
                value={state.symbol}
                onChange={(e) => setField("symbol", e.target.value)}
                onFocus={() => focusField("symbol")}
                onBlur={() => blurField("symbol")}
                placeholder="kg"
                maxLength={12}
                className="font-mono"
                required
              />
              <FieldEditingIndicator peer={fieldEditors.symbol} />
            </div>
            <FieldError messages={fieldErrors.symbol} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Dimension</Label>
            <div className="relative">
              <Select
                value={state.dimension}
                onValueChange={(v) => setField("dimension", v as UnitDimension)}
              >
                <SelectTrigger
                  onFocus={() => focusField("dimension")}
                  onBlur={() => blurField("dimension")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIMENSION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldEditingIndicator peer={fieldEditors.dimension} />
            </div>
            <p className="text-xs text-muted-foreground">
              Conversion only works within the same dimension.
            </p>
            <FieldError messages={fieldErrors.dimension} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="u-factor" className="text-sm">
              Factor to base unit
            </Label>
            <div className="relative">
              <Input
                id="u-factor"
                type="text"
                inputMode="decimal"
                value={state.factor_to_base}
                onChange={(e) => setField("factor_to_base", e.target.value)}
                onFocus={() => focusField("factor_to_base")}
                onBlur={() => blurField("factor_to_base")}
                placeholder="0.001"
                className="font-mono"
                required
                disabled={state.is_base}
              />
              <FieldEditingIndicator peer={fieldEditors.factor_to_base} />
            </div>
            <p className="text-xs text-muted-foreground">
              1 {state.symbol || "this unit"} = factor × base. E.g. 1&nbsp;g =
              0.001&nbsp;kg.
            </p>
            <FieldError messages={fieldErrors.factor_to_base} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="relative flex items-start gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm">
            <Checkbox
              checked={state.is_base}
              onCheckedChange={(c) => onToggleBase(Boolean(c))}
            />
            <span className="flex-1">
              <span className="font-medium">Base unit for this dimension</span>
              <span className="block text-xs text-muted-foreground">
                Factor is locked to 1. Only one base per dimension.
              </span>
            </span>
            <FieldEditingIndicator peer={fieldEditors.is_base} />
          </label>

          <label className="relative flex items-start gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm">
            <Checkbox
              checked={state.is_active}
              onCheckedChange={(c) => setField("is_active", Boolean(c))}
            />
            <span className="flex-1">
              <span className="font-medium">Active</span>
              <span className="block text-xs text-muted-foreground">
                Inactive units stay in history but disappear from pickers.
              </span>
            </span>
            <FieldEditingIndicator peer={fieldEditors.is_active} />
          </label>
        </div>
      </fieldset>

      {actionError && (
        <ErrorBanner
          detail={actionError.detail}
          code={actionError.code}
          debug={actionError.debug}
        />
      )}

      {canEdit && !isCreator && creator && (
        <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Only{" "}
            <span className="font-medium text-foreground">{creator.name}</span>{" "}
            can {isEdit ? "save" : "create"} from this room. Your edits sync to
            them live.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {isEdit && canEdit && isCreator ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={pending}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1.5 size-3.5" />
            Delete unit
          </Button>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
          {/* Discard is creator-only — otherwise a non-creator would
              reset their local view while the room still sees the
              in-progress edits, immediately desyncing. */}
          {dirty && !pending && isCreator && (
            <Button type="button" variant="ghost" onClick={onReset}>
              Discard
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/settings/units-of-measurement")}
          >
            Cancel
          </Button>
          {canEdit && (
            <Button
              type="submit"
              disabled={
                !dirty ||
                pending ||
                !isCreator ||
                !state.name.trim() ||
                !state.symbol.trim() ||
                !state.factor_to_base.trim()
              }
              title={
                isCreator
                  ? undefined
                  : creator
                    ? `Only ${creator.name} can ${isEdit ? "save" : "create"} from this room.`
                    : undefined
              }
            >
              {pending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 size-4" />
              )}
              {isEdit ? "Save changes" : "Create unit"}
            </Button>
          )}
        </div>
      </div>
    </form>
    </div>
  );
}

function JoinErrorCard({
  error,
  isEdit,
}: {
  error: JoinError;
  isEdit: boolean;
}) {
  const config = {
    form_full: {
      icon: AlertCircle,
      title: "Form is at capacity",
      detail: error.limit
        ? `Up to ${error.limit} people can edit this form at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      title: "You can't edit here",
      detail: "Ask an admin for the `units.manage` permission to join this form.",
    },
    bad_topic: {
      icon: AlertCircle,
      title: "Unknown form",
      detail: "Couldn't recognise this form's address — try reloading.",
    },
    unknown: {
      icon: AlertCircle,
      title: "Couldn't join",
      detail: "The realtime connection refused this form. Try reloading.",
    },
  }[error.reason] ?? {
    icon: AlertCircle,
    title: "Couldn't join",
    detail: "The realtime connection refused this form. Try reloading.",
  };
  const Icon = config.icon;
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-background p-5">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">{config.title}</p>
          <p className="text-xs text-muted-foreground">{config.detail}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {isEdit
          ? "This unit's edit form is shared in real time."
          : "The new-unit draft form is shared in real time."}
      </p>
    </div>
  );
}
