"use client";

/**
 * Loyalty-program HEADER form. Canonical realtime-collab pattern
 * (mirrors warehouse-form.tsx): useLiveForm + presence beacon +
 * remote cursors + per-field editing indicators + head-of-room save
 * gate. Tier editing and lifecycle controls live in separate cards
 * on the detail page; this form owns name + description.
 *
 * Scheme / basis / payout are V1-locked to a single option. We render
 * them as disabled inputs so the operator sees the contract — the
 * enum has room for more values once we ship them.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Loader2,
  Lock,
  LockKeyhole,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldError } from "@/components/forms/field-error";
import { ErrorBanner } from "@/components/forms/error-banner";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { cn } from "@/lib/utils";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import type { LoyaltyProgram } from "@/lib/types";
import type { FieldErrors } from "@/lib/auth/actions";
import type { ErrorResult } from "@/lib/errors/server";
import {
  updateLoyaltyProgramAction,
  type LoyaltyProgramInput,
} from "@/lib/loyalty/actions";
import { invalidateAudit, subscribeRestore } from "@/lib/audit/invalidator";

interface FormState {
  name: string;
  description: string;
}

interface Props {
  program: LoyaltyProgram;
  canEdit: boolean;
  onSavedSuccess?: () => void;
}

function initialFrom(p: LoyaltyProgram): FormState {
  return {
    name: p.name,
    description: p.description ?? "",
  };
}

export function LoyaltyProgramForm({
  program,
  canEdit,
  onSavedSuccess,
}: Props) {
  const resource = `loyalty-program:${program.uuid}`;
  useFormPresenceBeacon(resource);

  type CommitPayload = { kind: "saved"; state: FormState };

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
    initialState: useMemo(() => initialFrom(program), [program]),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg || msg.kind !== "saved") return;
      toast.success("Saved", {
        description: `${creator?.name ?? "The host"} just saved the form.`,
      });
      setOriginal(msg.state);
      resetState(msg.state);
      invalidateAudit("loyalty_program", program.id);
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

  useEffect(() => {
    return subscribeRestore("loyalty_program", program.id, (raw) => {
      const r = raw as Partial<LoyaltyProgram> & Record<string, unknown>;
      const restored: FormState = {
        name: typeof r.name === "string" ? r.name : "",
        description: typeof r.description === "string" ? r.description : "",
      };
      resetState(restored);
    });
  }, [program.id, resetState]);

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

  const [original, setOriginal] = useState<FormState>(() => initialFrom(program));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setActionError(null);

    const payload: LoyaltyProgramInput = {
      name: state.name.trim(),
      description: state.description.trim() || null,
    };

    startTransition(async () => {
      const res = await updateLoyaltyProgramAction(program.uuid, payload);
      if (res.ok) {
        toast.success("Saved");
        setOriginal(state);
        invalidateAudit("loyalty_program", res.loyalty_program.id);
        broadcastCommit({ kind: "saved", state });
        onSavedSuccess?.();
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
            <CardTitle>Program header</CardTitle>
            <CardDescription>
              Name + description. The scheme, basis, and payout type are
              locked for V1 — more options ship later.
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
            <div className="space-y-4">
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
              <CollabTextareaRow
                id="description"
                label="Description"
                value={state.description}
                onChange={(v) => setField("description", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.description}
                errors={fieldErrors.description}
              />
            </div>

            <div className="space-y-4 rounded-md border border-border/60 bg-muted/30 p-4">
              <SectionTitle>Scheme (locked)</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-3">
                <LockedRow label="Scheme" value="Tiered rebate" />
                <LockedRow label="Basis" value="YTD revenue" />
                <LockedRow label="Payout" value="Credit balance" />
              </div>
              <p className="text-[11px] text-muted-foreground">
                These enums have room to grow — the BE schema accepts more
                values once the upstream workflows ship. For now V1 only
                supports the combination shown.
              </p>
            </div>

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
                      can save from this room. Your edits sync to them
                      live.
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
                    title={
                      isCreator
                        ? undefined
                        : creator
                          ? `Only ${creator.name} can save from this room.`
                          : undefined
                    }
                  >
                    {pending && (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    )}
                    Save changes
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

// -- supporting components ---------------------------------------

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
        "Ask an admin for the `loyalty.programs_manage` permission to join this form.",
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function LockedRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Input value={value} disabled className="h-10 font-mono" />
    </div>
  );
}

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
}: CollabRowProps) {
  const hasError = Boolean(errors && errors.length > 0);
  return (
    <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
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
              hasError &&
                "border-destructive focus-visible:ring-destructive/20",
            )}
          />
          <FieldEditingIndicator peer={editor} />
        </div>
        <FieldError messages={errors} />
      </div>
    </div>
  );
}

interface CollabTextareaRowProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus: (field: string) => void;
  onBlur: (field: string) => void;
  editor: import("@/lib/realtime/use-live-form").CollabPeer | null;
  errors?: string[];
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
}: CollabTextareaRowProps) {
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
              hasError &&
                "border-destructive focus-visible:ring-destructive/20",
            )}
          />
          <FieldEditingIndicator peer={editor} />
        </div>
        <FieldError messages={errors} />
      </div>
    </div>
  );
}
