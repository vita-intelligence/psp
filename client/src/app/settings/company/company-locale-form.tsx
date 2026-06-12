"use client";

import { useEffect, useState, useTransition } from "react";
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
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { cn } from "@/lib/utils";
import { updateCompanyLocaleAction } from "@/lib/company/actions";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { Company } from "@/lib/types";
import type { FieldErrors } from "@/lib/auth/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type { CollabPeer } from "@/lib/realtime/use-live-form";
import { Loader2, LockKeyhole } from "lucide-react";
import {
  CreatorLockBanner,
  JoinErrorCard,
  useFormCursorAnchor,
} from "./_realtime";

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

// Field prefix disambiguates focused-field broadcasts on the shared
// `form:company:1` channel.
const P = "locale_";

export function CompanyLocaleForm({ company, canEdit }: CompanyLocaleFormProps) {
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
    resource: "company:1:locale",
    disabled: !canEdit,
    initialState: initialFrom(company),
    onCommit: (raw) => {
      const msg = raw as { kind: "locale:saved"; state: FormState } | null;
      if (!msg || msg.kind !== "locale:saved") return;
      toast.success("Saved", {
        description: `${creator?.name ?? "The host"} just saved locale settings.`,
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
      const res = await updateCompanyLocaleAction(form);
      if (res.ok) {
        toast.success("Locale settings updated");
        setOriginal(form);
        broadcastCommit({ kind: "locale:saved", state: form });
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
            <CardTitle>Locale &amp; format</CardTitle>
            <CardDescription>
              How dates, numbers, and currency display across PSP.
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
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <SelectRow
              id={`${P}timezone`}
              label="Timezone"
              value={form.timezone}
              onChange={(v) => update("timezone", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}timezone`]}
              options={TIMEZONES}
              errors={fieldErrors.timezone}
            />
            <SelectRow
              id={`${P}date_format`}
              label="Date format"
              value={form.date_format}
              onChange={(v) => update("date_format", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}date_format`]}
              options={DATE_FORMATS.map((v) => ({ value: v, label: v }))}
              errors={fieldErrors.date_format}
            />
            <SelectRow
              id={`${P}first_day_of_week`}
              label="First day of the week"
              value={String(form.first_day_of_week)}
              onChange={(v) => update("first_day_of_week", Number(v))}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}first_day_of_week`]}
              options={FIRST_DAY.map((d) => ({
                value: String(d.value),
                label: d.label,
              }))}
              errors={fieldErrors.first_day_of_week}
            />
            <SelectRow
              id={`${P}decimal_separator`}
              label="Decimal separator"
              value={form.decimal_separator}
              onChange={(v) => update("decimal_separator", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}decimal_separator`]}
              options={SEPARATORS}
              errors={fieldErrors.decimal_separator}
            />
            <SelectRow
              id={`${P}thousands_separator`}
              label="Thousands separator"
              value={form.thousands_separator}
              onChange={(v) => update("thousands_separator", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}thousands_separator`]}
              options={SEPARATORS}
              errors={fieldErrors.thousands_separator}
            />
            <SelectRow
              id={`${P}csv_separator`}
              label="CSV separator"
              value={form.csv_separator}
              onChange={(v) => update("csv_separator", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}csv_separator`]}
              options={SEPARATORS}
              errors={fieldErrors.csv_separator}
            />
            <SelectRow
              id={`${P}currency_code`}
              label="Currency code"
              value={form.currency_code}
              onChange={(v) => update("currency_code", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}currency_code`]}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
              errors={fieldErrors.currency_code}
            />
            <SelectRow
              id={`${P}currency_format`}
              label="Currency format"
              value={form.currency_format}
              onChange={(v) => update("currency_format", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}currency_format`]}
              options={CURRENCY_FORMATS.map((c) => ({ value: c, label: c }))}
              errors={fieldErrors.currency_format}
            />
            <InputRow
              id={`${P}generic_place_name`}
              label="Generic name of an undefined place in the stock"
              value={form.generic_place_name}
              onChange={(v) => update("generic_place_name", v)}
              onFocus={focusField}
              onBlur={blurField}
              editor={fieldEditors[`${P}generic_place_name`]}
              errors={fieldErrors.generic_place_name}
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

interface OptionEntry {
  value: string;
  label: string;
}

interface SelectRowProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus: (field: string) => void;
  onBlur: (field: string) => void;
  editor: CollabPeer | null;
  options: OptionEntry[];
  errors?: string[];
}

function SelectRow({
  id,
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  editor,
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
        <div className="relative">
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger
              id={id}
              onFocus={() => onFocus(id)}
              onBlur={() => onBlur(id)}
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
          <FieldEditingIndicator peer={editor} />
        </div>
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
  onFocus: (field: string) => void;
  onBlur: (field: string) => void;
  editor: CollabPeer | null;
  errors?: string[];
}

function InputRow({
  id,
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  editor,
  errors,
}: InputRowProps) {
  const hasError = Boolean(errors && errors.length > 0);
  return (
    <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
      <Label htmlFor={id} className="pt-2.5 text-sm font-medium">
        {label}
      </Label>
      <div className="space-y-1.5">
        <div className="relative">
          <Input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => onFocus(id)}
            onBlur={() => onBlur(id)}
            aria-invalid={hasError}
            className={cn(
              "h-11",
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
