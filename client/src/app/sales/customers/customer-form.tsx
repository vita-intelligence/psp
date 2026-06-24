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
  CircleDashed,
  Loader2,
  Lock,
  LockKeyhole,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { CountryPicker } from "@/components/forms/country-picker";
import { CurrencyPicker } from "@/components/forms/currency-picker";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import type { ErrorResult } from "@/lib/errors/server";
import { cn } from "@/lib/utils";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import type {
  CompanyDefaults,
  Customer,
  CustomerPaymentBasis,
  CustomerStatus,
  UserListEntry,
} from "@/lib/types";
import type { FieldErrors } from "@/lib/auth/actions";
import {
  createCustomerAction,
  updateCustomerAction,
  type CustomerInput,
} from "@/lib/customers/actions";
import { invalidateAudit, subscribeRestore } from "@/lib/audit/invalidator";
import { formatCompanyDate } from "@/lib/format/company";

interface CustomerFormProps {
  /** `null` ⇒ create mode; otherwise edit. */
  customer: Customer | null;
  /** Org-wide defaults — currency, tax rate, language, date format. New
   *  customers inherit these so the form opens with the company's
   *  baseline. */
  company: CompanyDefaults;
  /** Team list for the Account Manager picker. */
  users: UserListEntry[];
  canEdit: boolean;
  /** Fired on successful save so the EditModeToggle wrapper can flip
   *  the page back to view mode. */
  onSavedSuccess?: () => void;
}

interface FormState {
  // Identity
  name: string;
  legal_name: string;
  contact_name: string;
  website: string;
  legal_address: string;
  country_code: string;
  registration_number: string;
  tax_number: string;
  // Commercial
  currency_code: string;
  tax_rate: string;
  default_discount_percent: string;
  language_code: string;
  payment_terms_days: number;
  payment_terms_basis: CustomerPaymentBasis;
  trade_credit_limit: string;
  contact_frequency_months: number;
  // Relationship
  account_manager_id: number | null;
  is_active: boolean;
}

const PAYMENT_BASES: Array<{ value: CustomerPaymentBasis; label: string }> = [
  { value: "invoice_date", label: "the invoice date" },
  { value: "dispatch_date", label: "the dispatch date" },
  { value: "month_end", label: "end of month" },
];

const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Português" },
  { value: "pl", label: "Polski" },
  { value: "uk", label: "Українська" },
  { value: "ro", label: "Română" },
  { value: "nl", label: "Nederlands" },
];

const STATUS_LABEL: Record<CustomerStatus, string> = {
  lead: "Lead",
  prospect: "Prospect",
  active: "Active",
  dormant: "Dormant",
  inactive: "Inactive",
};

const STATUS_TONE: Record<
  CustomerStatus,
  "emerald" | "amber" | "sky" | "muted" | "destructive"
> = {
  lead: "sky",
  prospect: "amber",
  active: "emerald",
  dormant: "muted",
  inactive: "destructive",
};

function initialFrom(
  customer: Customer | null,
  company: CompanyDefaults,
): FormState {
  if (!customer) {
    return {
      name: "",
      legal_name: "",
      contact_name: "",
      website: "",
      legal_address: "",
      country_code: "",
      registration_number: "",
      tax_number: "",
      currency_code: company.currency_code,
      tax_rate: "",
      default_discount_percent: "",
      language_code: "en",
      payment_terms_days: 30,
      payment_terms_basis: "invoice_date",
      trade_credit_limit: "",
      contact_frequency_months: 3,
      account_manager_id: null,
      is_active: true,
    };
  }
  return {
    name: customer.name,
    legal_name: customer.legal_name ?? "",
    contact_name: customer.contact_name ?? "",
    website: customer.website ?? "",
    legal_address: customer.legal_address ?? "",
    country_code: customer.country_code ?? "",
    registration_number: customer.registration_number ?? "",
    tax_number: customer.tax_number ?? "",
    currency_code: customer.currency_code,
    tax_rate: customer.tax_rate ?? "",
    default_discount_percent: customer.default_discount_percent ?? "",
    language_code: customer.language_code ?? "en",
    payment_terms_days: customer.payment_terms_days,
    payment_terms_basis: customer.payment_terms_basis,
    trade_credit_limit: customer.trade_credit_limit ?? "",
    contact_frequency_months: customer.contact_frequency_months ?? 3,
    account_manager_id: customer.account_manager?.id ?? null,
    is_active: customer.is_active,
  };
}

