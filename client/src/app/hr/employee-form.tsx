"use client";

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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldError } from "@/components/forms/field-error";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorResult } from "@/lib/errors/server";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { cn } from "@/lib/utils";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import type { FieldErrors } from "@/lib/auth/actions";
import type { HREmployee, HREmployeeUpsertInput } from "@/lib/hr/types";
import {
  createHREmployeeAction,
  updateHREmployeeAction,
} from "@/lib/hr/actions";
import { invalidateAudit, subscribeRestore } from "@/lib/audit/invalidator";

interface EmployeeFormProps {
  /** `null` ⇒ create mode; otherwise edit. */
  employee: HREmployee | null;
  canEdit: boolean;
  /** Fired on save so an outer `EditModeToggle` wrapper (if any) can
   *  flip back to view mode. */
  onSavedSuccess?: () => void;
}

/**
 * FormState mirrors the persisted employee columns 1:1. Booleans stay
 * false / true (no null-tri-state), string inputs collapse `null` to
 * `""` so React's controlled-component invariants hold, and the
 * `kiosk_pin` field lives here as an in-memory-only override —
 * server bcrypts + wipes so we don't have to.
 */
interface FormState {
  full_name: string;
  preferred_name: string;
  email: string;
  phone: string;
  hire_date: string;
  external_id: string;
  employee_number: string;
  is_active: boolean;
  is_qa: boolean;
  /** New PIN. `""` = leave existing PIN alone; anything else is
   *  rotated on save. Not broadcast to peers — it's a secret. */
  kiosk_pin: string;
}

function initialFrom(employee: HREmployee | null): FormState {
  if (!employee) {
    return {
      full_name: "",
      preferred_name: "",
      email: "",
      phone: "",
      hire_date: "",
      external_id: "",
      employee_number: "",
      is_active: true,
      is_qa: false,
      kiosk_pin: "",
    };
  }
  return {
    full_name: employee.full_name,
    preferred_name: employee.preferred_name ?? "",
    email: employee.email ?? "",
    phone: employee.phone ?? "",
    hire_date: employee.hire_date ?? "",
    external_id: employee.external_id ?? "",
    employee_number: employee.employee_number ?? "",
    is_active: employee.is_active,
    is_qa: employee.is_qa,
    kiosk_pin: "",
  };
}

