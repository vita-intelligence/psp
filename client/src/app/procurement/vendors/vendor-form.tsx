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
  Building2,
  ClipboardCheck,
  Loader2,
  Lock,
  LockKeyhole,
  Save,
  ShieldAlert,
  Undo2,
  Wallet,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import type {
  Vendor,
  VendorPaymentBasis,
  VendorQuestionnaireStatus,
  VendorRisk,
  VendorSupplyChainType,
  VendorTraceabilityStatus,
} from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import { cn } from "@/lib/utils";
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
 *
 * Realtime collab per psp/CLAUDE.md: presence avatars, per-field
 * editing indicators, remote cursors, creator gate on the Save button.
 */
export function VendorForm({ vendor, canEdit }: Props) {
  const router = useRouter();
  const resource = vendor ? `vendor:${vendor.uuid}` : "vendor:new";
  useFormPresenceBeacon(resource);

  const initial = useMemo(() => snapshot(vendor), [vendor]);

  type CommitPayload =
    | { kind: "created"; uuid: string; name: string }
    | { kind: "saved"; state: DraftSnapshot };

  const {
    state: draft,
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
  } = useLiveForm<DraftSnapshot>({
    resource,
    disabled: !canEdit,
    initialState: initial,
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Vendor created", {
          description: `${creator?.name ?? "The host"} just finalised "${msg.name}".`,
        });
        router.push(`/procurement/vendors/${msg.uuid}`);
      } else if (msg.kind === "saved") {
        toast.success("Saved", {
          description: `${creator?.name ?? "The host"} just saved the vendor.`,
        });
        setOriginal(msg.state);
        resetState(msg.state);
        router.refresh();
      }
    },
  });

  const [original, setOriginal] = useState<DraftSnapshot>(() =>
    snapshot(vendor),
  );
  // Keep `original` in sync when the parent re-fetches the vendor
  // (e.g. after navigation). This is the "clean" baseline for dirty
  // tracking — never tied to peer-broadcast state.
  useEffect(() => {
    setOriginal(snapshot(vendor));
  }, [vendor]);

  const [pending, startTransition] = useTransition();
  const [topError, setTopError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const dirtyKeys = useMemo(
    () =>
      (Object.keys(original) as Array<keyof DraftSnapshot>).filter(
        (k) => (original[k] ?? "") !== (draft[k] ?? ""),
      ),
    [original, draft],
  );
  const isDirty = vendor === null || dirtyKeys.length > 0;

  function update<K extends keyof DraftSnapshot>(
    key: K,
    value: DraftSnapshot[K],
  ) {
    setField(key, value);
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
    resetState(original);
    setTopError(null);
    setFieldErrors({});
  }

  function onSave() {
    if (!canEdit || !isCreator) return;
    setTopError(null);
    setFieldErrors({});

    const payload = buildPayload(draft);
    startTransition(async () => {
      const res = vendor
        ? await updateVendorAction(vendor.uuid, payload)
        : await createVendorAction(payload);

      if (res.ok) {
        toast.success(vendor ? "Saved" : "Vendor created");
        setOriginal(draft);
        if (vendor === null) {
          broadcastCommit({
            kind: "created",
            uuid: res.vendor.uuid,
            name: res.vendor.name,
          });
          router.push(`/procurement/vendors/${res.vendor.uuid}`);
          return;
        }
        broadcastCommit({ kind: "saved", state: draft });
        router.refresh();
      } else {
        setTopError({ detail: res.detail, code: res.code, debug: res.debug });
        setFieldErrors(res.fields ?? {});
      }
    });
  }

  // Cursor anchor + size observer (mirrors the warehouse pattern).
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
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setCursor(x, y);
    },
    [setCursor],
  );

  if (joinError) {
    return <JoinErrorCard error={joinError} />;
  }

  const inputsDisabled = !canEdit || pending;

  return (
    <div
      ref={cursorAnchorRef}
      onMouseMove={onCursorMove}
      onMouseLeave={hideCursor}
      className="relative space-y-4"
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

      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          {!canEdit && (
            <span>
              Read-only — needs <code>vendors.edit</code>
            </span>
          )}
        </div>
        <CollabAvatars peers={presence} />
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
            <Field
              id="name"
              label="Name"
              required
              error={fieldErrors.name?.[0]}
              editor={fieldEditors.name}
            >
              <Input
                id="name"
                value={draft.name}
                onChange={(e) => update("name", e.target.value)}
                onFocus={() => focusField("name")}
                onBlur={() => blurField("name")}
                placeholder="Acme Botanicals Ltd"
              />
            </Field>
            <Field
              id="legal_name"
              label="Legal name"
              error={fieldErrors.legal_name?.[0]}
              editor={fieldEditors.legal_name}
            >
              <Input
                id="legal_name"
                value={draft.legal_name}
                onChange={(e) => update("legal_name", e.target.value)}
                onFocus={() => focusField("legal_name")}
                onBlur={() => blurField("legal_name")}
                placeholder="If different from trading name"
              />
            </Field>
            <Field
              id="contact_name"
              label="Contact name"
              error={fieldErrors.contact_name?.[0]}
              editor={fieldEditors.contact_name}
            >
              <Input
                id="contact_name"
                value={draft.contact_name}
                onChange={(e) => update("contact_name", e.target.value)}
                onFocus={() => focusField("contact_name")}
                onBlur={() => blurField("contact_name")}
                placeholder="Primary contact"
              />
            </Field>
            <Field
              id="email"
              label="Email"
              error={fieldErrors.email?.[0]}
              editor={fieldEditors.email}
            >
              <Input
                id="email"
                type="email"
                value={draft.email}
                onChange={(e) => update("email", e.target.value)}
                onFocus={() => focusField("email")}
                onBlur={() => blurField("email")}
                placeholder="orders@example.com"
              />
            </Field>
            <Field
              id="phone"
              label="Phone"
              error={fieldErrors.phone?.[0]}
              editor={fieldEditors.phone}
            >
              <Input
                id="phone"
                value={draft.phone}
                onChange={(e) => update("phone", e.target.value)}
                onFocus={() => focusField("phone")}
                onBlur={() => blurField("phone")}
              />
            </Field>
            <Field
              id="website"
              label="Website"
              error={fieldErrors.website?.[0]}
              editor={fieldEditors.website}
            >
              <Input
                id="website"
                value={draft.website}
                onChange={(e) => update("website", e.target.value)}
                onFocus={() => focusField("website")}
                onBlur={() => blurField("website")}
                placeholder="https://…"
              />
            </Field>
          </Grid>
          <Field
            id="legal_address"
            label="Legal address"
            error={fieldErrors.legal_address?.[0]}
            editor={fieldEditors.legal_address}
          >
            <Textarea
              id="legal_address"
              rows={2}
              value={draft.legal_address}
              onChange={(e) => update("legal_address", e.target.value)}
              onFocus={() => focusField("legal_address")}
              onBlur={() => blurField("legal_address")}
            />
          </Field>
          <Grid cols={2}>
            <Field
              id="registration_number"
              label="Registration number"
              error={fieldErrors.registration_number?.[0]}
              editor={fieldEditors.registration_number}
            >
              <Input
                id="registration_number"
                value={draft.registration_number}
                onChange={(e) => update("registration_number", e.target.value)}
                onFocus={() => focusField("registration_number")}
                onBlur={() => blurField("registration_number")}
              />
            </Field>
            <Field
              id="tax_number"
              label="Tax / VAT number"
              error={fieldErrors.tax_number?.[0]}
              editor={fieldEditors.tax_number}
            >
              <Input
                id="tax_number"
                value={draft.tax_number}
                onChange={(e) => update("tax_number", e.target.value)}
                onFocus={() => focusField("tax_number")}
                onBlur={() => blurField("tax_number")}
              />
            </Field>
          </Grid>
        </Section>

        <Section icon={Wallet} title="Commercial terms">
          <Grid cols={3}>
            <Field
              id="currency_code"
              label="Currency"
              error={fieldErrors.currency_code?.[0]}
              editor={fieldEditors.currency_code}
            >
              <Input
                id="currency_code"
                value={draft.currency_code}
                onChange={(e) =>
                  update("currency_code", e.target.value.toUpperCase())
                }
                onFocus={() => focusField("currency_code")}
                onBlur={() => blurField("currency_code")}
                maxLength={3}
                className="font-mono"
                placeholder="GBP"
              />
            </Field>
            <Field
              id="default_lead_time_days"
              label="Default lead time (days)"
              error={fieldErrors.default_lead_time_days?.[0]}
              editor={fieldEditors.default_lead_time_days}
            >
              <Input
                id="default_lead_time_days"
                type="text"
                inputMode="numeric"
                value={draft.default_lead_time_days}
                onChange={(e) =>
                  update(
                    "default_lead_time_days",
                    e.target.value.replace(/\D/g, ""),
                  )
                }
                onFocus={() => focusField("default_lead_time_days")}
                onBlur={() => blurField("default_lead_time_days")}
                placeholder="14"
              />
            </Field>
            <Field
              id="tax_rate"
              label="Tax rate (%)"
              error={fieldErrors.tax_rate?.[0]}
              editor={fieldEditors.tax_rate}
            >
              <Input
                id="tax_rate"
                type="text"
                inputMode="decimal"
                value={draft.tax_rate}
                onChange={(e) => update("tax_rate", e.target.value)}
                onFocus={() => focusField("tax_rate")}
                onBlur={() => blurField("tax_rate")}
                placeholder="20"
              />
            </Field>
            <Field
              id="payment_terms_days"
              label="Payment term (days)"
              error={fieldErrors.payment_terms_days?.[0]}
              editor={fieldEditors.payment_terms_days}
            >
              <Input
                id="payment_terms_days"
                type="text"
                inputMode="numeric"
                value={draft.payment_terms_days}
                onChange={(e) =>
                  update(
                    "payment_terms_days",
                    e.target.value.replace(/\D/g, ""),
                  )
                }
                onFocus={() => focusField("payment_terms_days")}
                onBlur={() => blurField("payment_terms_days")}
                placeholder="30"
              />
            </Field>
            <Field
              id="payment_basis"
              label="Payment basis"
              error={fieldErrors.payment_basis?.[0]}
              editor={fieldEditors.payment_basis}
            >
              <Select
                value={draft.payment_basis}
                onValueChange={(v) =>
                  update("payment_basis", v as VendorPaymentBasis)
                }
              >
                <SelectTrigger
                  id="payment_basis"
                  className="h-9"
                  onFocus={() => focusField("payment_basis")}
                  onBlur={() => blurField("payment_basis")}
                >
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
              id="supply_chain_type"
              label="Supply chain type"
              error={fieldErrors.supply_chain_type?.[0]}
              editor={fieldEditors.supply_chain_type}
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
                <SelectTrigger
                  id="supply_chain_type"
                  className="h-9"
                  onFocus={() => focusField("supply_chain_type")}
                  onBlur={() => blurField("supply_chain_type")}
                >
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
            <Field
              id="vendor_risk"
              label="Risk class"
              error={fieldErrors.vendor_risk?.[0]}
              editor={fieldEditors.vendor_risk}
            >
              <Select
                value={draft.vendor_risk || UNSET}
                onValueChange={(v) =>
                  update("vendor_risk", v === UNSET ? "" : (v as VendorRisk))
                }
              >
                <SelectTrigger
                  id="vendor_risk"
                  className="h-9"
                  onFocus={() => focusField("vendor_risk")}
                  onBlur={() => blurField("vendor_risk")}
                >
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
              id="questionnaire_status"
              label="Questionnaire (SAQ)"
              error={fieldErrors.questionnaire_status?.[0]}
              editor={fieldEditors.questionnaire_status}
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
                <SelectTrigger
                  id="questionnaire_status"
                  className="h-9"
                  onFocus={() => focusField("questionnaire_status")}
                  onBlur={() => blurField("questionnaire_status")}
                >
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
              id="traceability_verification_status"
              label="Traceability verification"
              error={fieldErrors.traceability_verification_status?.[0]}
              editor={fieldEditors.traceability_verification_status}
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
                <SelectTrigger
                  id="traceability_verification_status"
                  className="h-9"
                  onFocus={() => focusField("traceability_verification_status")}
                  onBlur={() => blurField("traceability_verification_status")}
                >
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
              id="review_frequency_months"
              label="Review cadence (months)"
              error={fieldErrors.review_frequency_months?.[0]}
              editor={fieldEditors.review_frequency_months}
            >
              <Input
                id="review_frequency_months"
                type="text"
                inputMode="numeric"
                value={draft.review_frequency_months}
                onChange={(e) =>
                  update(
                    "review_frequency_months",
                    e.target.value.replace(/\D/g, ""),
                  )
                }
                onFocus={() => focusField("review_frequency_months")}
                onBlur={() => blurField("review_frequency_months")}
                placeholder="12"
              />
            </Field>
            <Field
              id="last_review_at"
              label="Last review date"
              error={fieldErrors.last_review_at?.[0]}
              editor={fieldEditors.last_review_at}
            >
              <Input
                id="last_review_at"
                type="date"
                value={draft.last_review_at}
                onChange={(e) => update("last_review_at", e.target.value)}
                onFocus={() => focusField("last_review_at")}
                onBlur={() => blurField("last_review_at")}
              />
            </Field>
            <Field
              id="next_review_at"
              label="Next review due"
              error={fieldErrors.next_review_at?.[0]}
              editor={fieldEditors.next_review_at}
            >
              <Input
                id="next_review_at"
                type="date"
                value={draft.next_review_at}
                onChange={(e) => update("next_review_at", e.target.value)}
                onFocus={() => focusField("next_review_at")}
                onBlur={() => blurField("next_review_at")}
              />
            </Field>
          </Grid>
          <Field
            id="product_types"
            label="Product types supplied (comma-separated)"
            error={fieldErrors.product_types?.[0]}
            editor={fieldEditors.product_types}
          >
            <Input
              id="product_types"
              value={draft.product_types}
              onChange={(e) => update("product_types", e.target.value)}
              onFocus={() => focusField("product_types")}
              onBlur={() => blurField("product_types")}
              placeholder="actives, excipients, packaging"
            />
          </Field>
        </Section>

        <Section icon={ClipboardCheck} title="Notes">
          <Field
            id="notes"
            label="Internal notes"
            error={fieldErrors.notes?.[0]}
            editor={fieldEditors.notes}
          >
            <Textarea
              id="notes"
              rows={3}
              value={draft.notes}
              onChange={(e) => update("notes", e.target.value)}
              onFocus={() => focusField("notes")}
              onBlur={() => blurField("notes")}
              placeholder="Anything procurement / QA should know about this supplier"
            />
          </Field>
        </Section>

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
                  can {vendor ? "save" : "create"} from this room. Your edits
                  sync to them live.
                </span>
              </div>
            )}
            <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/95 px-4 py-3 shadow-md backdrop-blur">
              <div className="text-xs text-muted-foreground">
                {vendor === null
                  ? "Filling in a new vendor."
                  : isDirty
                    ? `${dirtyKeys.length} change${dirtyKeys.length === 1 ? "" : "s"} ready.`
                    : "Make a change then Save."}
              </div>
              <div className="flex items-center gap-2">
                {isCreator && (
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
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={onSave}
                  disabled={
                    pending || !isCreator || (vendor !== null && !isDirty)
                  }
                  title={
                    isCreator
                      ? undefined
                      : creator
                        ? `Only ${creator.name} can ${vendor ? "save" : "create"} from this room.`
                        : undefined
                  }
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
          </>
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

function JoinErrorCard({
  error,
}: {
  error: import("@/lib/realtime/use-live-form").JoinError;
}) {
  const config = {
    form_full: {
      icon: AlertCircle,
      tone: "amber",
      title: `Form is at capacity`,
      detail: error.limit
        ? `Up to ${error.limit} people can edit this vendor at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      tone: "muted",
      title: "You can't edit here",
      detail:
        "Ask an admin for the `vendors.edit` permission to join this form.",
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
  id,
  label,
  required,
  error,
  editor,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  editor: import("@/lib/realtime/use-live-form").CollabPeer | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className="text-[11px] uppercase tracking-wider text-muted-foreground"
      >
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      <div className="relative">
        {children}
        <FieldEditingIndicator peer={editor} />
      </div>
      {error && (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
