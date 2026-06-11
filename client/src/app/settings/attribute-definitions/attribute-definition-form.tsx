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
import {
  AlertCircle,
  Loader2,
  Lock,
  LockKeyhole,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  createAttributeDefinitionAction,
  deleteAttributeDefinitionAction,
  updateAttributeDefinitionAction,
} from "@/lib/attribute-definitions/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type {
  AttributeDefinition,
  AttributeEnumChoice,
  AttributeScope,
  AttributeType,
} from "@/lib/types";

interface FormProps {
  attribute: AttributeDefinition | null;
  canEdit: boolean;
}

const SCOPES: Array<{ value: AttributeScope; label: string }> = [
  { value: "raw_material", label: "Raw material" },
  { value: "semi_finished", label: "Semi-finished" },
  { value: "finished_product", label: "Finished product" },
  { value: "packaging", label: "Packaging" },
  { value: "item_any", label: "Any item type" },
];

const TYPES: Array<{ value: AttributeType; label: string; hint: string }> = [
  { value: "text", label: "Text", hint: "Free text input." },
  { value: "number", label: "Number", hint: "Numeric input. Add a unit if relevant." },
  { value: "boolean", label: "Boolean", hint: "Yes / No checkbox." },
  { value: "date", label: "Date", hint: "ISO date picker." },
  { value: "enum", label: "Enum", hint: "One of a set of configured choices." },
  { value: "url", label: "URL", hint: "Must start with http:// or https://." },
];

interface FormState {
  scope: AttributeScope;
  key: string;
  label: string;
  attribute_type: AttributeType;
  enum_choices: AttributeEnumChoice[];
  required: boolean;
  unit_symbol: string;
  help_text: string;
  sort_order: string;
  is_active: boolean;
}

function initialFrom(attr: AttributeDefinition | null): FormState {
  return {
    scope: attr?.scope ?? "raw_material",
    key: attr?.key ?? "",
    label: attr?.label ?? "",
    attribute_type: attr?.attribute_type ?? "text",
    enum_choices: attr?.enum_choices ?? [],
    required: attr?.required ?? false,
    unit_symbol: attr?.unit_symbol ?? "",
    help_text: attr?.help_text ?? "",
    sort_order: attr?.sort_order?.toString() ?? "0",
    is_active: attr?.is_active ?? true,
  };
}

