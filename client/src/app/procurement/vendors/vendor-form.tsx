"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Building2,
  ClipboardCheck,
  Loader2,
  Save,
  ShieldAlert,
  Undo2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import type {
  Vendor,
  VendorPaymentBasis,
  VendorQuestionnaireStatus,
  VendorRisk,
  VendorSupplyChainType,
  VendorTraceabilityStatus,
} from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import {
  createVendorAction,
  updateVendorAction,
  type VendorInput,
} from "@/lib/vendors/actions";

interface Props {
  vendor: Vendor | null;
  canEdit: boolean;
}

const UNSET = "__unset__";

const SUPPLY_CHAIN_OPTIONS: VendorSupplyChainType[] = [
  "manufacturer",
  "co_manufacturer",
  "distributor",
  "broker",
  "agent",
  "grower",
];

const RISK_OPTIONS: VendorRisk[] = ["low", "medium", "high"];

const QUESTIONNAIRE_OPTIONS: VendorQuestionnaireStatus[] = [
  "not_sent",
  "sent",
  "received",
  "approved",
  "overdue",
  "na",
];

const TRACEABILITY_OPTIONS: VendorTraceabilityStatus[] = [
  "not_done",
  "in_progress",
  "verified",
  "failed",
  "na",
];

const PAYMENT_BASIS_OPTIONS: VendorPaymentBasis[] = [
  "invoice_date",
  "month_end",
  "delivery_date",
];

/**
 * Mega-form for the vendor identity + commercial terms +
 * supplier-qualification block. Approval status is NOT cast here —
 * that goes through the dedicated approval dialog gated on
 * `vendors.approve`.
 */
