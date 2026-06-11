"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  Trash2,
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
import { SignaturePad } from "@/components/forms/signature-pad";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/rbac";
import {
  deleteInspectionFileAction,
  signOperatorAction,
  signQualityAction,
  updateInspectionAction,
  uploadInspectionFileAction,
  upsertItemAction,
} from "@/lib/goods-in/actions";
import type {
  Inspection,
  InspectionFile,
  InspectionItem,
  MaterialDecision,
  PackagingCondition,
  QualityDecision,
  SectionBag,
  SectionCheck,
} from "@/lib/goods-in/types";
import type { ErrorDebug } from "@/lib/errors/types";
import type { PurchaseOrder, PurchaseOrderLine, User } from "@/lib/types";

/* ============ check-key registries ============ */

interface CheckRow {
  key: string;
  label: string;
}

const VEHICLE_CHECKS: CheckRow[] = [
  { key: "clean_and_hygienic", label: "Vehicle interior clean and hygienic" },
  { key: "no_signs_of_pests", label: "No signs of pest activity" },
  {
    key: "no_chemical_or_odour_contamination",
    label: "No chemical or strong odour contamination",
  },
  {
    key: "previous_cargo_acceptable",
    label: "Previous cargo acceptable / compatible",
  },
  { key: "structurally_sound", label: "Vehicle structurally sound" },
  { key: "seal_intact_or_na", label: "Seal intact (or N/A)" },
];

const DOC_CHECKS: CheckRow[] = [
  { key: "coa_received", label: "Certificate of Analysis received" },
  { key: "coa_matches_spec", label: "COA matches the agreed specification" },
  {
    key: "country_of_origin_verified",
    label: "Country of origin verified",
  },
  {
    key: "radiological_risk_acceptable",
    label: "Radiological risk acceptable for source country",
  },
  {
    key: "food_fraud_risk_acceptable",
    label: "Food-fraud risk acceptable",
  },
  { key: "delivery_matches_po", label: "Delivery matches the PO" },
];

const PHYSICAL_CHECKS: CheckRow[] = [
  { key: "packaging_intact", label: "Outer packaging intact" },
  { key: "no_foreign_materials", label: "No visible foreign materials" },
  { key: "correct_labelling", label: "Correct labelling on every unit" },
  { key: "tamper_evidence_intact", label: "Tamper-evidence intact" },
  { key: "correct_material", label: "Material matches what was ordered" },
];

const FOOD_SAFETY_CHECKS: CheckRow[] = [
  { key: "no_microbial_contamination", label: "No signs of microbial contamination" },
  {
    key: "no_chemical_contamination_signs",
    label: "No signs of chemical contamination",
  },
  {
    key: "no_physical_contamination",
    label: "No physical contamination (glass, metal, plastic)",
  },
  { key: "allergen_info_verified", label: "Allergen information verified" },
  {
    key: "no_signs_of_fraud_or_substitution",
    label: "No signs of fraud or substitution",
  },
  {
    key: "no_malicious_tampering_evidence",
    label: "No evidence of malicious tampering",
  },
];

const STORAGE_CHECKS: CheckRow[] = [
  {
    key: "quarantine_label_applied",
    label: "Quarantine label applied to every pack",
  },
  {
    key: "stored_in_designated_area",
    label: "Stored in the designated quarantine area",
  },
  {
    key: "allergen_segregation_maintained",
    label: "Allergen segregation maintained",
  },
  {
    key: "storage_conditions_acceptable",
    label: "Storage conditions acceptable (temp / humidity)",
  },
];

/* ============ step bookkeeping ============ */

type Step =
  | "delivery"
  | "vehicle"
  | "lines"
  | "documentation"
  | "physical"
  | "food_safety"
  | "storage"
  | "sign_off";

const STEPS: { id: Step; title: string }[] = [
  { id: "delivery", title: "Delivery information" },
  { id: "vehicle", title: "Vehicle inspection" },
  { id: "lines", title: "Per-line decisions" },
  { id: "documentation", title: "Documentation verification" },
  { id: "physical", title: "Physical inspection" },
  { id: "food_safety", title: "Food safety checks" },
  { id: "storage", title: "Storage verification" },
  { id: "sign_off", title: "Sign-off" },
];