export function EmployeeForm({
  employee,
  canEdit,
  onSavedSuccess,
}: EmployeeFormProps) {
  const router = useRouter();
  const resource = employee ? `hr-employee:${employee.uuid}` : "hr-employee:new";
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
    initialState: useMemo(() => initialFrom(employee), [employee]),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Employee created", {
          description: `${creator?.name ?? "The host"} just finalized "${msg.name}".`,
        });
        router.push(`/hr/employees/${msg.uuid}`);
      } else if (msg.kind === "saved") {
        toast.success("Saved", {
          description: `${creator?.name ?? "The host"} just saved the form.`,
        });
        // Never sync a rotated PIN across the room — the peer's local
        // input stays empty ("no rotation on next save").
        const withoutPin: FormState = { ...msg.state, kiosk_pin: "" };
        setOriginal(withoutPin);
        resetState(withoutPin);
        if (employee) invalidateAudit("hr_employee", employee.id);
      }
    },
  });

  // Live-cursor anchor scaffold — same shape as the warehouse form so
  // the coordinate space is identical across surfaces.
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

  useEffect(() => {
    return () => hideCursor();
  }, [hideCursor]);

  useEffect(() => {
    if (!employee) return;
    return subscribeRestore("hr_employee", employee.id, (raw) => {
      const r = raw as Partial<HREmployee> & Record<string, unknown>;
      const restored: FormState = {
        full_name: typeof r.full_name === "string" ? r.full_name : "",
        preferred_name:
          typeof r.preferred_name === "string" ? r.preferred_name : "",
        email: typeof r.email === "string" ? r.email : "",
        phone: typeof r.phone === "string" ? r.phone : "",
        hire_date: typeof r.hire_date === "string" ? r.hire_date : "",
        external_id: typeof r.external_id === "string" ? r.external_id : "",
        employee_number:
          typeof r.employee_number === "string" ? r.employee_number : "",
        is_active: r.is_active !== false,
        is_qa: r.is_qa === true,
        kiosk_pin: "",
      };
      resetState(restored);
    });
  }, [employee, resetState]);

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
    initialFrom(employee),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setActionError(null);

    const payload: HREmployeeUpsertInput = {
      full_name: state.full_name.trim(),
      preferred_name: state.preferred_name || null,
      email: state.email || null,
      phone: state.phone || null,
      hire_date: state.hire_date || null,
      external_id: state.external_id || null,
      employee_number: state.employee_number || null,
      is_active: state.is_active,
      is_qa: state.is_qa,
    };

    // Only include a PIN when the operator actually typed one. Empty
    // string means "leave the existing hash alone".
    if (state.kiosk_pin.trim() !== "") {
      payload.kiosk_pin = state.kiosk_pin.trim();
    }

    startTransition(async () => {
      const res = employee
        ? await updateHREmployeeAction(employee.uuid, payload)
        : await createHREmployeeAction(payload);

      if (res.ok) {
        toast.success(employee ? "Employee saved" : "Employee created");
        // After a successful save the PIN input clears so a stale
        // buffer doesn't get re-sent on the next save.
        const cleared: FormState = { ...state, kiosk_pin: "" };
        setOriginal(cleared);
        resetState(cleared);
        invalidateAudit("hr_employee", res.employee.id);

        if (employee) {
          broadcastCommit({ kind: "saved", state: cleared });
          onSavedSuccess?.();
        } else {
          broadcastCommit({
            kind: "created",
            uuid: res.employee.uuid,
            name: res.employee.full_name,
          });
          router.push(`/hr/employees/${res.employee.uuid}`);
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
            <CardTitle>
              {employee ? employee.full_name : "New employee"}
            </CardTitle>
            <CardDescription>
              Shop-floor master data. Wage history and reputation events
              live on the timeline cards below — this form only carries
              the identity fields.
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
              <SectionTitle>Identity</SectionTitle>

              <CollabRow
                id="full_name"
                label="Full name"
                required
                value={state.full_name}
                onChange={(v) => setField("full_name", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.full_name}
                errors={fieldErrors.full_name}
              />
              <CollabRow
                id="preferred_name"
                label="Preferred name"
                value={state.preferred_name}
                onChange={(v) => setField("preferred_name", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.preferred_name}
                errors={fieldErrors.preferred_name}
                hint="Kiosk greeting + rota shows this."
              />
              <CollabRow
                id="employee_number"
                label="Employee number"
                value={state.employee_number}
                onChange={(v) => setField("employee_number", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.employee_number}
                errors={fieldErrors.employee_number}
                mono
                hint="Optional payroll ID / badge number."
              />
              <CollabRow
                id="external_id"
                label="External ID"
                value={state.external_id}
                onChange={(v) => setField("external_id", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.external_id}
                errors={fieldErrors.external_id}
                mono
                hint="vita-performance UUID or upstream payroll key."
              />
            </div>

            <div className="space-y-4">
              <SectionTitle>Contact</SectionTitle>
              <CollabRow
                id="email"
                label="Email"
                value={state.email}
                onChange={(v) => setField("email", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.email}
                errors={fieldErrors.email}
                type="email"
              />
              <CollabRow
                id="phone"
                label="Phone"
                value={state.phone}
                onChange={(v) => setField("phone", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.phone}
                errors={fieldErrors.phone}
                type="tel"
              />
            </div>

            <div className="space-y-4">
              <SectionTitle>Employment</SectionTitle>

              <CollabRow
                id="hire_date"
                label="Hire date"
                value={state.hire_date}
                onChange={(v) => setField("hire_date", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.hire_date}
                errors={fieldErrors.hire_date}
                type="date"
              />

              <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                <Label className="pt-1.5 text-sm font-medium">Active</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={state.is_active}
                    onCheckedChange={(v) => setField("is_active", v)}
                    aria-label="Employee is active"
                  />
                  <span className="text-sm text-muted-foreground">
                    {state.is_active
                      ? "Active — visible in pickers and rotas"
                      : "Archived — hidden from pickers; historic sessions still resolve"}
                  </span>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                <Label className="pt-1.5 text-sm font-medium">
                  QA sign-off
                </Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={state.is_qa}
                    onCheckedChange={(v) => setField("is_qa", v)}
                    aria-label="Employee can sign off QA verdicts"
                  />
                  <span className="text-sm text-muted-foreground">
                    {state.is_qa
                      ? "May act as quality approver on Goods-In inspections and QC verdicts."
                      : "Regular operator — cannot sign QC verdicts."}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4 rounded-md border border-border/60 bg-muted/30 p-4">
              <SectionTitle>Kiosk PIN</SectionTitle>
              <p className="text-xs text-muted-foreground">
                4–32 characters. Leave blank to keep the existing PIN.{" "}
                {employee?.has_kiosk_pin
                  ? employee?.external_id
                    ? "PIN set (transferred from Vita Performance)."
                    : "A PIN is currently set."
                  : "No PIN set yet."}
              </p>
              <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                <Label
                  htmlFor="kiosk_pin"
                  className="pt-2.5 text-sm font-medium"
                >
                  New PIN
                </Label>
                <div className="space-y-1.5">
                  <div className="relative">
                    <Input
                      id="kiosk_pin"
                      value={state.kiosk_pin}
                      onChange={(e) => setField("kiosk_pin", e.target.value)}
                      onFocus={() => focusField("kiosk_pin")}
                      onBlur={() => blurField("kiosk_pin")}
                      type="password"
                      autoComplete="new-password"
                      inputMode="numeric"
                      placeholder="Leave blank to keep existing"
                      aria-invalid={Boolean(fieldErrors.kiosk_pin)}
                      className={cn(
                        "h-11 font-mono",
                        fieldErrors.kiosk_pin &&
                          "border-destructive focus-visible:ring-destructive/20",
                      )}
                    />
                    <FieldEditingIndicator peer={fieldEditors.kiosk_pin} />
                  </div>
                  <FieldError messages={fieldErrors.kiosk_pin} />
                </div>
              </div>
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
                      can {employee ? "save" : "create"} from this room. Your
                      edits sync to them live.
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
                          ? `Only ${creator.name} can ${employee ? "save" : "create"} from this room.`
                          : undefined
                    }
                  >
                    {pending && (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    )}
                    {employee ? "Save changes" : "Create employee"}
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
      detail: "Ask an admin for the `hr.edit` permission to join this form.",
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
  mono?: boolean;
  type?: React.HTMLInputTypeAttribute;
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
  mono,
  type,
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
            type={type}
            required={required}
            placeholder={placeholder}
            aria-invalid={hasError}
            className={cn(
              "h-11",
              mono && "font-mono",
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

/* Reserved for a future notes surface — kept here to mirror the
 * warehouse form's helper set. Not used today because per-CLAUDE.md
 * discussion drift belongs in the <CommentThread> card, not a
 * single-author textarea. */
export function CollabTextareaRow({
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