export function VendorForm({ vendor, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(vendor === null);
  const [topError, setTopError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const initial = useMemo(() => snapshot(vendor), [vendor]);
  const [draft, setDraft] = useState(initial);

  useEffect(() => setDraft(initial), [initial]);

  const dirtyKeys = useMemo(
    () =>
      (Object.keys(initial) as Array<keyof typeof initial>).filter(
        (k) => (initial[k] ?? "") !== (draft[k] ?? ""),
      ),
    [initial, draft],
  );
  const isDirty = vendor === null || dirtyKeys.length > 0;

  function update<K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
    setFieldErrors((e) => {
      if (!e[String(key)]) return e;
      const { [String(key)]: _, ...rest } = e;
      void _;
      return rest;
    });
  }

  function onCancel() {
    if (vendor === null) {
      router.push("/procurement/vendors");
      return;
    }
    setDraft(initial);
    setTopError(null);
    setFieldErrors({});
    setEditing(false);
  }

  function onSave() {
    if (!canEdit) return;
    setTopError(null);
    setFieldErrors({});

    const payload = buildPayload(draft);
    startTransition(async () => {
      const res = vendor
        ? await updateVendorAction(vendor.uuid, payload)
        : await createVendorAction(payload);

      if (res.ok) {
        toast.success(vendor ? "Saved" : "Vendor created");
        if (vendor === null) {
          router.push(`/procurement/vendors/${res.vendor.uuid}`);
          return;
        }
        setEditing(false);
        router.refresh();
      } else {
        setTopError({ detail: res.detail, code: res.code, debug: res.debug });
        setFieldErrors(res.fields ?? {});
      }
    });
  }

  const inputsDisabled = !canEdit || !editing || pending;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          {!canEdit && (
            <span>
              Read-only — needs <code>vendors.edit</code>
            </span>
          )}
          {canEdit && !editing && vendor && <span>Read-only view — press Edit to change.</span>}
        </div>
        {canEdit && !editing && vendor && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        )}
      </header>

      {topError && (
        <ErrorBanner
          detail={topError.detail}
          code={topError.code}
          debug={topError.debug}
        />
      )}

      <fieldset disabled={inputsDisabled} className="space-y-4 border-0 p-0">
        <Section icon={Building2} title="Identity">
          <Grid cols={2}>
            <Field label="Name" required error={fieldErrors.name?.[0]}>
              <Input
                value={draft.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Acme Botanicals Ltd"
              />
            </Field>
            <Field label="Legal name" error={fieldErrors.legal_name?.[0]}>
              <Input
                value={draft.legal_name}
                onChange={(e) => update("legal_name", e.target.value)}
                placeholder="If different from trading name"
              />
            </Field>
            <Field label="Contact name" error={fieldErrors.contact_name?.[0]}>
              <Input
                value={draft.contact_name}
                onChange={(e) => update("contact_name", e.target.value)}
                placeholder="Primary contact"
              />
            </Field>
            <Field label="Email" error={fieldErrors.email?.[0]}>
              <Input
                type="email"
                value={draft.email}
                onChange={(e) => update("email", e.target.value)}
                placeholder="orders@example.com"
              />
            </Field>
            <Field label="Phone" error={fieldErrors.phone?.[0]}>
              <Input
                value={draft.phone}
                onChange={(e) => update("phone", e.target.value)}
              />
            </Field>
            <Field label="Website" error={fieldErrors.website?.[0]}>
              <Input
                value={draft.website}
                onChange={(e) => update("website", e.target.value)}
                placeholder="https://…"
              />
            </Field>
          </Grid>
          <Field label="Legal address" error={fieldErrors.legal_address?.[0]}>
            <Textarea
              rows={2}
              value={draft.legal_address}
              onChange={(e) => update("legal_address", e.target.value)}
            />
          </Field>
          <Grid cols={2}>
            <Field
              label="Registration number"
              error={fieldErrors.registration_number?.[0]}
            >
              <Input
                value={draft.registration_number}
                onChange={(e) => update("registration_number", e.target.value)}
              />
            </Field>
            <Field label="Tax / VAT number" error={fieldErrors.tax_number?.[0]}>
              <Input
                value={draft.tax_number}
                onChange={(e) => update("tax_number", e.target.value)}
              />
            </Field>
          </Grid>
        </Section>

        <Section icon={Wallet} title="Commercial terms">
          <Grid cols={3}>
            <Field label="Currency" error={fieldErrors.currency_code?.[0]}>
              <Input
                value={draft.currency_code}
                onChange={(e) =>
                  update("currency_code", e.target.value.toUpperCase())
                }
                maxLength={3}
                className="font-mono"
                placeholder="GBP"
              />
            </Field>
            <Field
              label="Default lead time (days)"
              error={fieldErrors.default_lead_time_days?.[0]}
            >
              <Input
                type="text"
                inputMode="numeric"
                value={draft.default_lead_time_days}
                onChange={(e) =>
                  update(
                    "default_lead_time_days",
                    e.target.value.replace(/\D/g, ""),
                  )
                }
                placeholder="14"
              />
            </Field>
            <Field label="Tax rate (%)" error={fieldErrors.tax_rate?.[0]}>
              <Input
                type="text"
                inputMode="decimal"
                value={draft.tax_rate}
                onChange={(e) => update("tax_rate", e.target.value)}
                placeholder="20"
              />
            </Field>
            <Field
              label="Payment term (days)"
              error={fieldErrors.payment_terms_days?.[0]}
            >
              <Input
                type="text"
                inputMode="numeric"
                value={draft.payment_terms_days}
                onChange={(e) =>
                  update(
                    "payment_terms_days",
                    e.target.value.replace(/\D/g, ""),
                  )
                }
                placeholder="30"
              />
            </Field>
            <Field label="Payment basis" error={fieldErrors.payment_basis?.[0]}>
              <Select
                value={draft.payment_basis}
                onValueChange={(v) =>
                  update("payment_basis", v as VendorPaymentBasis)
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_BASIS_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Grid>
        </Section>

        <Section icon={ShieldAlert} title="Supplier qualification">
          <Grid cols={3}>
            <Field
              label="Supply chain type"
              error={fieldErrors.supply_chain_type?.[0]}
            >
              <Select
                value={draft.supply_chain_type || UNSET}
                onValueChange={(v) =>
                  update(
                    "supply_chain_type",
                    v === UNSET ? "" : (v as VendorSupplyChainType),
                  )
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET}>—</SelectItem>
                  {SUPPLY_CHAIN_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Risk class" error={fieldErrors.vendor_risk?.[0]}>
              <Select
                value={draft.vendor_risk || UNSET}
                onValueChange={(v) =>
                  update("vendor_risk", v === UNSET ? "" : (v as VendorRisk))
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET}>—</SelectItem>
                  {RISK_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Questionnaire (SAQ)"
              error={fieldErrors.questionnaire_status?.[0]}
            >
              <Select
                value={draft.questionnaire_status}
                onValueChange={(v) =>
                  update(
                    "questionnaire_status",
                    v as VendorQuestionnaireStatus,
                  )
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTIONNAIRE_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Traceability verification"
              error={fieldErrors.traceability_verification_status?.[0]}
            >
              <Select
                value={draft.traceability_verification_status}
                onValueChange={(v) =>
                  update(
                    "traceability_verification_status",
                    v as VendorTraceabilityStatus,
                  )
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRACEABILITY_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Review cadence (months)"
              error={fieldErrors.review_frequency_months?.[0]}
            >
              <Input
                type="text"
                inputMode="numeric"
                value={draft.review_frequency_months}
                onChange={(e) =>
                  update(
                    "review_frequency_months",
                    e.target.value.replace(/\D/g, ""),
                  )
                }
                placeholder="12"
              />
            </Field>
            <Field
              label="Last review date"
              error={fieldErrors.last_review_at?.[0]}
            >
              <Input
                type="date"
                value={draft.last_review_at}
                onChange={(e) => update("last_review_at", e.target.value)}
              />
            </Field>
            <Field
              label="Next review due"
              error={fieldErrors.next_review_at?.[0]}
            >
              <Input
                type="date"
                value={draft.next_review_at}
                onChange={(e) => update("next_review_at", e.target.value)}
              />
            </Field>
          </Grid>
          <Field
            label="Product types supplied (comma-separated)"
            error={fieldErrors.product_types?.[0]}
          >
            <Input
              value={draft.product_types}
              onChange={(e) => update("product_types", e.target.value)}
              placeholder="actives, excipients, packaging"
            />
          </Field>
        </Section>

        <Section icon={ClipboardCheck} title="Notes">
          <Field label="Internal notes" error={fieldErrors.notes?.[0]}>
            <Textarea
              rows={3}
              value={draft.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Anything procurement / QA should know about this supplier"
            />
          </Field>
        </Section>

        {(editing || vendor === null) && canEdit && (
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/95 px-4 py-3 shadow-md backdrop-blur">
            <div className="text-xs text-muted-foreground">
              {vendor === null
                ? "Filling in a new vendor."
                : isDirty
                  ? `${dirtyKeys.length} change${dirtyKeys.length === 1 ? "" : "s"} ready.`
                  : "Make a change then Save."}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCancel}
                disabled={pending}
              >
                <Undo2 className="mr-1.5 size-4" />
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onSave}
                disabled={pending || (vendor !== null && !isDirty)}
              >
                {pending ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 size-4" />
                )}
                {vendor === null ? "Create vendor" : "Save changes"}
              </Button>
            </div>
          </div>
        )}
      </fieldset>
    </div>
  );
}

type DraftSnapshot = {
  name: string;
  legal_name: string;
  email: string;
  phone: string;
  website: string;
  contact_name: string;
  legal_address: string;
  registration_number: string;
  tax_number: string;
  tax_rate: string;
  currency_code: string;
  default_lead_time_days: string;
  payment_terms_days: string;
  payment_basis: VendorPaymentBasis;
  supply_chain_type: string;
  vendor_risk: string;
  product_types: string;
  questionnaire_status: VendorQuestionnaireStatus;
  traceability_verification_status: VendorTraceabilityStatus;
  review_frequency_months: string;
  last_review_at: string;
  next_review_at: string;
  notes: string;
};

function snapshot(v: Vendor | null): DraftSnapshot {
  return {
    name: v?.name ?? "",
    legal_name: v?.legal_name ?? "",
    email: v?.email ?? "",
    phone: v?.phone ?? "",
    website: v?.website ?? "",
    contact_name: v?.contact_name ?? "",
    legal_address: v?.legal_address ?? "",
    registration_number: v?.registration_number ?? "",
    tax_number: v?.tax_number ?? "",
    tax_rate: v?.tax_rate ?? "",
    currency_code: v?.currency_code ?? "GBP",
    default_lead_time_days: v ? String(v.default_lead_time_days) : "0",
    payment_terms_days: v ? String(v.payment_terms_days) : "30",
    payment_basis: v?.payment_basis ?? "invoice_date",
    supply_chain_type: v?.supply_chain_type ?? "",
    vendor_risk: v?.vendor_risk ?? "",
    product_types: v?.product_types?.join(", ") ?? "",
    questionnaire_status: v?.questionnaire_status ?? "not_sent",
    traceability_verification_status:
      v?.traceability_verification_status ?? "not_done",
    review_frequency_months: v?.review_frequency_months
      ? String(v.review_frequency_months)
      : "",
    last_review_at: v?.last_review_at ?? "",
    next_review_at: v?.next_review_at ?? "",
    notes: v?.notes ?? "",
  };
}

function buildPayload(draft: DraftSnapshot): VendorInput {
  return {
    name: draft.name.trim(),
    legal_name: draft.legal_name.trim() || null,
    email: draft.email.trim() || null,
    phone: draft.phone.trim() || null,
    website: draft.website.trim() || null,
    contact_name: draft.contact_name.trim() || null,
    legal_address: draft.legal_address.trim() || null,
    registration_number: draft.registration_number.trim() || null,
    tax_number: draft.tax_number.trim() || null,
    tax_rate: draft.tax_rate.trim() || null,
    currency_code: draft.currency_code.trim().toUpperCase(),
    default_lead_time_days: Number(draft.default_lead_time_days || 0),
    payment_terms_days: Number(draft.payment_terms_days || 30),
    payment_basis: draft.payment_basis,
    supply_chain_type:
      (draft.supply_chain_type as VendorSupplyChainType) || null,
    vendor_risk: (draft.vendor_risk as VendorRisk) || null,
    product_types: draft.product_types
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    questionnaire_status: draft.questionnaire_status,
    traceability_verification_status: draft.traceability_verification_status,
    review_frequency_months: draft.review_frequency_months
      ? Number(draft.review_frequency_months)
      : null,
    last_review_at: draft.last_review_at || null,
    next_review_at: draft.next_review_at || null,
    notes: draft.notes.trim() || null,
  };
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Building2;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Grid({
  cols,
  children,
}: {
  cols: 2 | 3;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`grid gap-3 ${cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error && (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
