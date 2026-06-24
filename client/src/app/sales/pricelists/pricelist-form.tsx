"use client";

/**
 * Pricelist edit form — full realtime collab. The header carries
 * name + currency + active flag + validity window; below that lives
 * a line-item editor where each row is one tier (item × min-qty →
 * selling price). Multiple rows per item ARE allowed, that's how
 * volume pricing works.
 *
 * Lines write through their own server actions (add / update /
 * remove) rather than being part of the header form save. Saves on
 * the header propagate via the collab channel; line edits propagate
 * via the standard router.refresh() because they're high-cardinality
 * and per-row mutability is enough.
 */

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Loader2,
  Lock,
  LockKeyhole,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge-mini";
import { FieldError } from "@/components/forms/field-error";
import { ErrorBanner } from "@/components/forms/error-banner";
import { CurrencyPicker } from "@/components/forms/currency-picker";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import type { ErrorResult } from "@/lib/errors/server";
import { cn } from "@/lib/utils";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import type { CompanyDefaults, Pricelist } from "@/lib/types";
import type { FieldErrors } from "@/lib/auth/actions";
import {
  createPricelistAction,
  setDefaultPricelistAction,
  updatePricelistAction,
  type PricelistInput,
} from "@/lib/pricelists/actions";
import { invalidateAudit, subscribeRestore } from "@/lib/audit/invalidator";

interface Props {
  pricelist: Pricelist | null;
  company: CompanyDefaults;
  canEdit: boolean;
  onSavedSuccess?: () => void;
}

interface FormState {
  name: string;
  currency_code: string;
  is_active: boolean;
  valid_from: string;
  valid_until: string;
  notes: string;
}

function initialFrom(p: Pricelist | null, company: CompanyDefaults): FormState {
  if (!p) {
    return {
      name: "",
      currency_code: company.currency_code,
      is_active: true,
      valid_from: "",
      valid_until: "",
      notes: "",
    };
  }
  return {
    name: p.name,
    currency_code: p.currency_code,
    is_active: p.is_active,
    valid_from: p.valid_from ?? "",
    valid_until: p.valid_until ?? "",
    notes: p.notes ?? "",
  };
}