export function CustomerForm({
  customer,
  company,
  users,
  canEdit,
  onSavedSuccess,
}: CustomerFormProps) {
  const router = useRouter();
  const resource = customer ? `customer:${customer.uuid}` : "customer:new";

  // Broadcast our current form on the lobby so the list page can show
  // "X is editing this" badges.
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
      () => initialFrom(customer, company),
      [customer, company],
    ),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Customer created", {
          description: `${creator?.name ?? "The host"} just finalized "${msg.name}".`,
        });
        router.push(`/sales/customers/${msg.uuid}`);
      } else if (msg.kind === "saved") {
        toast.success("Saved", {
          description: `${creator?.name ?? "The host"} just saved the form.`,
        });
        setOriginal(msg.state);
        resetState(msg.state);
        if (customer) invalidateAudit("customer", customer.id);
      }
    },
  });

  // Remote-cursor anchor
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
    if (!customer) return;
    return subscribeRestore("customer", customer.id, (raw) => {
      const r = raw as Partial<Customer> & Record<string, unknown>;
      const restored: FormState = {
        name: typeof r.name === "string" ? r.name : "",
        legal_name: typeof r.legal_name === "string" ? r.legal_name : "",
        contact_name: typeof r.contact_name === "string" ? r.contact_name : "",
        website: typeof r.website === "string" ? r.website : "",
        legal_address:
          typeof r.legal_address === "string" ? r.legal_address : "",
        country_code: typeof r.country_code === "string" ? r.country_code : "",
        registration_number:
          typeof r.registration_number === "string"
            ? r.registration_number
            : "",
        tax_number: typeof r.tax_number === "string" ? r.tax_number : "",
        currency_code:
          typeof r.currency_code === "string"
            ? r.currency_code
            : company.currency_code,
        tax_rate: typeof r.tax_rate === "string" ? r.tax_rate : "",
        default_discount_percent:
          typeof r.default_discount_percent === "string"
            ? r.default_discount_percent
            : "",
        language_code:
          typeof r.language_code === "string" ? r.language_code : "en",
        payment_terms_days:
          typeof r.payment_terms_days === "number" ? r.payment_terms_days : 30,
        payment_terms_basis:
          typeof r.payment_terms_basis === "string"
            ? (r.payment_terms_basis as CustomerPaymentBasis)
            : "invoice_date",
        trade_credit_limit:
          typeof r.trade_credit_limit === "string" ? r.trade_credit_limit : "",
        contact_frequency_months:
          typeof r.contact_frequency_months === "number"
            ? r.contact_frequency_months
            : 3,
        account_manager_id:
          typeof r.account_manager_id === "number"
            ? r.account_manager_id
            : null,
        is_active: r.is_active !== false,
      };
      resetState(restored);
    });
  }, [customer, resetState, company.currency_code]);

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
    initialFrom(customer, company),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  // Identity-immutability warning: if the customer is currently
  // `approved` and the user edits legal_name / registration_number /
  // tax_number, saving will VOID the approval (server-side rule).
  // Surface a calm banner instead of letting them find out after save.
  const approved = customer?.approval_status === "approved";
  const identityChanged =
    approved &&
    (state.legal_name !== (customer?.legal_name ?? "") ||
      state.registration_number !== (customer?.registration_number ?? "") ||
      state.tax_number !== (customer?.tax_number ?? ""));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setActionError(null);

    const payload: CustomerInput = {
      name: state.name.trim(),
      legal_name: state.legal_name.trim() || null,
      contact_name: state.contact_name.trim() || null,
      website: state.website.trim() || null,
      legal_address: state.legal_address.trim() || null,
      country_code: state.country_code || null,
      registration_number: state.registration_number.trim() || null,
      tax_number: state.tax_number.trim() || null,
      currency_code: state.currency_code,
      tax_rate: state.tax_rate.trim() || null,
      default_discount_percent: state.default_discount_percent.trim() || null,
      language_code: state.language_code || null,
      payment_terms_days: state.payment_terms_days,
      payment_terms_basis: state.payment_terms_basis,
      trade_credit_limit: state.trade_credit_limit.trim() || null,
      contact_frequency_months: state.contact_frequency_months,
      account_manager_id: state.account_manager_id,
      is_active: state.is_active,
    };

    startTransition(async () => {
      const res = customer
        ? await updateCustomerAction(customer.uuid, payload)
        : await createCustomerAction(payload);

      if (res.ok) {
        toast.success(customer ? "Customer saved" : "Customer created");
        setOriginal(state);
        invalidateAudit("customer", res.customer.id);

        if (customer) {
          broadcastCommit({ kind: "saved", state });
          onSavedSuccess?.();
        } else {
          broadcastCommit({
            kind: "created",
            uuid: res.customer.uuid,
            name: res.customer.name,
          });
          router.push(`/sales/customers/${res.customer.uuid}`);
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
            <CardTitle className="flex items-center gap-2">
              {customer ? customer.name : "New customer"}
              {customer && (
                <Badge tone={STATUS_TONE[customer.status]}>
                  {STATUS_LABEL[customer.status]}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Identity, commercial terms, and account-manager assignment.
              Approval and contact-log live in their own panels below.
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
            {/* Two-column layout — left identity, right commercial. Stacks
                on small screens. */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* LEFT: identity */}
              <div className="space-y-4">
                <SectionTitle>Identity</SectionTitle>

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
                <CollabRow
                  id="legal_name"
                  label="Legal name"
                  value={state.legal_name}
                  onChange={(v) => setField("legal_name", v)}
                  onFocus={focusField}
                  onBlur={blurField}
                  editor={fieldEditors.legal_name}
                  errors={fieldErrors.legal_name}
                  hint={
                    approved
                      ? "Locked once approved — changing voids approval."
                      : undefined
                  }
                />
                <CollabRow
                  id="contact_name"
                  label="Primary contact"
                  value={state.contact_name}
                  onChange={(v) => setField("contact_name", v)}
                  onFocus={focusField}
                  onBlur={blurField}
                  editor={fieldEditors.contact_name}
                  errors={fieldErrors.contact_name}
                />
                <CollabRow
                  id="website"
                  label="Website"
                  value={state.website}
                  onChange={(v) => setField("website", v)}
                  onFocus={focusField}
                  onBlur={blurField}
                  editor={fieldEditors.website}
                  errors={fieldErrors.website}
                  placeholder="https://…"
                />
                <CollabTextareaRow
                  id="legal_address"
                  label="Legal address"
                  value={state.legal_address}
                  onChange={(v) => setField("legal_address", v)}
                  onFocus={focusField}
                  onBlur={blurField}
                  editor={fieldEditors.legal_address}
                  errors={fieldErrors.legal_address}
                />

                <PickerRow
                  id="country_code"
                  label="Country"
                  editor={fieldEditors.country_code}
                  errors={fieldErrors.country_code}
                >
                  <CountryPicker
                    id="country_code"
                    value={state.country_code || null}
                    onChange={(v) => setField("country_code", v ?? "")}
                    onFocus={() => focusField("country_code")}
                    onBlur={() => blurField("country_code")}
                  />
                </PickerRow>

                <CollabRow
                  id="registration_number"
                  label="Registration #"
                  value={state.registration_number}
                  onChange={(v) => setField("registration_number", v)}
                  onFocus={focusField}
                  onBlur={blurField}
                  editor={fieldEditors.registration_number}
                  errors={fieldErrors.registration_number}
                  mono
                  hint={
                    approved
                      ? "Locked once approved — changing voids approval."
                      : undefined
                  }
                />
                <CollabRow
                  id="tax_number"
                  label="Tax / VAT #"
                  value={state.tax_number}
                  onChange={(v) => setField("tax_number", v)}
                  onFocus={focusField}
                  onBlur={blurField}
                  editor={fieldEditors.tax_number}
                  errors={fieldErrors.tax_number}
                  mono
                  hint={
                    approved
                      ? "Locked once approved — changing voids approval."
                      : undefined
                  }
                />
              </div>

              {/* RIGHT: commercial */}
              <div className="space-y-4">
                <SectionTitle>Commercial</SectionTitle>

                {/* Account manager — Select populated from team list */}
                <FieldRow
                  id="account_manager_id"
                  label="Account manager"
                  editor={fieldEditors.account_manager_id}
                  errors={fieldErrors.account_manager_id}
                >
                  <Select
                    value={
                      state.account_manager_id !== null
                        ? String(state.account_manager_id)
                        : "none"
                    }
                    onValueChange={(v) =>
                      setField(
                        "account_manager_id",
                        v === "none" ? null : Number(v),
                      )
                    }
                  >
                    <SelectTrigger
                      onFocus={() => focusField("account_manager_id")}
                      onBlur={() => blurField("account_manager_id")}
                      className="h-11"
                    >
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Unassigned —</SelectItem>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>

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

                <CollabRow
                  id="tax_rate"
                  label="Tax rate (%)"
                  value={state.tax_rate}
                  onChange={(v) => setField("tax_rate", v)}
                  onFocus={focusField}
                  onBlur={blurField}
                  editor={fieldEditors.tax_rate}
                  errors={fieldErrors.tax_rate}
                  hint="Override the company default when this customer has a different rate."
                  mono
                />
                <CollabRow
                  id="default_discount_percent"
                  label="Default discount (%)"
                  value={state.default_discount_percent}
                  onChange={(v) => setField("default_discount_percent", v)}
                  onFocus={focusField}
                  onBlur={blurField}
                  editor={fieldEditors.default_discount_percent}
                  errors={fieldErrors.default_discount_percent}
                  mono
                />

                <FieldRow
                  id="language_code"
                  label="Language"
                  editor={fieldEditors.language_code}
                  errors={fieldErrors.language_code}
                >
                  <Select
                    value={state.language_code || "en"}
                    onValueChange={(v) => setField("language_code", v)}
                  >
                    <SelectTrigger
                      onFocus={() => focusField("language_code")}
                      onBlur={() => blurField("language_code")}
                      className="h-11"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((l) => (
                        <SelectItem key={l.value} value={l.value}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>

                {/* Payment terms — N days after <basis>. Mirrors MRPEasy
                    layout: number input + basis dropdown on one row. */}
                <FieldRow
                  id="payment_terms_days"
                  label="Payment terms"
                  editor={
                    fieldEditors.payment_terms_days ??
                    fieldEditors.payment_terms_basis
                  }
                  errors={
                    fieldErrors.payment_terms_days ??
                    fieldErrors.payment_terms_basis
                  }
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative">
                      <Input
                        id="payment_terms_days"
                        type="number"
                        min={0}
                        max={365}
                        value={state.payment_terms_days}
                        onChange={(e) =>
                          setField(
                            "payment_terms_days",
                            Number(e.target.value || 0),
                          )
                        }
                        onFocus={() => focusField("payment_terms_days")}
                        onBlur={() => blurField("payment_terms_days")}
                        className="h-11 w-28 font-mono"
                      />
                      <FieldEditingIndicator
                        peer={fieldEditors.payment_terms_days}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground">
                      days after
                    </span>
                    <Select
                      value={state.payment_terms_basis}
                      onValueChange={(v) =>
                        setField(
                          "payment_terms_basis",
                          v as CustomerPaymentBasis,
                        )
                      }
                    >
                      <SelectTrigger
                        onFocus={() => focusField("payment_terms_basis")}
                        onBlur={() => blurField("payment_terms_basis")}
                        className="h-11 flex-1"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_BASES.map((b) => (
                          <SelectItem key={b.value} value={b.value}>
                            {b.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </FieldRow>

                <CollabRow
                  id="trade_credit_limit"
                  label="Trade credit limit"
                  value={state.trade_credit_limit}
                  onChange={(v) => setField("trade_credit_limit", v)}
                  onFocus={focusField}
                  onBlur={blurField}
                  editor={fieldEditors.trade_credit_limit}
                  errors={fieldErrors.trade_credit_limit}
                  placeholder={`In ${state.currency_code}`}
                  mono
                />

                <FieldRow
                  id="contact_frequency_months"
                  label="Contact every"
                  editor={fieldEditors.contact_frequency_months}
                  errors={fieldErrors.contact_frequency_months}
                >
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Input
                        id="contact_frequency_months"
                        type="number"
                        min={0}
                        max={60}
                        value={state.contact_frequency_months}
                        onChange={(e) =>
                          setField(
                            "contact_frequency_months",
                            Number(e.target.value || 0),
                          )
                        }
                        onFocus={() =>
                          focusField("contact_frequency_months")
                        }
                        onBlur={() => blurField("contact_frequency_months")}
                        className="h-11 w-24 font-mono"
                      />
                      <FieldEditingIndicator
                        peer={fieldEditors.contact_frequency_months}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground">
                      months — drives the Next-contact reminder.
                    </span>
                  </div>
                </FieldRow>

                <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                  <Label className="pt-1.5 text-sm font-medium">Active</Label>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={state.is_active}
                      onCheckedChange={(v) => setField("is_active", v)}
                      aria-label="Customer is active"
                    />
                    <span className="text-sm text-muted-foreground">
                      {state.is_active
                        ? "Active — visible in pickers and CO forms"
                        : "Inactive — hidden from sales workflows"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Derived (read-only) cadence — surface what the system
                computes so the user trusts the projection. */}
            {customer && (
              <div className="rounded-md border border-border/60 bg-muted/20 px-4 py-3">
                <SectionTitle>Contact cadence (derived)</SectionTitle>
                <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
                  <ReadOnlyCell label="Contact started">
                    {customer.contact_started_at
                      ? formatCompanyDate(customer.contact_started_at, company)
                      : "—"}
                  </ReadOnlyCell>
                  <ReadOnlyCell label="Last contact">
                    {customer.last_contact_at
                      ? formatCompanyDate(customer.last_contact_at, company)
                      : "—"}
                  </ReadOnlyCell>
                  <ReadOnlyCell label="Next contact">
                    {customer.next_contact_at ? (
                      formatCompanyDate(customer.next_contact_at, company)
                    ) : (
                      <span className="inline-flex items-center gap-1 text-muted-foreground/70">
                        <CircleDashed className="size-3" />
                        Not yet
                      </span>
                    )}
                  </ReadOnlyCell>
                </dl>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  These dates are computed from your contact-event log
                  (below) — log a call / email / meeting and they update.
                </p>
              </div>
            )}

            {identityChanged && (
              <div className="rounded-md border border-amber-500/40 bg-amber-50/50 px-3 py-2.5 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                Changing identity (legal name / registration / tax #) on
                an approved customer voids the approval. The customer
                will need to be re-approved after this save.
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
                      can {customer ? "save" : "create"} from this room.
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
                    title={
                      isCreator
                        ? undefined
                        : creator
                          ? `Only ${creator.name} can ${customer ? "save" : "create"} from this room.`
                          : undefined
                    }
                  >
                    {pending && (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    )}
                    {customer ? "Save changes" : "Create customer"}
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

// ----- field-row helpers -----------------------------------------

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
    <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
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

function ReadOnlyCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
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
        "Ask an admin for the `customers.edit` permission to join this form.",
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
