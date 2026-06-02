"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldError } from "@/components/forms/field-error";
import { cn } from "@/lib/utils";
import { updateCompanyLocaleAction } from "@/lib/company/actions";
import type { Company } from "@/lib/types";
import type { FieldErrors } from "@/lib/auth/actions";
import { AlertCircle, Loader2, LockKeyhole } from "lucide-react";

interface CompanyLocaleFormProps {
  company: Company;
  canEdit: boolean;
}

// Keep these lists in sync with the backend Company schema's
// validate_inclusion calls — if they drift, valid choices will trigger
// 422s and the UI won't know why.
const DATE_FORMATS = [
  "dd/MM/yyyy",
  "MM/dd/yyyy",
  "yyyy-MM-dd",
  "dd.MM.yyyy",
];
const SEPARATORS = [
  { value: ".", label: ". (dot)" },
  { value: ",", label: ", (comma)" },
  { value: ";", label: "; (semicolon)" },
  { value: "|", label: "| (pipe)" },
];
const CURRENCIES = ["GBP", "EUR", "USD", "JPY", "INR", "CHF", "CAD", "AUD"];
const FIRST_DAY = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];
const CURRENCY_FORMATS = [
  "[Sign] [Price]",
  "[Sign][Price]",
  "[Price] [Sign]",
  "[Price][Sign]",
];

type FormState = Pick<
  Company,
  | "timezone"
  | "date_format"
  | "first_day_of_week"
  | "decimal_separator"
  | "thousands_separator"
  | "csv_separator"
  | "currency_code"
  | "currency_format"
  | "generic_place_name"
>;

function initialFrom(company: Company): FormState {
  return {
    timezone: company.timezone,
    date_format: company.date_format,
    first_day_of_week: company.first_day_of_week,
    decimal_separator: company.decimal_separator,
    thousands_separator: company.thousands_separator,
    csv_separator: company.csv_separator,
    currency_code: company.currency_code,
    currency_format: company.currency_format,
    generic_place_name: company.generic_place_name,
  };
}

export function CompanyLocaleForm({ company, canEdit }: CompanyLocaleFormProps) {
  const [original, setOriginal] = useState<FormState>(initialFrom(company));
  const [form, setForm] = useState<FormState>(initialFrom(company));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((s) => ({ ...s, [key]: value }));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);
    startTransition(async () => {
      const res = await updateCompanyLocaleAction(form);
      if (res.ok) {
        toast.success("Locale settings updated");
        setOriginal(form);
        return;
      }
      setFieldErrors(res.fields ?? {});
      if (!res.fields || Object.keys(res.fields).length === 0) {
        setFormError(res.detail);
      }
    });
  }

  function onReset() {
    setForm(original);
    setFieldErrors({});
    setFormError(null);
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Locale &amp; format</CardTitle>
            <CardDescription>
              How dates, numbers, and currency display across PSP.
            </CardDescription>
          </div>
          {!canEdit && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              <LockKeyhole className="size-3" />
              Read-only
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <SelectRow
              id="timezone"
              label="Timezone"
              value={form.timezone}
              onChange={(v) => update("timezone", v)}
              options={TIMEZONES}
              errors={fieldErrors.timezone}
            />
            <SelectRow
              id="date_format"
              label="Date format"
              value={form.date_format}
              onChange={(v) => update("date_format", v)}
              options={DATE_FORMATS.map((v) => ({ value: v, label: v }))}
              errors={fieldErrors.date_format}
            />
            <SelectRow
              id="first_day_of_week"
              label="First day of the week"
              value={String(form.first_day_of_week)}
              onChange={(v) => update("first_day_of_week", Number(v))}
              options={FIRST_DAY.map((d) => ({
                value: String(d.value),
                label: d.label,
              }))}
              errors={fieldErrors.first_day_of_week}
            />
            <SelectRow
              id="decimal_separator"
              label="Decimal separator"
              value={form.decimal_separator}
              onChange={(v) => update("decimal_separator", v)}
              options={SEPARATORS}
              errors={fieldErrors.decimal_separator}
            />
            <SelectRow
              id="thousands_separator"
              label="Thousands separator"
              value={form.thousands_separator}
              onChange={(v) => update("thousands_separator", v)}
              options={SEPARATORS}
              errors={fieldErrors.thousands_separator}
            />
            <SelectRow
              id="csv_separator"
              label="CSV separator"
              value={form.csv_separator}
              onChange={(v) => update("csv_separator", v)}
              options={SEPARATORS}
              errors={fieldErrors.csv_separator}
            />
            <SelectRow
              id="currency_code"
              label="Currency code"
              value={form.currency_code}
              onChange={(v) => update("currency_code", v)}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
              errors={fieldErrors.currency_code}
            />
            <SelectRow
              id="currency_format"
              label="Currency format"
              value={form.currency_format}
              onChange={(v) => update("currency_format", v)}
              options={CURRENCY_FORMATS.map((c) => ({ value: c, label: c }))}
              errors={fieldErrors.currency_format}
            />
            <InputRow
              id="generic_place_name"
              label="Generic name of an undefined place in the stock"
              value={form.generic_place_name}
              onChange={(v) => update("generic_place_name", v)}
              errors={fieldErrors.generic_place_name}
            />

            {formError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{formError}</span>
              </div>
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

interface OptionEntry {
  value: string;
  label: string;
}

interface SelectRowProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: OptionEntry[];
  errors?: string[];
}

function SelectRow({
  id,
  label,
  value,
  onChange,
  options,
  errors,
}: SelectRowProps) {
  const hasError = Boolean(errors && errors.length > 0);
  return (
    <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
      <Label htmlFor={id} className="pt-2.5 text-sm font-medium">
        {label}
      </Label>
      <div className="space-y-1.5">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger
            id={id}
            aria-invalid={hasError}
            className={cn(
              "h-11 w-full",
              hasError &&
                "border-destructive focus-visible:ring-destructive/20",
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError messages={errors} />
      </div>
    </div>
  );
}

interface InputRowProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  errors?: string[];
}

function InputRow({ id, label, value, onChange, errors }: InputRowProps) {
  const hasError = Boolean(errors && errors.length > 0);
  return (
    <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
      <Label htmlFor={id} className="pt-2.5 text-sm font-medium">
        {label}
      </Label>
      <div className="space-y-1.5">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={hasError}
          className={cn(
            "h-11",
            hasError && "border-destructive focus-visible:ring-destructive/20",
          )}
        />
        <FieldError messages={errors} />
      </div>
    </div>
  );
}

// Short list of IANA timezones the UI offers — keeps the dropdown
// fast. If we ever need every IANA name, swap this for the data from
// `Intl.supportedValuesOf("timeZone")` populated on mount.
const TIMEZONES = [
  { value: "Europe/London", label: "Europe/London" },
  { value: "Europe/Dublin", label: "Europe/Dublin" },
  { value: "Europe/Paris", label: "Europe/Paris" },
  { value: "Europe/Berlin", label: "Europe/Berlin" },
  { value: "Europe/Madrid", label: "Europe/Madrid" },
  { value: "Europe/Warsaw", label: "Europe/Warsaw" },
  { value: "Europe/Kyiv", label: "Europe/Kyiv" },
  { value: "America/New_York", label: "America/New_York" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata" },
  { value: "Asia/Dubai", label: "Asia/Dubai" },
  { value: "Australia/Sydney", label: "Australia/Sydney" },
  { value: "UTC", label: "UTC" },
];