type SectionKey =
  | "vehicle_inspection"
  | "documentation_verification"
  | "physical_inspection"
  | "food_safety_checks"
  | "storage_verification";

interface WizardError {
  detail: string;
  code?: string;
  debug?: ErrorDebug;
}

interface Props {
  inspection: Inspection;
  purchaseOrder: PurchaseOrder;
  viewer: User;
}

/**
 * The mobile Goods-In Inspection wizard. Walks the operator through
 * the 8 sections of the BRCGS 3.5.1 / FSSC 22000 incoming-inspection
 * record, saving each step as it goes so a dropped connection / paused
 * shift never loses data.
 *
 * Renders three modes based on `inspection.status`:
 *   * draft     — operator path: edit, sign as operator
 *   * submitted — approver path: read-only review + quality sign-off
 *                 (the operator sees the "awaiting quality approval"
 *                 confirmation screen instead)
 *   * terminal  — fully read-only summary
 */
export function MobileInspectionWizard({
  inspection: initial,
  purchaseOrder,
  viewer,
}: Props) {
  const router = useRouter();
  const [inspection, setInspection] = useState(initial);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState<WizardError | null>(null);
  const [saving, startSave] = useTransition();

  const lines = purchaseOrder.lines ?? [];

  // local drafts for fields the user is editing right now. We never
  // bind directly to `inspection` so an in-flight PATCH can't fight
  // the operator's typing.
  const [delivery, setDelivery] = useState({
    delivery_date: inspection.delivery_date ?? "",
    delivery_time: inspection.delivery_time ?? "",
    transport_company: inspection.transport_company ?? "",
    vehicle_registration: inspection.vehicle_registration ?? "",
    seal_number: inspection.seal_number ?? "",
  });

  const [vehicle, setVehicle] = useState<SectionBag>(
    inspection.vehicle_inspection ?? {},
  );
  const [documentation, setDocumentation] = useState<SectionBag>(
    inspection.documentation_verification ?? {},
  );
  const [physical, setPhysical] = useState<SectionBag>(
    inspection.physical_inspection ?? {},
  );
  const [foodSafety, setFoodSafety] = useState<SectionBag>(
    inspection.food_safety_checks ?? {},
  );
  const [storage, setStorage] = useState<SectionBag>(
    inspection.storage_verification ?? {},
  );

  const [items, setItems] = useState<Record<string, ItemDraft>>(
    () => buildInitialItems(lines, inspection.items),
  );

  const [operatorSignature, setOperatorSignature] = useState<string | null>(
    null,
  );

  // approver state (only used when status == submitted and viewer
  // has goods_in.approve).
  const [approverSignature, setApproverSignature] = useState<string | null>(
    null,
  );
  const [approverDecision, setApproverDecision] = useState<QualityDecision>(
    "approved",
  );
  const [approverReason, setApproverReason] = useState("");

  const canApprove =
    inspection.status === "submitted" &&
    hasPermission(viewer, "goods_in.approve") &&
    viewer.id !== inspection.goods_in_operator?.id;

  const showApprover =
    inspection.status === "submitted" && canApprove;

  const editing = inspection.status === "draft";

  const step = STEPS[stepIdx]!;

  const canAdvance = stepIdx < STEPS.length - 1;
  const canRetreat = stepIdx > 0;

  /* ============ persistence helpers ============ */

  function applyResultInspection(next: Inspection) {
    setInspection(next);
    setVehicle(next.vehicle_inspection ?? {});
    setDocumentation(next.documentation_verification ?? {});
    setPhysical(next.physical_inspection ?? {});
    setFoodSafety(next.food_safety_checks ?? {});
    setStorage(next.storage_verification ?? {});
    setItems(buildInitialItems(lines, next.items));
  }

  async function saveCurrentStep(): Promise<boolean> {
    setError(null);

    return new Promise((resolve) => {
      startSave(async () => {
        switch (step.id) {
          case "delivery": {
            if (!delivery.delivery_date) {
              setError({
                detail: "Pick a delivery date before continuing.",
                code: "missing_date",
              });
              resolve(false);
              return;
            }
            const res = await updateInspectionAction(inspection.uuid, {
              delivery_date: delivery.delivery_date,
              delivery_time: delivery.delivery_time || null,
              transport_company: delivery.transport_company || null,
              vehicle_registration: delivery.vehicle_registration || null,
              seal_number: delivery.seal_number || null,
            });
            if (!res.ok) {
              setError(res);
              resolve(false);
              return;
            }
            applyResultInspection(res.inspection);
            resolve(true);
            return;
          }
          case "vehicle":
            resolve(await saveSection("vehicle_inspection", vehicle));
            return;
          case "documentation":
            resolve(
              await saveSection("documentation_verification", documentation),
            );
            return;
          case "physical":
            resolve(await saveSection("physical_inspection", physical));
            return;
          case "food_safety":
            resolve(await saveSection("food_safety_checks", foodSafety));
            return;
          case "storage":
            resolve(await saveSection("storage_verification", storage));
            return;
          case "lines": {
            // upsert every line that has at least a qty + decision; we
            // do them serially so a single 422 surfaces with which line
            // was the offender rather than a Promise.all swallow.
            for (const line of lines) {
              const draft = items[line.uuid];
              if (!draft) continue;
              if (!draft.qty_received) {
                setError({
                  detail: `Enter a received qty for ${itemNameFor(line)}.`,
                  code: "missing_qty",
                });
                resolve(false);
                return;
              }
              if (
                draft.material_decision !== "accept" &&
                !draft.material_decision_reason
              ) {
                setError({
                  detail: `Add a reason for the ${draft.material_decision} decision on ${itemNameFor(line)}.`,
                  code: "missing_reason",
                });
                resolve(false);
                return;
              }
              const res = await upsertItemAction(inspection.uuid, line.uuid, {
                qty_received: draft.qty_received,
                packaging_condition: draft.packaging_condition || undefined,
                packaging_condition_notes:
                  draft.packaging_condition_notes || null,
                material_decision: draft.material_decision,
                material_decision_reason:
                  draft.material_decision_reason || null,
              });
              if (!res.ok) {
                setError(res);
                resolve(false);
                return;
              }
            }
            resolve(true);
            return;
          }
          case "sign_off":
            // operator sign-off uses a dedicated button on the step.
            resolve(true);
            return;
        }
      });
    });
  }

  async function saveSection(
    key: SectionKey,
    value: SectionBag,
  ): Promise<boolean> {
    // The BE requires at least one populated check per section to
    // operator-sign. Hand off an empty bag still PATCHes — it just
    // doesn't satisfy that gate later. Surface that here so the
    // operator knows before reaching sign-off.
    const filled = Object.keys(value).length > 0;
    if (!filled) {
      setError({
        detail: "Tick or note at least one check before continuing.",
        code: "section_empty",
      });
      return false;
    }
    const res = await updateInspectionAction(inspection.uuid, {
      section: key,
      value,
    });
    if (!res.ok) {
      setError(res);
      return false;
    }
    applyResultInspection(res.inspection);
    return true;
  }

  async function onNext() {
    const ok = await saveCurrentStep();
    if (!ok) return;
    if (canAdvance) {
      setStepIdx((i) => i + 1);
      window.scrollTo({ top: 0 });
    }
  }

  function onBack() {
    if (saving) return;
    if (canRetreat) {
      setStepIdx((i) => i - 1);
      window.scrollTo({ top: 0 });
    }
  }

  async function onSignOperator() {
    if (!operatorSignature) {
      setError({
        detail: "Draw your signature to continue.",
        code: "missing_signature",
      });
      return;
    }
    setError(null);
    startSave(async () => {
      const res = await signOperatorAction(inspection.uuid, operatorSignature);
      if (!res.ok) {
        setError(res);
        return;
      }
      applyResultInspection(res.inspection);
      router.refresh();
    });
  }

  async function onSignApprover() {
    if (!approverSignature) {
      setError({
        detail: "Draw your signature to continue.",
        code: "missing_signature",
      });
      return;
    }
    if (approverDecision !== "approved" && !approverReason.trim()) {
      setError({
        detail: "A reason is required for hold / reject decisions.",
        code: "missing_reason",
      });
      return;
    }
    setError(null);
    startSave(async () => {
      const res = await signQualityAction(
        inspection.uuid,
        approverSignature,
        approverDecision,
        approverReason.trim() || null,
      );
      if (!res.ok) {
        setError(res);
        return;
      }
      applyResultInspection(res.inspection);
      router.refresh();
    });
  }

  /* ============ render ============ */

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* sticky top header */}
      <header
        className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/60 bg-background/95 px-3 py-3 backdrop-blur"
        data-testid="wizard-header"
      >
        <Link
          href="/m"
          className="rounded-md p-1.5 text-muted-foreground active:bg-muted"
          aria-label="Back to home"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">
            {purchaseOrder.code ?? `PO #${purchaseOrder.id}`}
          </p>
          <p className="truncate text-sm font-semibold">
            {showApprover
              ? "Quality sign-off"
              : `Step ${stepIdx + 1}/${STEPS.length} · ${step.title}`}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            statusToneClass(inspection.status),
          )}
        >
          {inspection.status}
        </span>
      </header>

      {/* scrollable body */}
      <main className="flex-1 space-y-4 px-4 py-4">
        {error && (
          <ErrorBanner
            detail={error.detail}
            code={error.code}
            debug={error.debug}
          />
        )}

        {showApprover ? (
          <ApproverPanel
            inspection={inspection}
            lines={lines}
            decision={approverDecision}
            onDecision={setApproverDecision}
            reason={approverReason}
            onReason={setApproverReason}
            onSignatureChange={setApproverSignature}
          />
        ) : inspection.status === "draft" ? (
          renderStep()
        ) : (
          <ReadOnlySummary inspection={inspection} lines={lines} />
        )}

        <FileGallery
          inspection={inspection}
          editable={editing || inspection.status === "submitted"}
          onChange={(next) => setInspection({ ...inspection, files: next })}
        />
      </main>

      {/* sticky footer */}
      {(editing || showApprover) && (
        <footer className="sticky bottom-0 z-20 flex items-center gap-2 border-t border-border/60 bg-background/95 px-3 py-2 backdrop-blur">
          {showApprover ? (
            <Button
              size="lg"
              className="flex-1 gap-1"
              onClick={onSignApprover}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Sign and record decision
            </Button>
          ) : step.id === "sign_off" ? (
            <>
              <Button
                size="lg"
                variant="ghost"
                onClick={onBack}
                disabled={!canRetreat || saving}
                className="gap-1"
              >
                <ChevronLeft className="size-4" />
                Back
              </Button>
              <Button
                size="lg"
                className="flex-1 gap-1"
                onClick={onSignOperator}
                disabled={saving}
                data-testid="sign-operator"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Sign as operator
              </Button>
            </>
          ) : (
            <>
              <Button
                size="lg"
                variant="ghost"
                onClick={onBack}
                disabled={!canRetreat || saving}
                className="gap-1"
              >
                <ChevronLeft className="size-4" />
                Back
              </Button>
              <Button
                size="lg"
                className="flex-1 gap-1"
                onClick={onNext}
                disabled={saving}
                data-testid="wizard-next"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    Save &amp; continue
                    <ChevronRight className="size-4" />
                  </>
                )}
              </Button>
            </>
          )}
        </footer>
      )}
    </div>
  );

  /* ============ per-step panels ============ */

  function renderStep() {
    switch (step.id) {
      case "delivery":
        return (
          <section className="space-y-4" data-testid="step-delivery">
            <StepHeading title={step.title} />
            <div className="grid gap-3">
              <Field
                label="Delivery date"
                input={
                  <Input
                    type="date"
                    value={delivery.delivery_date}
                    onChange={(e) =>
                      setDelivery({
                        ...delivery,
                        delivery_date: e.target.value,
                      })
                    }
                    data-testid="delivery-date"
                  />
                }
              />
              <Field
                label="Delivery time"
                input={
                  <Input
                    type="time"
                    value={delivery.delivery_time}
                    onChange={(e) =>
                      setDelivery({
                        ...delivery,
                        delivery_time: e.target.value,
                      })
                    }
                  />
                }
              />
              <Field
                label="Transport company"
                input={
                  <Input
                    value={delivery.transport_company}
                    onChange={(e) =>
                      setDelivery({
                        ...delivery,
                        transport_company: e.target.value,
                      })
                    }
                    placeholder="Acme Logistics"
                  />
                }
              />
              <Field
                label="Vehicle registration"
                input={
                  <Input
                    value={delivery.vehicle_registration}
                    onChange={(e) =>
                      setDelivery({
                        ...delivery,
                        vehicle_registration: e.target.value,
                      })
                    }
                    placeholder="AB12 XYZ"
                  />
                }
              />
              <Field
                label="Seal number"
                input={
                  <Input
                    value={delivery.seal_number}
                    onChange={(e) =>
                      setDelivery({
                        ...delivery,
                        seal_number: e.target.value,
                      })
                    }
                    placeholder="Leave blank if none"
                  />
                }
              />
            </div>
          </section>
        );
      case "vehicle":
        return (
          <SectionPanel
            title={step.title}
            checks={VEHICLE_CHECKS}
            value={vehicle}
            onChange={setVehicle}
            testId="step-vehicle"
          />
        );
      case "documentation":
        return (
          <SectionPanel
            title={step.title}
            checks={DOC_CHECKS}
            value={documentation}
            onChange={setDocumentation}
            testId="step-documentation"
          />
        );
      case "physical":
        return (
          <SectionPanel
            title={step.title}
            checks={PHYSICAL_CHECKS}
            value={physical}
            onChange={setPhysical}
            testId="step-physical"
          />
        );
      case "food_safety":
        return (
          <SectionPanel
            title={step.title}
            checks={FOOD_SAFETY_CHECKS}
            value={foodSafety}
            onChange={setFoodSafety}
            testId="step-food-safety"
          />
        );
      case "storage":
        return (
          <SectionPanel
            title={step.title}
            checks={STORAGE_CHECKS}
            value={storage}
            onChange={setStorage}
            testId="step-storage"
          />
        );
      case "lines":
        return (
          <section className="space-y-4" data-testid="step-lines">
            <StepHeading title={step.title} />
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This PO has no lines.
              </p>
            ) : (
              lines.map((line) => (
                <LineCard
                  key={line.uuid}
                  line={line}
                  value={items[line.uuid]!}
                  onChange={(next) =>
                    setItems((prev) => ({ ...prev, [line.uuid]: next }))
                  }
                />
              ))
            )}
          </section>
        );
      case "sign_off":
        return (
          <section className="space-y-4" data-testid="step-sign-off">
            <StepHeading title={step.title} />
            <p className="text-sm text-muted-foreground">
              Review the previous steps via Back if you need to fix
              anything. Once you sign, the inspection moves to{" "}
              <span className="font-medium text-foreground">submitted</span>{" "}
              and waits for quality approval — you won&apos;t be able to
              edit checks or line decisions after that.
            </p>
            <SignaturePad
              onChange={setOperatorSignature}
              placeholder="Sign as goods-in operator"
            />
          </section>
        );
    }
  }
}

