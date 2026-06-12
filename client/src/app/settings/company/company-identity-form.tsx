"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
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
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { cn } from "@/lib/utils";
import { updateCompanyIdentityAction } from "@/lib/company/actions";
import type { Company } from "@/lib/types";
import type { FieldErrors } from "@/lib/auth/actions";
import type { ErrorResult } from "@/lib/errors/server";
import { Loader2, LockKeyhole } from "lucide-react";
import type { CollabPeer } from "@/lib/realtime/use-live-form";
import {
  CreatorLockBanner,
  JoinErrorCard,
  useFormCursorAnchor,
} from "./_realtime";

interface CompanyIdentityFormProps {
  company: Company;
  canEdit: boolean;
}

type FormState = Pick<
  Company,
  | "name"
  | "legal_address"
  | "email"
  | "website"
  | "phone"
  | "registration_number"
  | "tax_number"
  | "tax_rate"
  | "payment_details"
>;

function initialFrom(company: Company): FormState {
  return {
    name: company.name,
    legal_address: company.legal_address ?? "",
    email: company.email ?? "",
    website: company.website ?? "",
    phone: company.phone ?? "",
    registration_number: company.registration_number ?? "",
    tax_number: company.tax_number ?? "",
    tax_rate: company.tax_rate ?? "",
    payment_details: company.payment_details ?? "",
  };
}

// Field-name prefix so focused-field broadcasts don't collide with
// the six sibling forms sharing `form:company:1`.
const P = "identity_";

export function CompanyIdentityForm({
  company,
  canEdit,
}: CompanyIdentityFormProps) {
  useFormPresenceBeacon("company:1");

  const {
    state: form,
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
    resource: "company:1:identity",
    disabled: !canEdit,
    initialState: initialFrom(company),
    onCommit: (raw) => {
      const msg = raw as { kind: "identity:saved"; state: FormState } | null;
      if (!msg || msg.kind !== "identity:saved") return;
      toast.success("Saved", {
        description: `${creator?.name ?? "The host"} just saved company details.`,
      });
      setOriginal(msg.state);
      resetState(msg.state);
    },
  });

  const [original, setOriginal] = useState<FormState>(() => initialFrom(company));
  useEffect(() => {
    setOriginal(initialFrom(company));
  }, [company]);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setField(key, value);
    setFieldErrors((e) => {
      if (!e[String(key)]) return e;
      const { [String(key)]: _omit, ...rest } = e;
      void _omit;
      return rest;
    });
  };

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit || !isCreator) return;
    setFieldErrors({});
    setActionError(null);

    startTransition(async () => {
      const res = await updateCompanyIdentityAction({
        ...form,
        tax_rate: form.tax_rate === "" ? null : form.tax_rate,
      });
      if (res.ok) {
        toast.success("Company details updated");
        setOriginal(form);
        broadcastCommit({ kind: "identity:saved", state: form });
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

  const {
    attach: attachCursor,
    size: cursorSize,
    onMouseMove: onCursorMove,
    onMouseLeave: onCursorLeave,
  } = useFormCursorAnchor(setCursor, hideCursor);

  if (joinError) return <JoinErrorCard error={joinError} />;

  return (
    <Card
      ref={attachCursor}
      onMouseMove={onCursorMove}
      onMouseLeave={onCursorLeave}
      className="relative border-border/60"
    >
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-xl">
        {Object.entries(cursors).map(([id, cursor]) => (
          <RemoteCursor
            key={id}
            cursor={cursor}
            anchorWidth={cursorSize.w}
            anchorHeight={cursorSize.h}
          />
        ))}
      </div>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>General</CardTitle>
            <CardDescription>
              The legal and contact details shown on documents and emails.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <CollabAvatars peers={presence} />
            {!canEdit && <ReadOnlyBadge />}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <Row
              fieldKey="name"
              id={`${P}name`}
              label="Company name"
              required
              value={form.name}
              onChange={(v) => update("name", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}name`]}
              errors={fieldErrors.name}
            />
            <RowTextarea
              fieldKey="legal_address"
              id={`${P}legal_address`}
              label="Legal address"
              value={form.legal_address ?? ""}
              onChange={(v) => update("legal_address", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}legal_address`]}
              errors={fieldErrors.legal_address}
            />
            <Row
              fieldKey="email"
              id={`${P}email`}
              label="E-mail"
              type="email"
              value={form.email ?? ""}
              onChange={(v) => update("email", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}email`]}
              errors={fieldErrors.email}
            />
            <Row
              fieldKey="website"
              id={`${P}website`}
              label="Website"
              type="url"
              value={form.website ?? ""}
              onChange={(v) => update("website", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}website`]}
              errors={fieldErrors.website}
            />
            <Row
              fieldKey="phone"
              id={`${P}phone`}
              label="Phone"
              value={form.phone ?? ""}
              onChange={(v) => update("phone", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}phone`]}
              errors={fieldErrors.phone}
            />
            <Row
              fieldKey="registration_number"
              id={`${P}registration_number`}
              label="Reg. no."
              value={form.registration_number ?? ""}
              onChange={(v) => update("registration_number", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}registration_number`]}
              errors={fieldErrors.registration_number}
            />
            <Row
              fieldKey="tax_number"
              id={`${P}tax_number`}
              label="Tax / VAT number"
              value={form.tax_number ?? ""}
              onChange={(v) => update("tax_number", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}tax_number`]}
              errors={fieldErrors.tax_number}
            />
            <Row
              fieldKey="tax_rate"
              id={`${P}tax_rate`}
              label="Tax rate"
              type="number"
              suffix="%"
              value={form.tax_rate ?? ""}
              onChange={(v) => update("tax_rate", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}tax_rate`]}
              errors={fieldErrors.tax_rate}
            />
            <RowTextarea
              fieldKey="payment_details"
              id={`${P}payment_details`}
              label="Payment details"
              value={form.payment_details ?? ""}
              onChange={(v) => update("payment_details", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}payment_details`]}
              errors={fieldErrors.payment_details}
            />

            {actionError &&
              (!actionError.fields ||
                Object.keys(actionError.fields).length === 0) && (
                <ErrorBanner
                  detail={actionError.detail}
                  code={actionError.code}
                  debug={actionError.debug}
                />
              )}

            {canEdit && (
              <>
                {!isCreator && <CreatorLockBanner creator={creator} />}
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
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
                    {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
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

function ReadOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
      <LockKeyhole className="size-3" />
      Read-only
    </span>
  );
}

interface RowProps {
  fieldKey: keyof FormState;
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  onFocus: (field: string) => void;
  onBlur: (field: string) => void;
  editor: CollabPeer | null;
  errors?: string[];
  required?: boolean;
  suffix?: string;
}

function Row({
  id,
  label,
  type = "text",
  value,
  onChange,
  onFocus,
  onBlur,
  editor,
  errors,
  required,
  suffix,
}: RowProps) {
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
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => onFocus(id)}
            onBlur={() => onBlur(id)}
            required={required}
            aria-invalid={hasError}
            className={cn(
              "h-11",
              hasError &&
                "border-destructive focus-visible:ring-destructive/20",
              suffix && "pr-9",
            )}
          />
          {suffix && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              {suffix}
            </span>
          )}
          <FieldEditingIndicator peer={editor} />
        </div>
        <FieldError messages={errors} />
      </div>
    </div>
  );
}

function RowTextarea({
  id,
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  editor,
  errors,
}: Omit<RowProps, "type" | "required" | "suffix">) {
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