export function AttributeDefinitionForm({ attribute, canEdit }: FormProps) {
  const router = useRouter();
  const isEdit = attribute !== null;
  const resource = attribute
    ? `attribute-definition:${attribute.uuid}`
    : "attribute-definition:new";

  useFormPresenceBeacon(resource);

  type CommitPayload =
    | { kind: "created"; uuid: string; label: string }
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
    disabled: !canEdit,
    initialState: useMemo(() => initialFrom(attribute), [attribute]),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Attribute created", {
          description: `${creator?.name ?? "The host"} just finalised "${msg.label}".`,
        });
        router.push("/settings/attribute-definitions");
      } else if (msg.kind === "saved") {
        toast.success("Saved", {
          description: `${creator?.name ?? "The host"} just saved the attribute.`,
        });
        setOriginal(msg.state);
        resetState(msg.state);
        router.refresh();
      }
    },
  });

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

  useEffect(() => () => hideCursor(), [hideCursor]);

  const onCursorMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = cursorAnchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      setCursor(
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
      );
    },
    [setCursor],
  );

  const [original, setOriginal] = useState<FormState>(() =>
    initialFrom(attribute),
  );
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  // Enum-choice mutations rebuild the array then push the whole field
  // over the wire — choices are an inseparable unit (re-ordering matters
  // for display, and per-row indices would otherwise race between peers).
  function addChoice() {
    setField("enum_choices", [...state.enum_choices, { value: "", label: "" }]);
  }

  function removeChoice(i: number) {
    setField(
      "enum_choices",
      state.enum_choices.filter((_, idx) => idx !== i),
    );
  }

  function setChoice(i: number, patch: Partial<AttributeEnumChoice>) {
    setField(
      "enum_choices",
      state.enum_choices.map((row, idx) =>
        idx === i ? { ...row, ...patch } : row,
      ),
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isCreator) return;
    setActionError(null);
    setFieldErrors({});

    startTransition(async () => {
      const payload = {
        scope: state.scope,
        key: state.key.trim(),
        label: state.label.trim(),
        attribute_type: state.attribute_type,
        enum_choices: state.attribute_type === "enum" ? state.enum_choices : [],
        required: state.required,
        unit_symbol: state.unit_symbol.trim() || null,
        help_text: state.help_text.trim() || null,
        sort_order: Number(state.sort_order) || 0,
        is_active: state.is_active,
      };

      const res = isEdit
        ? await updateAttributeDefinitionAction(attribute!.uuid, payload)
        : await createAttributeDefinitionAction(payload);

      if (!res.ok) {
        setFieldErrors(res.fields ?? {});
        setActionError(res);
        return;
      }

      toast.success(isEdit ? "Attribute updated" : "Attribute created");
      setOriginal(state);

      if (isEdit) {
        broadcastCommit({ kind: "saved", state });
      } else {
        broadcastCommit({
          kind: "created",
          uuid: res.attribute_definition.uuid,
          label: res.attribute_definition.label,
        });
      }
      router.push("/settings/attribute-definitions");
      router.refresh();
    });
  }

  function onReset() {
    resetState(original);
    setActionError(null);
    setFieldErrors({});
  }

  function onDelete() {
    if (!attribute) return;
    if (
      !window.confirm(
        `Delete "${attribute.label}"? Items currently storing values for this attribute will keep them on items.attributes but they will no longer render in the form.`,
      )
    ) {
      return;
    }
    setActionError(null);
    startTransition(async () => {
      const res = await deleteAttributeDefinitionAction(attribute.uuid);
      if (!res.ok) {
        setActionError(res);
        return;
      }
      toast.success("Attribute removed");
      router.push("/settings/attribute-definitions");
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

      <form onSubmit={onSubmit} className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {isEdit && attribute?.code ? (
            <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
              <span className="font-medium text-muted-foreground">Code</span>
              <span className="font-mono">{attribute.code}</span>
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
              <Label className="text-sm">Scope</Label>
              <div className="relative">
                <Select
                  value={state.scope}
                  onValueChange={(v) => setField("scope", v as AttributeScope)}
                >
                  <SelectTrigger
                    id="scope"
                    onFocus={() => focusField("scope")}
                    onBlur={() => blurField("scope")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldEditingIndicator peer={fieldEditors.scope} />
              </div>
              <p className="text-xs text-muted-foreground">
                Determines which item type the field renders on.
              </p>
              <FieldError messages={fieldErrors.scope} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Type</Label>
              <div className="relative">
                <Select
                  value={state.attribute_type}
                  onValueChange={(v) =>
                    setField("attribute_type", v as AttributeType)
                  }
                >
                  <SelectTrigger
                    id="attribute_type"
                    onFocus={() => focusField("attribute_type")}
                    onBlur={() => blurField("attribute_type")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        <div className="flex flex-col">
                          <span>{t.label}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {t.hint}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldEditingIndicator peer={fieldEditors.attribute_type} />
              </div>
              <FieldError messages={fieldErrors.attribute_type} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ad-key" className="text-sm">
                Key (machine identifier)
              </Label>
              <div className="relative">
                <Input
                  id="ad-key"
                  value={state.key}
                  onChange={(e) => setField("key", e.target.value)}
                  onFocus={() => focusField("key")}
                  onBlur={() => blurField("key")}
                  placeholder="cas_number, country_of_origin…"
                  maxLength={60}
                  className="font-mono"
                  required
                  disabled={isEdit}
                />
                <FieldEditingIndicator peer={fieldEditors.key} />
              </div>
              <p className="text-xs text-muted-foreground">
                Lowercase letters / digits / underscores. Immutable once set.
              </p>
              <FieldError messages={fieldErrors.key} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ad-label" className="text-sm">
                Label
              </Label>
              <div className="relative">
                <Input
                  id="ad-label"
                  value={state.label}
                  onChange={(e) => setField("label", e.target.value)}
                  onFocus={() => focusField("label")}
                  onBlur={() => blurField("label")}
                  placeholder="CAS number"
                  maxLength={80}
                  required
                />
                <FieldEditingIndicator peer={fieldEditors.label} />
              </div>
              <FieldError messages={fieldErrors.label} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ad-unit" className="text-sm">
                Unit symbol (optional)
              </Label>
              <div className="relative">
                <Input
                  id="ad-unit"
                  value={state.unit_symbol}
                  onChange={(e) => setField("unit_symbol", e.target.value)}
                  onFocus={() => focusField("unit_symbol")}
                  onBlur={() => blurField("unit_symbol")}
                  placeholder="kg, mL, %, …"
                  maxLength={12}
                  className="font-mono"
                />
                <FieldEditingIndicator peer={fieldEditors.unit_symbol} />
              </div>
              <FieldError messages={fieldErrors.unit_symbol} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ad-order" className="text-sm">
                Sort order
              </Label>
              <div className="relative">
                <Input
                  id="ad-order"
                  type="number"
                  inputMode="numeric"
                  value={state.sort_order}
                  onChange={(e) => setField("sort_order", e.target.value)}
                  onFocus={() => focusField("sort_order")}
                  onBlur={() => blurField("sort_order")}
                />
                <FieldEditingIndicator peer={fieldEditors.sort_order} />
              </div>
              <p className="text-xs text-muted-foreground">
                Lower numbers appear higher in the item form.
              </p>
              <FieldError messages={fieldErrors.sort_order} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ad-help" className="text-sm">
              Help text (optional)
            </Label>
            <div className="relative">
              <Textarea
                id="ad-help"
                value={state.help_text}
                onChange={(e) => setField("help_text", e.target.value)}
                onFocus={() => focusField("help_text")}
                onBlur={() => blurField("help_text")}
                rows={2}
                placeholder="One-line hint shown under the field on the item form."
              />
              <FieldEditingIndicator peer={fieldEditors.help_text} />
            </div>
            <FieldError messages={fieldErrors.help_text} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="relative flex items-start gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm">
              <Checkbox
                checked={state.required}
                onCheckedChange={(c) => setField("required", Boolean(c))}
              />
              <span className="flex-1">
                <span className="font-medium">Required</span>
                <span className="block text-xs text-muted-foreground">
                  Items in this scope can&apos;t save without a value.
                </span>
              </span>
              <FieldEditingIndicator peer={fieldEditors.required} />
            </label>

            <label className="relative flex items-start gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm">
              <Checkbox
                checked={state.is_active}
                onCheckedChange={(c) => setField("is_active", Boolean(c))}
              />
              <span className="flex-1">
                <span className="font-medium">Active</span>
                <span className="block text-xs text-muted-foreground">
                  Inactive attributes vanish from the item form but values
                  already saved on items are preserved.
                </span>
              </span>
              <FieldEditingIndicator peer={fieldEditors.is_active} />
            </label>
          </div>

          {state.attribute_type === "enum" && (
            <div className="relative space-y-3 rounded-md border border-border/40 bg-muted/10 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Enum choices</h3>
                  <p className="text-xs text-muted-foreground">
                    Each choice has a stored value + display label.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addChoice}
                >
                  <Plus className="mr-1 size-3.5" />
                  Add choice
                </Button>
              </div>
              {state.enum_choices.length === 0 && (
                <p className="rounded-md border border-dashed border-border/60 py-4 text-center text-xs text-muted-foreground">
                  No choices yet — add at least one.
                </p>
              )}
              {state.enum_choices.map((c, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"
                >
                  <Input
                    value={c.value}
                    onChange={(e) => setChoice(i, { value: e.target.value })}
                    onFocus={() => focusField("enum_choices")}
                    onBlur={() => blurField("enum_choices")}
                    placeholder="stored-value"
                    className="font-mono"
                  />
                  <Input
                    value={c.label}
                    onChange={(e) => setChoice(i, { label: e.target.value })}
                    onFocus={() => focusField("enum_choices")}
                    onBlur={() => blurField("enum_choices")}
                    placeholder="Display label"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeChoice(i)}
                    className="text-destructive hover:text-destructive"
                    aria-label="Remove choice"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
              <FieldEditingIndicator peer={fieldEditors.enum_choices} />
              <FieldError messages={fieldErrors.enum_choices} />
            </div>
          )}
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
              <span className="font-medium text-foreground">
                {creator.name}
              </span>{" "}
              can {isEdit ? "save" : "create"} from this room. Your edits sync
              to them live.
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
              Delete attribute
            </Button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            {dirty && !pending && isCreator && (
              <Button type="button" variant="ghost" onClick={onReset}>
                Discard
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/settings/attribute-definitions")}
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
                  !state.key.trim() ||
                  !state.label.trim()
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
                {isEdit ? "Save changes" : "Create attribute"}
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
        ? `Up to ${error.limit} people can edit this attribute at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      title: "You can't edit here",
      detail:
        "Ask an admin for the `attribute_definitions.manage` permission to join this form.",
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
          ? "This attribute's edit form is shared in real time."
          : "The new-attribute draft form is shared in real time."}
      </p>
    </div>
  );
}