export function PricelistForm({
  pricelist,
  company,
  canEdit,
  onSavedSuccess,
}: Props) {
  const router = useRouter();
  const resource = pricelist ? `pricelist:${pricelist.uuid}` : "pricelist:new";

  useFormPresenceBeacon(resource);

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
    disabled: !canEdit,
    initialState: useMemo(
      () => initialFrom(pricelist, company),
      [pricelist, company],
    ),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Pricelist created", {
          description: `${creator?.name ?? "The host"} just finalized "${msg.name}".`,
        });
        router.push(`/sales/pricelists/${msg.uuid}`);
      } else if (msg.kind === "saved") {
        toast.success("Saved");
        setOriginal(msg.state);
        resetState(msg.state);
        if (pricelist) invalidateAudit("pricelist", pricelist.id);
      }
    },
  });

  // Cursor anchor
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

  useEffect(() => {
    if (!pricelist) return;
    return subscribeRestore("pricelist", pricelist.id, (raw) => {
      const r = raw as Partial<Pricelist> & Record<string, unknown>;
      resetState({
        name: typeof r.name === "string" ? r.name : "",
        currency_code:
          typeof r.currency_code === "string" ? r.currency_code : company.currency_code,
        is_active: r.is_active !== false,
        valid_from: typeof r.valid_from === "string" ? r.valid_from : "",
        valid_until: typeof r.valid_until === "string" ? r.valid_until : "",
        notes: typeof r.notes === "string" ? r.notes : "",
      });
    });
  }, [pricelist, resetState, company.currency_code]);

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

  const [original, setOriginal] = useState<FormState>(() =>
    initialFrom(pricelist, company),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setActionError(null);

    const payload: PricelistInput = {
      name: state.name.trim(),
      currency_code: state.currency_code,
      is_active: state.is_active,
      valid_from: state.valid_from || null,
      valid_until: state.valid_until || null,
      notes: state.notes.trim() || null,
    };

    startTransition(async () => {
      const res = pricelist
        ? await updatePricelistAction(pricelist.uuid, payload)
        : await createPricelistAction(payload);

      if (res.ok) {
        toast.success(pricelist ? "Pricelist saved" : "Pricelist created");
        setOriginal(state);
        invalidateAudit("pricelist", res.pricelist.id);

        if (pricelist) {
          broadcastCommit({ kind: "saved", state });
          onSavedSuccess?.();
        } else {
          broadcastCommit({
            kind: "created",
            uuid: res.pricelist.uuid,
            name: res.pricelist.name,
          });
          router.push(`/sales/pricelists/${res.pricelist.uuid}`);
        }
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  function onReset() {
    resetState(original);
    setFieldErrors({});
    setActionError(null);
  }

  function onSetDefault() {
    if (!pricelist) return;
    startTransition(async () => {
      const res = await setDefaultPricelistAction(pricelist.uuid);
      if (res.ok) {
        toast.success("Default pricelist set");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  if (joinError) {
    return <JoinErrorCard error={joinError} />;
  }

  return (
    <Card
      ref={cursorAnchorRef}
      onMouseMove={onCursorMove}
      onMouseLeave={hideCursor}
      className="relative border-border/60"
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

      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">
              {pricelist ? "Pricelist details" : "New pricelist"}
            </CardTitle>
            <CardDescription>
              Name, currency, validity window. Save = live; every change
              lands in the audit log. Line items are managed in the card
              below.
            </CardDescription>
          </div>
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
      </CardHeader>

      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <form onSubmit={onSubmit} noValidate className="space-y-6">
            {/* Header fields */}
            <div className="grid gap-4 lg:grid-cols-2">
              <CollabRow
                id="name"
                label="Name"
                required
                value={state.name}
                onChange={(v) => setField("name", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.name}
                errors={fieldErrors.name}
              />

              <PickerRow
                id="currency_code"
                label="Currency"
                editor={fieldEditors.currency_code}
                errors={fieldErrors.currency_code}
              >
                <CurrencyPicker
                  id="currency_code"
                  value={state.currency_code}
                  onChange={(v) =>
                    setField("currency_code", v ?? company.currency_code)
                  }
                  onFocus={() => focusField("currency_code")}
                  onBlur={() => blurField("currency_code")}
                />
              </PickerRow>

              <FieldRow
                id="valid_from"
                label="Valid from"
                editor={fieldEditors.valid_from}
                errors={fieldErrors.valid_from}
              >
                <Input
                  id="valid_from"
                  type="date"
                  value={state.valid_from}
                  onChange={(e) => setField("valid_from", e.target.value)}
                  onFocus={() => focusField("valid_from")}
                  onBlur={() => blurField("valid_from")}
                  className="h-11"
                />
              </FieldRow>

              <FieldRow
                id="valid_until"
                label="Valid until"
                editor={fieldEditors.valid_until}
                errors={fieldErrors.valid_until}
              >
                <Input
                  id="valid_until"
                  type="date"
                  value={state.valid_until}
                  onChange={(e) => setField("valid_until", e.target.value)}
                  onFocus={() => focusField("valid_until")}
                  onBlur={() => blurField("valid_until")}
                  className="h-11"
                />
              </FieldRow>
            </div>

            <CollabTextareaRow
              id="notes"
              label="Notes"
              value={state.notes}
              onChange={(v) => setField("notes", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors.notes}
              errors={fieldErrors.notes}
            />

            <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
              <Label className="pt-1.5 text-sm font-medium">Active</Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={state.is_active}
                  onCheckedChange={(v) => setField("is_active", v)}
                  aria-label="Pricelist is active"
                />
                <span className="text-sm text-muted-foreground">
                  {state.is_active
                    ? "Active — visible in customer pickers + future CO line forms"
                    : "Inactive — hidden from selectors and lookups"}
                </span>
              </div>
            </div>

            {pricelist && !pricelist.is_default && canEdit && (
              <div className="rounded-md border border-border/40 bg-muted/30 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium">Default pricelist</p>
                    <p className="text-[11px] text-muted-foreground">
                      Used as fallback when a customer has no pricelist.
                      Only one default per company.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onSetDefault}
                    disabled={pending}
                  >
                    <Star className="mr-1.5 size-3.5" />
                    Set as default
                  </Button>
                </div>
              </div>
            )}

            {actionError && (
              <ErrorBanner
                detail={actionError.detail}
                code={actionError.code}
                debug={actionError.debug}
              />
            )}

            {canEdit && (
              <>
                {!isCreator && creator && (
                  <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                    <Lock className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Only{" "}
                      <span className="font-medium text-foreground">
                        {creator.name}
                      </span>{" "}
                      can {pricelist ? "save" : "create"} from this room.
                      Your edits sync to them live.
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
                  {dirty && !pending && isCreator && (
                    <Button type="button" variant="ghost" onClick={onReset}>
                      Discard
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={!dirty || pending || !isCreator}
                  >
                    {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                    {pricelist ? "Save changes" : "Create pricelist"}
                  </Button>
                </div>
              </>
            )}
          </form>
        </fieldset>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Field-row helpers (same shape as customer-form)
// ============================================================

interface CollabRowProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus: (field: string) => void;
  onBlur: (field: string) => void;
  editor: import("@/lib/realtime/use-live-form").CollabPeer | null;
  errors?: string[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
}

function CollabRow({
  id,
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  editor,
  errors,
  required,
  placeholder,
  hint,
}: CollabRowProps) {
  const hasError = Boolean(errors && errors.length > 0);
  return (
    <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
      <Label htmlFor={id} className="pt-2.5 text-sm font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <div className="space-y-1.5">
        <div className="relative">
          <Input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => onFocus(id)}
            onBlur={() => onBlur(id)}
            required={required}
            placeholder={placeholder}
            aria-invalid={hasError}
            className={cn(
              "h-11",
              hasError && "border-destructive focus-visible:ring-destructive/20",
            )}
          />
          <FieldEditingIndicator peer={editor} />
        </div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        <FieldError messages={errors} />
      </div>
    </div>
  );
}

function CollabTextareaRow({
  id,
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  editor,
  errors,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus: (field: string) => void;
  onBlur: (field: string) => void;
  editor: import("@/lib/realtime/use-live-form").CollabPeer | null;
  errors?: string[];
}) {
  const hasError = Boolean(errors && errors.length > 0);
  return (
    <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
      <Label htmlFor={id} className="pt-2.5 text-sm font-medium">
        {label}
      </Label>
      <div className="space-y-1.5">
        <div className="relative">
          <Textarea
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => onFocus(id)}
            onBlur={() => onBlur(id)}
            rows={3}
            aria-invalid={hasError}
            className={cn(
              hasError && "border-destructive focus-visible:ring-destructive/20",
            )}
          />
          <FieldEditingIndicator peer={editor} />
        </div>
        <FieldError messages={errors} />
      </div>
    </div>
  );
}

function PickerRow({
  id,
  label,
  editor,
  errors,
  children,
}: {
  id: string;
  label: string;
  editor: import("@/lib/realtime/use-live-form").CollabPeer | null;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
      <Label htmlFor={id} className="pt-2.5 text-sm font-medium">
        {label}
      </Label>
      <div className="space-y-1.5">
        <div className="relative">
          {children}
          <FieldEditingIndicator peer={editor} />
        </div>
        <FieldError messages={errors} />
      </div>
    </div>
  );
}

function FieldRow({
  id,
  label,
  editor,
  errors,
  children,
}: {
  id: string;
  label: string;
  editor: import("@/lib/realtime/use-live-form").CollabPeer | null;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
      <Label htmlFor={id} className="pt-2.5 text-sm font-medium">
        {label}
      </Label>
      <div className="space-y-1.5">
        <div className="relative">
          {children}
          <FieldEditingIndicator peer={editor} />
        </div>
        <FieldError messages={errors} />
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
      tone: "amber",
      title: "Form is at capacity",
      detail: error.limit
        ? `Up to ${error.limit} people can edit this form at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      tone: "muted",
      title: "You can't edit here",
      detail:
        "Ask an admin for the `pricelists.edit` permission to join this form.",
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