/* ============ sub-components ============ */

function StepHeading({ title }: { title: string }) {
  return (
    <h2 className="text-base font-semibold">{title}</h2>
  );
}

function Field({
  label,
  input,
}: {
  label: string;
  input: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {input}
    </div>
  );
}

function SectionPanel({
  title,
  checks,
  value,
  onChange,
  testId,
}: {
  title: string;
  checks: CheckRow[];
  value: SectionBag;
  onChange: (next: SectionBag) => void;
  testId: string;
}) {
  function update(key: string, patch: Partial<SectionCheck>) {
    const prev: SectionCheck = value[key] ?? { passed: true, notes: null };
    onChange({ ...value, [key]: { ...prev, ...patch } });
  }
  return (
    <section className="space-y-4" data-testid={testId}>
      <StepHeading title={title} />
      <div className="space-y-3">
        {checks.map((check) => {
          const row: SectionCheck | undefined = value[check.key];
          const passed = row?.passed ?? null;
          const inputId = `${testId}-${check.key}`;
          return (
            <div
              key={check.key}
              className="space-y-2 rounded-lg border border-border/60 bg-card p-3"
              data-testid={`check-${check.key}`}
            >
              <p className="text-sm font-medium leading-snug">{check.label}</p>
              <div className="flex gap-2" role="radiogroup" aria-label={check.label}>
                <Button
                  type="button"
                  size="sm"
                  variant={passed === true ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => update(check.key, { passed: true })}
                  data-testid={`${inputId}-yes`}
                >
                  Yes
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={passed === false ? "destructive" : "outline"}
                  className="flex-1"
                  onClick={() => update(check.key, { passed: false })}
                  data-testid={`${inputId}-no`}
                >
                  No
                </Button>
              </div>
              <Textarea
                value={row?.notes ?? ""}
                placeholder={
                  passed === false
                    ? "Describe the issue (required for No)"
                    : "Notes (optional)"
                }
                rows={2}
                onChange={(e) =>
                  update(check.key, { notes: e.target.value || null })
                }
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface ItemDraft {
  qty_received: string;
  packaging_condition: PackagingCondition | "";
  packaging_condition_notes: string;
  material_decision: MaterialDecision;
  material_decision_reason: string;
}

function buildInitialItems(
  lines: PurchaseOrderLine[],
  existing: InspectionItem[],
): Record<string, ItemDraft> {
  const byLineUuid = new Map<string, InspectionItem>();
  for (const item of existing) {
    if (item.purchase_order_line_uuid) {
      byLineUuid.set(item.purchase_order_line_uuid, item);
    }
  }
  const out: Record<string, ItemDraft> = {};
  for (const line of lines) {
    const match = byLineUuid.get(line.uuid);
    out[line.uuid] = {
      qty_received: match?.qty_received ?? line.qty_ordered ?? "",
      packaging_condition: (match?.packaging_condition as PackagingCondition) ?? "",
      packaging_condition_notes: match?.packaging_condition_notes ?? "",
      material_decision: match?.material_decision ?? "accept",
      material_decision_reason: match?.material_decision_reason ?? "",
    };
  }
  return out;
}

function lineMatchesItem(item: InspectionItem, line: PurchaseOrderLine): boolean {
  return item.purchase_order_line_uuid === line.uuid;
}

function LineCard({
  line,
  value,
  onChange,
}: {
  line: PurchaseOrderLine;
  value: ItemDraft;
  onChange: (next: ItemDraft) => void;
}) {
  function set<K extends keyof ItemDraft>(key: K, v: ItemDraft[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div
      className="space-y-3 rounded-lg border border-border/60 bg-card p-3"
      data-testid={`line-${line.uuid}`}
    >
      <div>
        <p className="text-sm font-semibold leading-tight">
          {itemNameFor(line)}
        </p>
        <p className="text-xs text-muted-foreground">
          Ordered: {line.qty_ordered}
        </p>
      </div>
      <Field
        label="Qty received"
        input={
          <Input
            type="text"
            inputMode="decimal"
            value={value.qty_received}
            onChange={(e) => set("qty_received", e.target.value)}
            data-testid={`line-${line.uuid}-qty`}
          />
        }
      />
      <Field
        label="Packaging condition"
        input={
          <Select
            value={value.packaging_condition || undefined}
            onValueChange={(v) => set("packaging_condition", v as PackagingCondition)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="good">Good</SelectItem>
              <SelectItem value="damaged">Damaged</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      {value.packaging_condition === "damaged" && (
        <Field
          label="Packaging notes"
          input={
            <Textarea
              rows={2}
              value={value.packaging_condition_notes}
              onChange={(e) =>
                set("packaging_condition_notes", e.target.value)
              }
            />
          }
        />
      )}
      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Material decision
        </Label>
        <div
          className="mt-1 grid grid-cols-3 gap-2"
          role="radiogroup"
          aria-label="Material decision"
        >
          {(["accept", "hold", "reject"] as const).map((d) => (
            <Button
              key={d}
              type="button"
              variant={value.material_decision === d ? "default" : "outline"}
              size="sm"
              onClick={() => set("material_decision", d)}
              data-testid={`line-${line.uuid}-decision-${d}`}
            >
              {d}
            </Button>
          ))}
        </div>
      </div>
      {value.material_decision !== "accept" && (
        <Field
          label="Reason"
          input={
            <Textarea
              rows={2}
              value={value.material_decision_reason}
              onChange={(e) =>
                set("material_decision_reason", e.target.value)
              }
              placeholder="Required for hold / reject"
              data-testid={`line-${line.uuid}-reason`}
            />
          }
        />
      )}
    </div>
  );
}

function itemNameFor(line: PurchaseOrderLine): string {
  return line.item?.name ?? line.vendor_part_no ?? `Line ${line.uuid.slice(0, 6)}`;
}

function ApproverPanel({
  inspection,
  lines,
  decision,
  onDecision,
  reason,
  onReason,
  onSignatureChange,
}: {
  inspection: Inspection;
  lines: PurchaseOrderLine[];
  decision: QualityDecision;
  onDecision: (d: QualityDecision) => void;
  reason: string;
  onReason: (r: string) => void;
  onSignatureChange: (s: string | null) => void;
}) {
  return (
    <section className="space-y-4" data-testid="approver-panel">
      <header>
        <h2 className="text-base font-semibold">Review and approve</h2>
        <p className="text-xs text-muted-foreground">
          Signed by operator{" "}
          {inspection.goods_in_operator?.name ?? "—"} on{" "}
          {inspection.goods_in_operator_signed_at?.slice(0, 10) ?? "—"}.
        </p>
      </header>

      <ReadOnlySummary inspection={inspection} lines={lines} />

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Decision
        </Label>
        <div
          className="grid grid-cols-3 gap-2"
          role="radiogroup"
          aria-label="Quality decision"
        >
          {(["approved", "hold", "rejected"] as const).map((d) => (
            <Button
              key={d}
              type="button"
              size="sm"
              variant={decision === d ? "default" : "outline"}
              onClick={() => onDecision(d)}
              data-testid={`approver-decision-${d}`}
            >
              {d}
            </Button>
          ))}
        </div>
      </div>

      {decision !== "approved" && (
        <Field
          label="Reason"
          input={
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => onReason(e.target.value)}
              placeholder="Required for hold / reject"
              data-testid="approver-reason"
            />
          }
        />
      )}

      <SignaturePad
        onChange={onSignatureChange}
        placeholder="Sign as quality approver"
      />
    </section>
  );
}

function ReadOnlySummary({
  inspection,
  lines,
}: {
  inspection: Inspection;
  lines: PurchaseOrderLine[];
}) {
  const sections: Array<{ key: SectionKey; title: string; checks: CheckRow[] }> = [
    { key: "vehicle_inspection", title: "Vehicle inspection", checks: VEHICLE_CHECKS },
    {
      key: "documentation_verification",
      title: "Documentation verification",
      checks: DOC_CHECKS,
    },
    { key: "physical_inspection", title: "Physical inspection", checks: PHYSICAL_CHECKS },
    {
      key: "food_safety_checks",
      title: "Food safety checks",
      checks: FOOD_SAFETY_CHECKS,
    },
    { key: "storage_verification", title: "Storage verification", checks: STORAGE_CHECKS },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/60 bg-card p-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Delivery
        </p>
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Date</dt>
          <dd>{inspection.delivery_date ?? "—"}</dd>
          <dt className="text-muted-foreground">Time</dt>
          <dd>{inspection.delivery_time ?? "—"}</dd>
          <dt className="text-muted-foreground">Transport</dt>
          <dd>{inspection.transport_company ?? "—"}</dd>
          <dt className="text-muted-foreground">Vehicle</dt>
          <dd>{inspection.vehicle_registration ?? "—"}</dd>
          <dt className="text-muted-foreground">Seal</dt>
          <dd>{inspection.seal_number ?? "—"}</dd>
        </dl>
      </div>
      {sections.map(({ key, title, checks }) => (
        <SummarySection
          key={key}
          title={title}
          checks={checks}
          bag={inspection[key] ?? {}}
        />
      ))}
      <div className="rounded-lg border border-border/60 bg-card p-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Per-line decisions
        </p>
        <ul className="mt-1 space-y-1.5 text-xs">
          {lines.map((line) => {
            const dec = inspection.items.find((it) =>
              lineMatchesItem(it, line),
            );
            return (
              <li key={line.uuid} className="flex items-start gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {itemNameFor(line)}
                </span>
                <span className="text-muted-foreground">
                  {dec?.qty_received ?? "—"} · {dec?.material_decision ?? "—"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function SummarySection({
  title,
  checks,
  bag,
}: {
  title: string;
  checks: CheckRow[];
  bag: SectionBag;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <ul className="mt-1 space-y-1 text-xs">
        {checks.map((c) => {
          const row = bag[c.key];
          return (
            <li key={c.key} className="flex items-start gap-2">
              <span className="min-w-0 flex-1">{c.label}</span>
              <span
                className={cn(
                  "shrink-0 text-[10px] font-medium",
                  row?.passed === true && "text-emerald-600",
                  row?.passed === false && "text-destructive",
                  row == null && "text-muted-foreground",
                )}
              >
                {row?.passed === true
                  ? "Yes"
                  : row?.passed === false
                    ? "No"
                    : "—"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FileGallery({
  inspection,
  editable,
  onChange,
}: {
  inspection: Inspection;
  editable: boolean;
  onChange: (files: InspectionFile[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLocalError(null);
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", file.type === "application/pdf" ? "coa" : "photo");
    const res = await uploadInspectionFileAction(inspection.uuid, fd);
    setUploading(false);
    if (e.target) e.target.value = "";
    if (!res.ok) {
      setLocalError(res.detail);
      return;
    }
    onChange([...inspection.files, res.file]);
  }

  async function remove(fileUuid: string) {
    const res = await deleteInspectionFileAction(inspection.uuid, fileUuid);
    if (!res.ok) {
      setLocalError(res.detail);
      return;
    }
    onChange(inspection.files.filter((f) => f.uuid !== fileUuid));
  }

  return (
    <section
      className="space-y-2 rounded-lg border border-dashed border-border bg-card/30 p-3"
      data-testid="file-gallery"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Photos &amp; documents
        </p>
        {editable && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            data-testid="add-photo"
          >
            {uploading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Camera className="size-3.5" />
            )}
            Add photo
          </Button>
        )}
      </div>
      {localError && (
        <p className="text-xs text-destructive">{localError}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={onUpload}
      />
      {inspection.files.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No attachments yet.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {inspection.files.map((f) => (
            <li
              key={f.uuid}
              className="relative overflow-hidden rounded border border-border/60 bg-background"
              data-testid={`file-${f.uuid}`}
            >
              {f.mime.startsWith("image/") ? (
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block aspect-square w-full"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.url}
                    alt={f.filename}
                    className="size-full object-cover"
                  />
                </a>
              ) : (
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex aspect-square w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
                >
                  <ImageIcon className="size-5" />
                  {f.kind.toUpperCase()}
                </a>
              )}
              {editable && (
                <button
                  type="button"
                  className="absolute right-1 top-1 rounded-full bg-background/85 p-1 text-muted-foreground active:bg-destructive active:text-destructive-foreground"
                  onClick={() => remove(f.uuid)}
                  aria-label={`Remove ${f.filename}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function statusToneClass(status: Inspection["status"]): string {
  switch (status) {
    case "draft":
      return "bg-muted text-muted-foreground";
    case "submitted":
      return "bg-amber-100 text-amber-800";
    case "approved":
      return "bg-emerald-100 text-emerald-800";
    case "hold":
      return "bg-yellow-100 text-yellow-800";
    case "rejected":
      return "bg-destructive/15 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}
