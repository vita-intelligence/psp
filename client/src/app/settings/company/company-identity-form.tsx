"use client";

import { useState, useTransition } from "react";
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
import { cn } from "@/lib/utils";
import { updateCompanyIdentityAction } from "@/lib/company/actions";
import type { Company } from "@/lib/types";
import type { FieldErrors } from "@/lib/auth/actions";
import type { ErrorResult } from "@/lib/errors/server";
import { Loader2, LockKeyhole } from "lucide-react";

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

export function CompanyIdentityForm({
  company,
  canEdit,
}: CompanyIdentityFormProps) {
  const [original, setOriginal] = useState<FormState>(initialFrom(company));
  const [form, setForm] = useState<FormState>(initialFrom(company));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((s) => ({ ...s, [key]: value }));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  function onReset() {
    setForm(original);
    setFieldErrors({});
    setActionError(null);
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>General</CardTitle>
            <CardDescription>
              The legal and contact details shown on documents and emails.
            </CardDescription>
          </div>
          {!canEdit && <ReadOnlyBadge />}
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <Row
              id="name"
              label="Company name"
              required
              value={form.name}
              onChange={(v) => update("name", v)}
              errors={fieldErrors.name}
            />
            <RowTextarea
              id="legal_address"
              label="Legal address"
              value={form.legal_address ?? ""}
              onChange={(v) => update("legal_address", v)}
              errors={fieldErrors.legal_address}
            />
            <Row
              id="email"
              label="E-mail"
              type="email"
              value={form.email ?? ""}
              onChange={(v) => update("email", v)}
              errors={fieldErrors.email}
            />
            <Row
              id="website"
              label="Website"
              type="url"
              value={form.website ?? ""}
              onChange={(v) => update("website", v)}
              errors={fieldErrors.website}
            />
            <Row
              id="phone"
              label="Phone"
              value={form.phone ?? ""}
              onChange={(v) => update("phone", v)}
              errors={fieldErrors.phone}
            />
            <Row
              id="registration_number"
              label="Reg. no."
              value={form.registration_number ?? ""}
              onChange={(v) => update("registration_number", v)}
              errors={fieldErrors.registration_number}
            />
            <Row
              id="tax_number"
              label="Tax / VAT number"
              value={form.tax_number ?? ""}
              onChange={(v) => update("tax_number", v)}
              errors={fieldErrors.tax_number}
            />
            <Row
              id="tax_rate"
              label="Tax rate"
              type="number"
              suffix="%"
              value={form.tax_rate ?? ""}
              onChange={(v) => update("tax_rate", v)}
              errors={fieldErrors.tax_rate}
            />
            <RowTextarea
              id="payment_details"
              label="Payment details"
              value={form.payment_details ?? ""}
              onChange={(v) => update("payment_details", v)}
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
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                {dirty && !pending && (
                  <Button type="button" variant="ghost" onClick={onReset}>
                    Discard
                  </Button>
                )}
                <Button type="submit" disabled={!dirty || pending}>
                  {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save changes
                </Button>
              </div>
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
  id: keyof FormState;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
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
  errors,
}: Omit<RowProps, "type" | "required" | "suffix">) {
  const hasError = Boolean(errors && errors.length > 0);
  return (
    <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
      <Label htmlFor={id} className="pt-2.5 text-sm font-medium">
        {label}
      </Label>
      <div className="space-y-1.5">
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          aria-invalid={hasError}
          className={cn(
            hasError && "border-destructive focus-visible:ring-destructive/20",
          )}
        />
        <FieldError messages={errors} />
      </div>
    </div>
  );
}
