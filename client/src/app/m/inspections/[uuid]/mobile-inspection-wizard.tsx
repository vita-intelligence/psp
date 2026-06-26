"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  Plus,
  Printer,
  ShieldCheck,
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
import { CountryPicker } from "@/components/forms/country-picker";
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
import { sendQuarantineLabelAction } from "@/lib/realtime/actions";
import type {
  Inspection,
  InspectionFile,
  InspectionItem,
  InspectionItemPack,
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
  /** Renders an extra N/A button on the row. Use only for checks that
   *  legitimately don't apply on some loads (e.g. seal intact when the
   *  vendor didn't seal the trailer). */
  na_allowed?: boolean;
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
  { key: "seal_intact_or_na", label: "Seal intact", na_allowed: true },
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
  | "quarantine_label"
  | "sign_off";

const STEPS: { id: Step; title: string }[] = [
  { id: "delivery", title: "Delivery information" },
  { id: "vehicle", title: "Vehicle inspection" },
  { id: "lines", title: "Per-line decisions" },
  { id: "documentation", title: "Documentation verification" },
  { id: "physical", title: "Physical inspection" },
  { id: "food_safety", title: "Food safety checks" },
  { id: "storage", title: "Storage verification" },
  { id: "quarantine_label", title: "Quarantine labels" },
  { id: "sign_off", title: "Sign-off" },
];

type SectionKey =
  | "vehicle_inspection"
  | "documentation_verification"
  | "physical_inspection"
  | "food_safety_checks"
  | "storage_verification";

// Mirror of the per-section check arrays, keyed by SectionKey so the
// save-time "every check must be answered" gate can look up the
// expected keys without threading them through every panel prop.
const SECTION_CHECKS_FOR: Record<SectionKey, CheckRow[]> = {
  vehicle_inspection: VEHICLE_CHECKS,
  documentation_verification: DOC_CHECKS,
  physical_inspection: PHYSICAL_CHECKS,
  food_safety_checks: FOOD_SAFETY_CHECKS,
  storage_verification: STORAGE_CHECKS,
};

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
  // Sub-step inside the "lines" step — the PO can have many lines, and
  // stacking them on one phone screen drowns the operator. We render
  // ONE line at a time and bounce through them with the same footer
  // Back / Next buttons. Reset to the first line whenever the operator
  // re-enters the lines step from outside.
  const [lineIdx, setLineIdx] = useState(0);
  const [error, setError] = useState<WizardError | null>(null);
  const [saving, startSave] = useTransition();

  const lines = purchaseOrder.lines ?? [];

  // local drafts for fields the user is editing right now. We never
  // bind directly to `inspection` so an in-flight PATCH can't fight
  // the operator's typing.
  // Delivery time prefills to "now" when the draft hasn't captured one
  // yet — the receiver is timestamping the moment the truck pulls in,
  // so typing `HH:MM` by hand is just friction. The lazy initialiser
  // means we compute it once at mount, not on every render.
  const [delivery, setDelivery] = useState(() => ({
    delivery_date: inspection.delivery_date ?? "",
    delivery_time: inspection.delivery_time ?? currentLocalTime(),
    transport_company: inspection.transport_company ?? "",
    vehicle_registration: inspection.vehicle_registration ?? "",
    seal_number: inspection.seal_number ?? "",
  }));

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

  // Same user may carry both signatures — the regulatory framework
  // we follow allows a qualified user to act as both operator and
  // approver. The audit trail still captures the two signatures +
  // timestamps separately on the row.
  const canApprove =
    inspection.status === "submitted" &&
    hasPermission(viewer, "goods_in.approve");

  const showApprover =
    inspection.status === "submitted" && canApprove;

  const editing = inspection.status === "draft";

  const step = STEPS[stepIdx]!;

  const canAdvance = stepIdx < STEPS.length - 1;

  // Reset the inner line index whenever the operator enters or leaves
  // the "lines" step. This means stepping back from a later step
  // re-enters at line 1 — explicit but simple.
  useEffect(() => {
    if (step.id === "lines") setLineIdx(0);
  }, [step.id]);

  // Local-draft persistence ------------------------------------------------
  // The wizard only PATCHes the BE when the operator hits "Save & continue"
  // / "Save & next product". A refresh or accidental tab close in the middle
  // of typing pack dimensions used to wipe everything. Mirror the local
  // state into localStorage so the operator can pick up exactly where
  // they left off — keyed by inspection uuid, capped at 24 h so a stale
  // draft from yesterday doesn't override a clean inspection.
  const draftKey = useMemo(
    () => `psp:inspection-draft:${inspection.uuid}`,
    [inspection.uuid],
  );
  const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
  const draftLoadedRef = useRef(false);

  useEffect(() => {
    if (draftLoadedRef.current) return;
    draftLoadedRef.current = true;
    if (typeof window === "undefined") return;
    if (inspection.status !== "draft") return;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        delivery?: typeof delivery;
        vehicle?: SectionBag;
        documentation?: SectionBag;
        physical?: SectionBag;
        foodSafety?: SectionBag;
        storage?: SectionBag;
        items?: Record<string, ItemDraft>;
        stepIdx?: number;
        lineIdx?: number;
        savedAt?: number;
      };
      if (!draft.savedAt || Date.now() - draft.savedAt > DRAFT_TTL_MS) {
        window.localStorage.removeItem(draftKey);
        return;
      }
      if (draft.delivery) setDelivery(draft.delivery);
      if (draft.vehicle) setVehicle(draft.vehicle);
      if (draft.documentation) setDocumentation(draft.documentation);
      if (draft.physical) setPhysical(draft.physical);
      if (draft.foodSafety) setFoodSafety(draft.foodSafety);
      if (draft.storage) setStorage(draft.storage);
      if (draft.items) setItems(draft.items);
      if (typeof draft.stepIdx === "number") setStepIdx(draft.stepIdx);
      if (typeof draft.lineIdx === "number") setLineIdx(draft.lineIdx);
    } catch {
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        // Storage blocked entirely (private browsing). Nothing to do.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Once the operator signs (status !== draft) the BE owns the truth.
    // Clear any leftover draft so a later draft re-open starts fresh.
    if (inspection.status !== "draft") {
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        // ignore quota / private-mode failures
      }
      return;
    }
    const handle = setTimeout(() => {
      try {
        window.localStorage.setItem(
          draftKey,
          JSON.stringify({
            delivery,
            vehicle,
            documentation,
            physical,
            foodSafety,
            storage,
            items,
            stepIdx,
            lineIdx,
            savedAt: Date.now(),
          }),
        );
      } catch {
        // Quota exceeded / Safari private mode — silent fail is fine,
        // the BE save path still works on Save & continue.
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [
    inspection.status,
    draftKey,
    delivery,
    vehicle,
    documentation,
    physical,
    foodSafety,
    storage,
    items,
    stepIdx,
    lineIdx,
  ]);

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
            // Compliance: delivery paperwork drives traceability. The
            // seal number is the only optional field — vendors don't
            // always seal loads. Everything else has to be on the row.
            const missing: string[] = [];
            if (!delivery.delivery_date) missing.push("delivery date");
            if (!delivery.delivery_time) missing.push("delivery time");
            if (!delivery.transport_company.trim())
              missing.push("transport company");
            if (!delivery.vehicle_registration.trim())
              missing.push("vehicle registration");
            if (missing.length > 0) {
              setError({
                detail: `Fill in the required field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
                code: "missing_delivery_fields",
              });
              resolve(false);
              return;
            }
            const res = await updateInspectionAction(inspection.uuid, {
              delivery_date: delivery.delivery_date,
              delivery_time: delivery.delivery_time,
              transport_company: delivery.transport_company.trim(),
              vehicle_registration: delivery.vehicle_registration.trim(),
              seal_number: delivery.seal_number.trim() || null,
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
          case "quarantine_label":
            // Action-only step — printing is fire-and-forget to the
            // laptop, no inspection state changes here. Advance
            // unconditionally so the operator can move on whether or
            // not they actually printed anything.
            resolve(true);
            return;
          case "lines": {
            // One product per save — the operator advances through
            // lines via the footer Next button, and we upsert that
            // single line on each advance. Stops the operator from
            // hitting a wall when line 5 is broken but lines 1-4 are
            // already good (previous behaviour PATCHed every line on
            // every Next and surfaced the first failure each time).
            const line = lines[lineIdx];
            if (!line) {
              resolve(true);
              return;
            }
            const draft = items[line.uuid];
            if (!draft) {
              setError({
                detail: `Add at least one complete pack (qty + dimensions + weight + manufactured + expiry) for ${itemNameFor(line)}.`,
                code: "missing_packs",
              });
              resolve(false);
              return;
            }
            const completePacks = draft.packs.filter(isPackComplete);
            if (completePacks.length === 0) {
              setError({
                detail: `Add at least one complete pack (qty + dimensions + weight + manufactured + expiry) for ${itemNameFor(line)}.`,
                code: "missing_packs",
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
            const packs = completePacks.map(packDraftToWire);
            const totalQty = sumCompletePackQty(completePacks);
            const res = await upsertItemAction(inspection.uuid, line.uuid, {
              // BE re-derives qty_received from `packs` server-side
              // (see `reconcile_qty_from_packs`); we send our local
              // sum so legacy callers + the changeset's required
              // validation are both happy.
              qty_received: String(totalQty),
              packs,
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
    // Compliance: every check must be actively confirmed (Yes / No /
    // N/A where allowed). Operators who scroll past defaults are the
    // #1 source of empty audit rows, so we block here rather than
    // letting them through to sign-off and bouncing.
    const checks = SECTION_CHECKS_FOR[key];
    const unanswered = checks.filter((c) => {
      const row = value[c.key];
      if (!row) return true;
      const isYes = row.passed === true && row.na !== true;
      const isNo = row.passed === false;
      const isNa = row.na === true;
      return !(isYes || isNo || isNa);
    });
    if (unanswered.length > 0) {
      setError({
        detail: `Answer every check before continuing — ${unanswered.length} still ${unanswered.length === 1 ? "needs" : "need"} a response.`,
        code: "section_unanswered",
      });
      return false;
    }
    // Compliance: a "No" answer without a written reason is a dead
    // audit row. Block save until each negative answer has notes —
    // mirrors the per-row red-border rendered in SectionPanel.
    const missingReasons = Object.entries(value)
      .filter(([, row]) => row.passed === false && !(row.notes ?? "").trim())
      .map(([k]) => k);
    if (missingReasons.length > 0) {
      setError({
        detail: `Write a note explaining the "No" answer${missingReasons.length === 1 ? "" : "s"} before continuing.`,
        code: "missing_no_notes",
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
    // Inside the lines step we walk through products one at a time
    // before advancing the wizard. The footer button doubles as a
    // "Next product" until we reach the last line.
    if (step.id === "lines" && lineIdx < lines.length - 1) {
      setLineIdx((i) => i + 1);
      window.scrollTo({ top: 0 });
      return;
    }
    if (canAdvance) {
      setStepIdx((i) => i + 1);
      window.scrollTo({ top: 0 });
    }
  }

  function onBackStep() {
    // Walk back through line indices first if we're inside the lines
    // step. Same logic as onNext mirrored: the footer Back button
    // behaves as "Previous product" until we hit line 0, then it
    // steps the outer wizard.
    if (step.id === "lines" && lineIdx > 0) {
      setLineIdx((i) => i - 1);
      window.scrollTo({ top: 0 });
      return;
    }
    if (stepIdx === 0) return;
    setStepIdx((i) => i - 1);
    window.scrollTo({ top: 0 });
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
        {/* Header button always exits to the PO pre-receive page —
            label says "Exit" so the operator never confuses it with
            "back one step" (that lives in the footer). Explicit push
            to /m/incoming/<uuid> instead of router.back() so a deep
            link (QR scan straight into the wizard) still lands on
            the right page rather than off the site. */}
        <button
          type="button"
          onClick={() => router.push(`/m/incoming/${purchaseOrder.uuid}`)}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground active:bg-muted"
          aria-label="Exit inspection"
        >
          <ChevronLeft className="size-4" />
          <span>Exit</span>
        </button>
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
            viewer={viewer}
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

      {/* sticky footer — Back / forward navigation lives here so the
          operator's reach is consistent (header chevron = exit, footer
          = move through the wizard). Back is hidden on the approver
          panel because that's a single decision, not a step ladder. */}
      {(editing || showApprover) && (
        <footer className="sticky bottom-0 z-20 flex items-center gap-2 border-t border-border/60 bg-background/95 px-3 py-2 backdrop-blur">
          {!showApprover && (
            <Button
              size="lg"
              variant="outline"
              className="gap-1"
              onClick={onBackStep}
              disabled={
                saving ||
                (stepIdx === 0 &&
                  !(step.id === "lines" && lineIdx > 0))
              }
              data-testid="wizard-back"
            >
              <ChevronLeft className="size-4" />
              Back
            </Button>
          )}
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
          ) : (
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
                  {step.id === "lines" && lineIdx < lines.length - 1
                    ? "Save & next product"
                    : "Save & continue"}
                  <ChevronRight className="size-4" />
                </>
              )}
            </Button>
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
                required
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
                required
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
                required
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
                required
                input={
                  <Input
                    value={delivery.vehicle_registration}
                    onChange={(e) =>
                      setDelivery({
                        ...delivery,
                        vehicle_registration: e.target.value.toUpperCase(),
                      })
                    }
                    className="uppercase"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="AB12 XYZ"
                  />
                }
              />
              <Field
                label="Seal number"
                hint="Leave blank if the load wasn't sealed."
                input={
                  <Input
                    value={delivery.seal_number}
                    onChange={(e) =>
                      setDelivery({
                        ...delivery,
                        seal_number: e.target.value,
                      })
                    }
                    placeholder="e.g. 8472193"
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
      case "lines": {
        const currentLine = lines[lineIdx];
        return (
          <section className="space-y-4" data-testid="step-lines">
            <StepHeading title={step.title} />
            {lines.length === 0 || !currentLine ? (
              <p className="text-sm text-muted-foreground">
                This PO has no lines.
              </p>
            ) : (
              <>
                {/* Sub-step progress — operator can see they're on
                    line 2 of 4 without parsing pack rows. Pills show
                    each line at a glance: green = saved on BE, brand
                    = current, grey = pending. */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-muted-foreground">
                      Product {lineIdx + 1} of {lines.length}
                    </span>
                    <span className="text-muted-foreground/70">
                      {itemNameFor(currentLine)}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {lines.map((l, i) => {
                      const submitted = (inspection.items ?? []).some(
                        (it) => it.purchase_order_line_uuid === l.uuid,
                      );
                      return (
                        <span
                          key={l.uuid}
                          aria-hidden
                          className={cn(
                            "h-1.5 flex-1 rounded-full transition-colors",
                            i === lineIdx
                              ? "bg-brand"
                              : submitted
                                ? "bg-emerald-500/70"
                                : "bg-border",
                          )}
                        />
                      );
                    })}
                  </div>
                </div>
                <LineCard
                  key={currentLine.uuid}
                  line={currentLine}
                  value={items[currentLine.uuid]!}
                  onChange={(next) =>
                    setItems((prev) => ({
                      ...prev,
                      [currentLine.uuid]: next,
                    }))
                  }
                />
              </>
            )}
          </section>
        );
      }
      case "quarantine_label":
        return (
          <QuarantineLabelPanel
            inspection={inspection}
            lines={lines}
            items={items}
          />
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

// Local wall-clock "HH:MM" — the shape `<input type="time">` expects.
function currentLocalTime(): string {
  const d = new Date();
  return [
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
  ].join(":");
}

function Field({
  label,
  input,
  required,
  hint,
}: {
  label: string;
  input: React.ReactNode;
  required?: boolean;
  /** One-line clarifier under the label (e.g. "leave blank if none"). */
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {required && (
          <span aria-hidden className="text-destructive">
            *
          </span>
        )}
        {!required && (
          <span className="text-[10px] normal-case tracking-normal text-muted-foreground/70">
            (optional)
          </span>
        )}
      </Label>
      {input}
      {hint && (
        <p className="text-[10px] leading-tight text-muted-foreground/80">
          {hint}
        </p>
      )}
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
  // A row is "answered" once the operator has actively picked Yes,
  // No, or N/A. Compliance rule: the operator must confirm every
  // check, even the good ones — they can't skip past defaults.
  function setAnswer(key: string, answer: "yes" | "no" | "na") {
    const prev: SectionCheck =
      value[key] ?? { passed: true, notes: null, na: false };
    const next: SectionCheck =
      answer === "yes"
        ? { ...prev, passed: true, na: false }
        : answer === "no"
          ? { ...prev, passed: false, na: false }
          : // N/A — keep passed: true so legacy readers still see
            // "not a failure"; the na flag flips display + skips the
            // notes-required gate.
            { ...prev, passed: true, na: true, notes: null };
    onChange({ ...value, [key]: next });
  }
  function setNotes(key: string, notes: string) {
    const prev: SectionCheck =
      value[key] ?? { passed: true, notes: null, na: false };
    onChange({ ...value, [key]: { ...prev, notes: notes || null } });
  }
  return (
    <section className="space-y-4" data-testid={testId}>
      <StepHeading title={title} />
      <p className="text-[11px] text-muted-foreground">
        Confirm every check — Yes, No, or N/A where allowed. Notes are
        required when the answer is No.
      </p>
      <div className="space-y-3">
        {checks.map((check) => {
          const row: SectionCheck | undefined = value[check.key];
          const isYes = !!row && row.passed === true && row.na !== true;
          const isNo = !!row && row.passed === false;
          const isNa = !!row && row.na === true;
          const answered = isYes || isNo || isNa;
          const noNeedsNotes = isNo && !(row?.notes ?? "").trim();
          const showRowError = !answered || noNeedsNotes;
          const inputId = `${testId}-${check.key}`;
          return (
            <div
              key={check.key}
              className={cn(
                "space-y-2 rounded-lg border bg-card p-3",
                showRowError
                  ? "border-destructive/60"
                  : "border-border/60",
              )}
              data-testid={`check-${check.key}`}
            >
              <p className="text-sm font-medium leading-snug">
                {check.label}
                <span aria-hidden className="ml-1 text-destructive">
                  *
                </span>
              </p>
              <div
                className="flex gap-2"
                role="radiogroup"
                aria-label={check.label}
              >
                <Button
                  type="button"
                  size="sm"
                  variant={isYes ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setAnswer(check.key, "yes")}
                  data-testid={`${inputId}-yes`}
                >
                  Yes
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={isNo ? "destructive" : "outline"}
                  className="flex-1"
                  onClick={() => setAnswer(check.key, "no")}
                  data-testid={`${inputId}-no`}
                >
                  No
                </Button>
                {check.na_allowed && (
                  <Button
                    type="button"
                    size="sm"
                    variant={isNa ? "secondary" : "outline"}
                    className="flex-1"
                    onClick={() => setAnswer(check.key, "na")}
                    data-testid={`${inputId}-na`}
                  >
                    N/A
                  </Button>
                )}
              </div>
              {/* Notes textarea is only useful for No (mandatory) or
                  Yes (optional context). Hide for N/A to keep the
                  row compact — N/A means "doesn't apply", a note
                  would just be noise. */}
              {!isNa && (
                <Textarea
                  value={row?.notes ?? ""}
                  placeholder={
                    isNo
                      ? "Describe the issue — required for No"
                      : "Notes (optional)"
                  }
                  rows={2}
                  onChange={(e) => setNotes(check.key, e.target.value)}
                  className={cn(
                    noNeedsNotes &&
                      "border-destructive focus-visible:ring-destructive/40",
                  )}
                />
              )}
              {!answered && (
                <p className="text-[11px] font-medium text-destructive">
                  Answer required — pick Yes, No
                  {check.na_allowed && ", or N/A"}.
                </p>
              )}
              {noNeedsNotes && (
                <p className="text-[11px] font-medium text-destructive">
                  A note explaining the issue is required for No.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface PackDraft {
  tempId: string;
  qty: string;
  package_length_mm: string;
  package_width_mm: string;
  package_height_mm: string;
  package_weight_kg: string;
  units_per_package: string;
  /** Max number of identical packs the warehouse may stack on top of
   *  each other for safety. Defaults to "1" (no vertical stacking)
   *  for fragile / non-stackable goods. Persisted on the produced
   *  stock_lot so cell-suitability + cell-fill use the operator's
   *  safety cap. */
  stack_factor: string;
  supplier_batch_no: string;
  /** ISO 3166-1 alpha-2. Empty until the operator picks. */
  country_of_origin: string;
  revision: string;
  /** ISO date "YYYY-MM-DD" — `<input type="date">` shape. */
  manufactured_at: string;
  expiry_at: string;
}

interface ItemDraft {
  packs: PackDraft[];
  packaging_condition: PackagingCondition | "";
  packaging_condition_notes: string;
  material_decision: MaterialDecision;
  material_decision_reason: string;
}

function newPackId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pack-${Math.random().toString(36).slice(2, 10)}`;
}

function makeDefaultPack(qty: string = ""): PackDraft {
  return {
    tempId: newPackId(),
    qty,
    package_length_mm: "",
    package_width_mm: "",
    package_height_mm: "",
    package_weight_kg: "",
    // Internal — one wizard row = one physical pack, so the row's
    // qty IS the pack's capacity. Server-side reconciles this when
    // the operator just types a qty (see `packDraftToWire`).
    units_per_package: "",
    // Default to "no vertical stacking" — the safest assumption for
    // an unknown product. Operator bumps this up for stackable goods
    // (sacks, boxes) once they've measured the pack.
    stack_factor: "1",
    supplier_batch_no: "",
    country_of_origin: "",
    revision: "",
    manufactured_at: "",
    expiry_at: "",
  };
}

// A pack is "complete" when every numeric field has a usable value.
// Sums + sign-off only consider complete packs so the operator can
// have a half-typed extra row in flight without it blocking save.
// `units_per_package` is auto-derived from qty on the wire (one
// editor row = one physical pack), so it's not in the gate.
// Manufactured + expiry are required: shelf-life math + FEFO
// downstream depend on them, and an audit will ask for both.
function isPackComplete(p: PackDraft): boolean {
  return (
    Number(p.qty) > 0 &&
    Number(p.package_length_mm) > 0 &&
    Number(p.package_width_mm) > 0 &&
    Number(p.package_height_mm) > 0 &&
    Number(p.package_weight_kg) > 0 &&
    Number.isInteger(Number(p.stack_factor)) &&
    Number(p.stack_factor) > 0 &&
    p.manufactured_at.trim() !== "" &&
    p.expiry_at.trim() !== ""
  );
}

function sumCompletePackQty(packs: PackDraft[]): number {
  return packs.filter(isPackComplete).reduce((acc, p) => acc + Number(p.qty), 0);
}

// Running total of every pack that has a positive qty typed, regardless
// of whether dimensions / dates have caught up. The cross-check strip
// on the line header uses this so operators see the number tick up the
// moment they enter a qty rather than waiting for the whole pack row
// to be complete.
function sumTypedPackQty(packs: PackDraft[]): number {
  return packs.reduce((acc, p) => {
    const n = Number(p.qty);
    return n > 0 ? acc + n : acc;
  }, 0);
}

function packDraftToWire(p: PackDraft): InspectionItemPack {
  const qty = Number(p.qty);
  // One editor row = one physical pack, so units_per_package = qty.
  // The schema's `packages = qty / units_per_package` formula then
  // resolves to exactly 1 pack per row, matching the operator's
  // mental model. If the operator explicitly typed something
  // different in `units_per_package` we honour it (advanced case:
  // "5 identical drums in 1 row" → qty=125, units_per_package=25).
  const explicitUpp = Number(p.units_per_package);
  const unitsPerPackage =
    Number.isFinite(explicitUpp) && explicitUpp > 0 ? explicitUpp : qty;

  const stackFactor = Number(p.stack_factor);
  return {
    qty: String(qty),
    package_length_mm: Number(p.package_length_mm),
    package_width_mm: Number(p.package_width_mm),
    package_height_mm: Number(p.package_height_mm),
    package_weight_kg: String(Number(p.package_weight_kg)),
    units_per_package: unitsPerPackage,
    stack_factor:
      Number.isInteger(stackFactor) && stackFactor > 0 ? stackFactor : 1,
    supplier_batch_no: p.supplier_batch_no.trim() || null,
    country_of_origin: p.country_of_origin.trim().toUpperCase() || null,
    revision: p.revision.trim() || null,
    manufactured_at: p.manufactured_at || null,
    expiry_at: p.expiry_at || null,
  };
}

// Re-hydrate operator drafts from the server payload. When an
// inspection was saved previously we get its `packs` list back and
// each becomes one editable row; legacy rows without packs (or a
// brand-new line) get a single empty pack so the operator has
// something to fill in.
function hydratePacks(item: InspectionItem | undefined): PackDraft[] {
  if (item && Array.isArray(item.packs) && item.packs.length > 0) {
    return item.packs.map((p) => ({
      tempId: newPackId(),
      qty: p.qty != null ? String(p.qty) : "",
      package_length_mm:
        p.package_length_mm != null ? String(p.package_length_mm) : "",
      package_width_mm:
        p.package_width_mm != null ? String(p.package_width_mm) : "",
      package_height_mm:
        p.package_height_mm != null ? String(p.package_height_mm) : "",
      package_weight_kg:
        p.package_weight_kg != null ? String(p.package_weight_kg) : "",
      units_per_package:
        p.units_per_package != null ? String(p.units_per_package) : "1",
      stack_factor: p.stack_factor != null ? String(p.stack_factor) : "1",
      supplier_batch_no: p.supplier_batch_no ?? "",
      country_of_origin: p.country_of_origin ?? "",
      revision: p.revision ?? "",
      manufactured_at: p.manufactured_at ?? "",
      expiry_at: p.expiry_at ?? "",
    }));
  }
  return [makeDefaultPack()];
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
      packs: hydratePacks(match),
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

  function patchPack(tempId: string, patch: Partial<PackDraft>) {
    set(
      "packs",
      value.packs.map((p) => (p.tempId === tempId ? { ...p, ...patch } : p)),
    );
  }

  function addPack() {
    set("packs", [...value.packs, makeDefaultPack()]);
  }

  function removePack(tempId: string) {
    if (value.packs.length === 1) return;
    set(
      "packs",
      value.packs.filter((p) => p.tempId !== tempId),
    );
  }

  const uomSymbol =
    line.item?.stock_uom?.symbol ?? line.item?.stock_uom?.code ?? null;
  const qtyOrdered = Number(line.qty_ordered) || 0;
  // Cross-check header runs off the typed total so the number ticks
  // up the moment the operator enters a qty — they don't need to fill
  // every dimension before seeing what they've recorded so far. The
  // pack-completeness gate at save-time still uses the strict
  // `isPackComplete` view.
  const totalReceived = sumTypedPackQty(value.packs);
  const completeCount = value.packs.filter(isPackComplete).length;

  // Diff vs PO — informational only, the wizard still allows a partial
  // or over-receive (those are real-world cases and the QC decision
  // captures the verdict). We just nudge the operator visually so an
  // off-count gets a second look before sign-off.
  const diffTone: "ok" | "warn" =
    totalReceived === qtyOrdered ? "ok" : "warn";
  const overReceived = totalReceived > qtyOrdered;
  const shortBy = qtyOrdered - totalReceived;
  const overBy = totalReceived - qtyOrdered;
  const itemCode = line.item?.code ?? null;

  return (
    <div
      className="space-y-3 rounded-lg border border-border/60 bg-card p-3"
      data-testid={`line-${line.uuid}`}
    >
      {/* Item header — big enough to read across the warehouse floor,
          with the PO-expected vs running-received numbers side-by-
          side so the cross-check is unmissable. Sticky just under the
          wizard header so the operator keeps the target qty in sight
          while scrolling through pack rows. The 56-px offset matches
          the wizard header's height; bg-background/95 + backdrop blur
          keep the content beneath readable as it slides under. */}
      <div
        className="sticky z-10 space-y-2 rounded-md border border-border/60 bg-background/95 p-3 shadow-sm backdrop-blur"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 56px)" }}
      >
        <div className="space-y-0.5">
          <p className="text-base font-semibold leading-tight">
            {itemNameFor(line)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {itemCode ? `${itemCode}` : null}
            {itemCode && line.vendor_part_no ? " · " : null}
            {line.vendor_part_no ? `Vendor: ${line.vendor_part_no}` : null}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Ordered
            </p>
            <p className="text-xl font-bold tabular-nums leading-tight">
              {qtyOrdered}
              {uomSymbol ? (
                <span className="ml-1 text-xs font-medium text-muted-foreground">
                  {uomSymbol}
                </span>
              ) : null}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Received so far
            </p>
            <p
              className={cn(
                "text-xl font-bold tabular-nums leading-tight",
                diffTone === "ok"
                  ? "text-emerald-700 dark:text-emerald-400"
                  : overReceived
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-foreground",
              )}
            >
              {totalReceived}
              {uomSymbol ? (
                <span className="ml-1 text-xs font-medium text-muted-foreground">
                  {uomSymbol}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        {diffTone === "ok" ? (
          <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
            Matches the PO.
          </p>
        ) : overReceived ? (
          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
            Over by {overBy}
            {uomSymbol ? ` ${uomSymbol}` : ""}. Confirm before signing.
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Still short by {shortBy}
            {uomSymbol ? ` ${uomSymbol}` : ""}.
          </p>
        )}
      </div>

      {/* Packs — one row per physical pack. Each becomes its own
          stock_lot on QC approval, mirroring the manual-lot creation
          flow. PO has 50 kg, arrived as 25 kg × 2 bags → two pack
          rows. */}
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Packs received
        </Label>
        <p className="text-[11px] leading-snug text-muted-foreground">
          One row per physical pack you received. If the PO is 50 kg
          and the truck dropped two 25 kg drums, that's two rows of
          25 each. Tap{" "}
          <span className="font-medium text-foreground">+ Add pack</span>{" "}
          for more.
        </p>
        {value.packs.map((p, idx) => (
          <PackEditor
            key={p.tempId}
            index={idx}
            pack={p}
            uomSymbol={uomSymbol}
            removable={value.packs.length > 1}
            onPatch={(patch) => patchPack(p.tempId, patch)}
            onRemove={() => removePack(p.tempId)}
          />
        ))}
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addPack}
            className="gap-1"
          >
            <Plus className="size-3.5" />
            Add pack
          </Button>
          <p
            className={cn(
              "text-[11px]",
              diffTone === "ok"
                ? "text-muted-foreground"
                : "text-amber-700 dark:text-amber-300",
            )}
          >
            Total {totalReceived}
            {uomSymbol ? ` ${uomSymbol}` : ""} · {completeCount}/{value.packs.length} pack
            {value.packs.length === 1 ? "" : "s"} complete
          </p>
        </div>
      </div>

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

/**
 * Tiny isometric preview of the pack the operator is describing.
 * Renders progressively:
 *
 *   - 0 dims filled: 3 dashed axis guides from the origin with "—"
 *     labels so the operator can see what L / W / H even refer to.
 *   - 1 dim filled: that axis goes solid + shows the mm value; the
 *     other two stay dashed and labelled "—".
 *   - 2 dims filled: the matching face (front / floor / side) is
 *     drawn as an outline so the operator can read the shape.
 *   - 3 dims filled: full iso box, re-stacked vertically by the
 *     stack factor.
 *
 * Pure SVG, brand-coloured via currentColor — fast on the dock wifi.
 */
function PackBoxPreview({
  lengthMm,
  widthMm,
  heightMm,
  stack,
}: {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  stack: number;
}) {
  const hasW = widthMm > 0;
  const hasL = lengthMm > 0;
  const hasH = heightMm > 0;
  const allFilled = hasW && hasL && hasH;
  const anyFilled = hasW || hasL || hasH;
  const stackN = Math.max(1, Math.min(Math.round(stack || 1), 6));
  const stackOverflow = (stack || 1) > 6;
  const effectiveStack = allFilled ? stackN : 1;

  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);

  // Scale: use the largest typed dim as the reference so the box
  // fills the card. Unfilled axes get a fallback visual length so the
  // guides are still informative when the operator has typed nothing.
  const filledMax = Math.max(widthMm, lengthMm, heightMm);
  const baseScale = filledMax > 0 ? 65 / filledMax : 0.13;
  const fallbackLen = filledMax > 0 ? filledMax * baseScale * 0.55 : 40;

  let w = hasW ? widthMm * baseScale : fallbackLen;
  let h = hasH ? heightMm * baseScale : fallbackLen;
  let d = hasL ? lengthMm * baseScale : fallbackLen;
  let ix = d * cos30 * 0.55;
  let iy = d * sin30 * 0.55;
  // Cap stacked column height so a tall pack + 6× stack doesn't blow
  // out the card.
  const maxColumnH = 115;
  const columnH = h * effectiveStack + iy;
  if (columnH > maxColumnH) {
    const f = maxColumnH / columnH;
    w *= f;
    h *= f;
    ix *= f;
    iy *= f;
  }

  const padX = 22;
  const padY = 22;
  const svgW = w + ix + padX * 2;
  const svgH = h * effectiveStack + iy + padY * 2;
  const originX = padX;
  const originY = svgH - padY;

  // Convenience for axis tip coords.
  const wTipX = originX + w;
  const wTipY = originY;
  const hTipX = originX;
  const hTipY = originY - h * effectiveStack;
  const lTipX = originX + ix;
  const lTipY = originY - iy;

  return (
    <div className="rounded-md border border-border/60 bg-muted/10 p-2">
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Pack preview
        </span>
        <span className="text-[10px] text-muted-foreground/80 tabular-nums">
          {hasL ? lengthMm : "—"} × {hasW ? widthMm : "—"} ×{" "}
          {hasH ? heightMm : "—"} mm
          {allFilled && stackN > 1 ? ` · stack ${stack}` : ""}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="mx-auto block h-32 w-full text-brand"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <defs>
          <marker
            id="pack-arrow-solid"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
          <marker
            id="pack-arrow-ghost"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path
              d="M0,0 L10,5 L0,10 z"
              fill="currentColor"
              fillOpacity="0.4"
            />
          </marker>
        </defs>

        {/* Full iso box (only when all three dims are known) */}
        {allFilled &&
          Array.from({ length: effectiveStack }, (_, i) => {
            const yBase = originY - i * h;
            const yTop = yBase - h;
            const front = `M${originX},${yBase} L${originX + w},${yBase} L${originX + w},${yTop} L${originX},${yTop} Z`;
            const top = `M${originX},${yTop} L${originX + w},${yTop} L${originX + w + ix},${yTop - iy} L${originX + ix},${yTop - iy} Z`;
            const right = `M${originX + w},${yBase} L${originX + w + ix},${yBase - iy} L${originX + w + ix},${yTop - iy} L${originX + w},${yTop} Z`;
            return (
              <g key={i}>
                <path
                  d={right}
                  fill="currentColor"
                  fillOpacity="0.45"
                  stroke="currentColor"
                  strokeOpacity="0.75"
                  strokeWidth="0.75"
                />
                <path
                  d={top}
                  fill="currentColor"
                  fillOpacity="0.3"
                  stroke="currentColor"
                  strokeOpacity="0.75"
                  strokeWidth="0.75"
                />
                <path
                  d={front}
                  fill="currentColor"
                  fillOpacity="0.65"
                  stroke="currentColor"
                  strokeOpacity="0.85"
                  strokeWidth="0.75"
                />
              </g>
            );
          })}

        {/* 2-of-3 face hints — drawn only when the full box can't be */}
        {!allFilled && hasW && hasH && !hasL && (
          <path
            d={`M${originX},${originY} L${originX + w},${originY} L${originX + w},${originY - h} L${originX},${originY - h} Z`}
            fill="currentColor"
            fillOpacity="0.18"
            stroke="currentColor"
            strokeOpacity="0.7"
            strokeWidth="1"
          />
        )}
        {!allFilled && hasW && hasL && !hasH && (
          <path
            d={`M${originX},${originY} L${originX + w},${originY} L${originX + w + ix},${originY - iy} L${originX + ix},${originY - iy} Z`}
            fill="currentColor"
            fillOpacity="0.18"
            stroke="currentColor"
            strokeOpacity="0.7"
            strokeWidth="1"
          />
        )}
        {!allFilled && hasL && hasH && !hasW && (
          <path
            d={`M${originX},${originY} L${originX + ix},${originY - iy} L${originX + ix},${originY - h - iy} L${originX},${originY - h} Z`}
            fill="currentColor"
            fillOpacity="0.18"
            stroke="currentColor"
            strokeOpacity="0.7"
            strokeWidth="1"
          />
        )}

        {/* Axis guides — always rendered. Solid when the dim is
            typed, dashed when still unknown so the operator can see
            what direction L / W / H point in. */}
        <line
          x1={originX}
          y1={originY}
          x2={wTipX}
          y2={wTipY}
          stroke="currentColor"
          strokeWidth={hasW ? "1.25" : "1"}
          strokeOpacity={hasW ? "0.95" : "0.45"}
          strokeDasharray={hasW ? "" : "3 3"}
          markerEnd={hasW ? "url(#pack-arrow-solid)" : "url(#pack-arrow-ghost)"}
        />
        <line
          x1={originX}
          y1={originY}
          x2={hTipX}
          y2={hTipY}
          stroke="currentColor"
          strokeWidth={hasH ? "1.25" : "1"}
          strokeOpacity={hasH ? "0.95" : "0.45"}
          strokeDasharray={hasH ? "" : "3 3"}
          markerEnd={hasH ? "url(#pack-arrow-solid)" : "url(#pack-arrow-ghost)"}
        />
        <line
          x1={originX}
          y1={originY}
          x2={lTipX}
          y2={lTipY}
          stroke="currentColor"
          strokeWidth={hasL ? "1.25" : "1"}
          strokeOpacity={hasL ? "0.95" : "0.45"}
          strokeDasharray={hasL ? "" : "3 3"}
          markerEnd={hasL ? "url(#pack-arrow-solid)" : "url(#pack-arrow-ghost)"}
        />

        {/* Origin dot so the operator can see all three axes start
            from the same corner. */}
        <circle
          cx={originX}
          cy={originY}
          r="1.8"
          fill="currentColor"
          fillOpacity="0.85"
        />

        {/* Axis labels — opacity follows the filled state so the
            "—" placeholders read as secondary. */}
        <text
          x={originX + w / 2}
          y={originY + 13}
          textAnchor="middle"
          fontSize="9"
          fill="currentColor"
          fillOpacity={hasW ? "0.95" : "0.55"}
        >
          W {hasW ? widthMm : "—"}
        </text>
        <text
          x={lTipX + 4}
          y={lTipY - 2}
          textAnchor="start"
          fontSize="9"
          fill="currentColor"
          fillOpacity={hasL ? "0.95" : "0.55"}
        >
          L {hasL ? lengthMm : "—"}
        </text>
        <text
          x={originX - 4}
          y={originY - (h * effectiveStack) / 2 + 3}
          textAnchor="end"
          fontSize="9"
          fill="currentColor"
          fillOpacity={hasH ? "0.95" : "0.55"}
        >
          H {hasH ? heightMm : "—"}
          {allFilled && effectiveStack > 1 ? `×${effectiveStack}` : ""}
        </text>
      </svg>
      {!anyFilled && (
        <p className="px-1 pt-1 text-[10px] text-muted-foreground">
          Type any dimension to see it appear.
        </p>
      )}
      {stackOverflow && allFilled && (
        <p className="px-1 pt-1 text-[10px] text-amber-700 dark:text-amber-300">
          Stack factor {stack} — preview is capped at 6 for clarity.
        </p>
      )}
    </div>
  );
}

function PackEditor({
  index,
  pack,
  uomSymbol,
  removable,
  onPatch,
  onRemove,
}: {
  index: number;
  pack: PackDraft;
  uomSymbol: string | null;
  removable: boolean;
  onPatch: (patch: Partial<PackDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pack {index + 1}
        </span>
        {removable && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove pack ${index + 1}`}
            className="rounded p-1 text-muted-foreground active:bg-destructive/10 active:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PackInput
          label={
            uomSymbol ? `Product in pack (${uomSymbol})` : "Product in pack"
          }
          value={pack.qty}
          onChange={(v) => onPatch({ qty: v })}
          placeholder="25"
          mode="decimal"
          helper="How much product this single pack/drum holds"
        />
        <PackInput
          label="Pack weight (kg)"
          value={pack.package_weight_kg}
          onChange={(v) => onPatch({ package_weight_kg: v })}
          placeholder="25.000"
          mode="decimal"
          helper="Total weight of the loaded pack"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <PackInput
          label="L (mm)"
          value={pack.package_length_mm}
          onChange={(v) => onPatch({ package_length_mm: v.replace(/\D/g, "") })}
          placeholder="400"
          mode="integer"
        />
        <PackInput
          label="W (mm)"
          value={pack.package_width_mm}
          onChange={(v) => onPatch({ package_width_mm: v.replace(/\D/g, "") })}
          placeholder="300"
          mode="integer"
        />
        <PackInput
          label="H (mm)"
          value={pack.package_height_mm}
          onChange={(v) => onPatch({ package_height_mm: v.replace(/\D/g, "") })}
          placeholder="250"
          mode="integer"
        />
      </div>

      <div className="grid grid-cols-1 gap-2">
        <PackInput
          label="Stack factor"
          value={pack.stack_factor}
          onChange={(v) =>
            onPatch({ stack_factor: v.replace(/\D/g, "") || "" })
          }
          placeholder="1"
          mode="integer"
          helper="Max packs that can be safely stacked on top of each other (1 = no vertical stacking)"
        />
      </div>

      {/* Live 3D preview of what the operator just typed. Updates as
          L / W / H / stack change so a fat-finger on a dimension is
          visually obvious (a 3000 mm pack on a 3-stack reads as a
          tower well before the operator hits Save). */}
      <PackBoxPreview
        lengthMm={Number(pack.package_length_mm) || 0}
        widthMm={Number(pack.package_width_mm) || 0}
        heightMm={Number(pack.package_height_mm) || 0}
        stack={Number(pack.stack_factor) || 1}
      />

      <div className="grid grid-cols-1 gap-2">
        <PackInput
          label="Batch (opt)"
          value={pack.supplier_batch_no}
          onChange={(v) => onPatch({ supplier_batch_no: v })}
          placeholder="BA-001"
          mode="text"
          mono
        />
      </div>

      {/* Traceability fields — manufactured + expiry come off the
          pack label and drive shelf-life / FEFO downstream. Required
          so the operator can't skip a date that audit will ask for.
          Stacked one-per-line on mobile so the date wheels have
          room and the labels never truncate. */}
      <div className="grid grid-cols-1 gap-2">
        <PackInput
          label="Manufactured date"
          value={pack.manufactured_at}
          onChange={(v) => onPatch({ manufactured_at: v })}
          mode="date"
          required
        />
        <PackInput
          label="Expiry date"
          value={pack.expiry_at}
          onChange={(v) => onPatch({ expiry_at: v })}
          mode="date"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Country of origin
          </span>
          <CountryPicker
            value={pack.country_of_origin || null}
            onChange={(code) => onPatch({ country_of_origin: code ?? "" })}
            placeholder="Pick country…"
            compact
          />
        </label>
        <PackInput
          label="Revision (opt)"
          value={pack.revision}
          onChange={(v) => onPatch({ revision: v })}
          placeholder="V01"
          mode="text"
          mono
        />
      </div>
    </div>
  );
}

function PackInput({
  label,
  value,
  onChange,
  placeholder,
  mode,
  mono,
  helper,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mode: "decimal" | "integer" | "text" | "date";
  mono?: boolean;
  /** Optional one-line clarification under the input. Use when the
   *  label alone could be misread (e.g. "Pack weight" vs "Product in
   *  pack" — both are kg numbers, the helper disambiguates). */
  helper?: string;
  /** Show a destructive asterisk on the label so the operator knows
   *  this one blocks "Save & continue". The pack-completeness gate
   *  on the lines step is what actually enforces it. */
  required?: boolean;
}) {
  return (
    <label className="block space-y-0.5">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {required && (
          <span aria-hidden className="text-destructive">
            *
          </span>
        )}
      </span>
      <Input
        type={mode === "date" ? "date" : "text"}
        inputMode={
          mode === "integer"
            ? "numeric"
            : mode === "decimal"
              ? "decimal"
              : undefined
        }
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={cn("h-9 text-sm", mono && "font-mono")}
      />
      {helper && (
        <span className="block text-[10px] leading-tight text-muted-foreground/80">
          {helper}
        </span>
      )}
    </label>
  );
}

function itemNameFor(line: PurchaseOrderLine): string {
  return line.item?.name ?? line.vendor_part_no ?? `Line ${line.uuid.slice(0, 6)}`;
}

// Pack-level "Send to laptop" panel. Each row is one physical pack the
// operator captured in the Per-line step; tapping Send fires a
// `print_label` event through the realtime bridge that the operator's
// own laptop session listens for. The laptop pops a print-copies
// dialog and opens the PDF in a new tab.
function QuarantineLabelPanel({
  inspection,
  lines,
  items,
}: {
  inspection: Inspection;
  lines: PurchaseOrderLine[];
  items: Record<string, ItemDraft>;
}) {
  // Flatten every complete pack across every line into one print
  // queue. Incomplete drafts are silently skipped so the operator
  // can't accidentally print a half-typed pack with no dimensions.
  const printable = useMemo(
    () => buildPrintablePacksFromDrafts(lines, items),
    [lines, items],
  );

  return (
    <section className="space-y-4" data-testid="step-quarantine-label">
      <StepHeading title="Quarantine labels" />
      <p className="text-sm text-muted-foreground">
        Print a quarantine label for every pack you received. Tap{" "}
        <span className="font-medium text-foreground">Send to laptop</span>{" "}
        and the print dialog will pop up on your laptop — pick copies
        and hit print.
      </p>

      <PrintablePackList
        inspectionUuid={inspection.uuid}
        packs={printable}
        emptyState={
          <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center">
            <p className="text-sm font-medium">No packs captured yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Go back to{" "}
              <span className="font-medium text-foreground">Per-line decisions</span>{" "}
              and add packs before printing labels.
            </p>
          </div>
        }
      />
    </section>
  );
}

// Normalised printable-pack shape — what `<PrintablePackList />`
// renders, agnostic to whether the source is editable drafts (wizard
// step) or server-returned inspection items (read-only summary).
interface PrintablePack {
  key: string;
  lineUuid: string;
  packIndex: number;
  packCount: number;
  itemName: string;
  qty: string;
  uomSymbol: string | null;
  packLengthMm: number | string;
  packWidthMm: number | string;
  packHeightMm: number | string;
  supplierBatchNo: string | null;
}

function buildPrintablePacksFromDrafts(
  lines: PurchaseOrderLine[],
  items: Record<string, ItemDraft>,
): PrintablePack[] {
  const out: PrintablePack[] = [];
  for (const line of lines) {
    const draft = items[line.uuid];
    if (!draft) continue;
    const completeCount = draft.packs.filter(isPackComplete).length;
    draft.packs.forEach((pack, idx) => {
      if (!isPackComplete(pack)) return;
      out.push({
        key: `${line.uuid}:${idx}`,
        lineUuid: line.uuid,
        packIndex: idx,
        packCount: completeCount,
        itemName: itemNameFor(line),
        qty: pack.qty,
        uomSymbol:
          line.item?.stock_uom?.symbol ?? line.item?.stock_uom?.code ?? null,
        packLengthMm: pack.package_length_mm,
        packWidthMm: pack.package_width_mm,
        packHeightMm: pack.package_height_mm,
        supplierBatchNo: pack.supplier_batch_no || null,
      });
    });
  }
  return out;
}

// Server-side hydration: walks every InspectionItem's saved `packs`
// array. Used by the read-only summary so the operator can re-print
// labels after the inspection's been submitted — they're locked out
// of edits but a missed label print is still a real recovery flow.
function buildPrintablePacksFromInspection(
  inspection: Inspection,
  lines: PurchaseOrderLine[],
): PrintablePack[] {
  const linesByUuid = new Map(lines.map((l) => [l.uuid, l]));
  const out: PrintablePack[] = [];
  for (const item of inspection.items) {
    const lineUuid = item.purchase_order_line_uuid;
    if (!lineUuid) continue;
    const line = linesByUuid.get(lineUuid);
    const itemName = line ? itemNameFor(line) : "Unknown item";
    const uomSymbol =
      line?.item?.stock_uom?.symbol ?? line?.item?.stock_uom?.code ?? null;
    const packs = Array.isArray(item.packs) ? item.packs : [];
    const packCount = packs.length;
    packs.forEach((pack, idx) => {
      out.push({
        key: `${lineUuid}:${idx}`,
        lineUuid,
        packIndex: idx,
        packCount,
        itemName,
        qty: String(pack.qty ?? ""),
        uomSymbol,
        packLengthMm: pack.package_length_mm,
        packWidthMm: pack.package_width_mm,
        packHeightMm: pack.package_height_mm,
        supplierBatchNo: pack.supplier_batch_no || null,
      });
    });
  }
  return out;
}

function PrintablePackList({
  inspectionUuid,
  packs,
  emptyState,
}: {
  inspectionUuid: string;
  packs: PrintablePack[];
  emptyState: ReactNode;
}) {
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [sentKeys, setSentKeys] = useState<Set<string>>(new Set());

  async function send(p: PrintablePack) {
    if (sendingKey === p.key) return;
    setSendingKey(p.key);
    try {
      const res = await sendQuarantineLabelAction({
        inspection_uuid: inspectionUuid,
        line_uuid: p.lineUuid,
        pack_index: p.packIndex,
        pack_count: p.packCount,
        item_name: p.itemName,
        qty: p.qty,
        uom_symbol: p.uomSymbol,
        supplier_batch_no: p.supplierBatchNo,
      });
      if (res.ok) {
        setSentKeys((prev) => new Set(prev).add(p.key));
        toast.success("Sent to laptop", {
          description: `${p.itemName} · pack ${p.packIndex + 1}`,
        });
      } else {
        toast.error("Couldn't reach the laptop", { description: res.detail });
      }
    } finally {
      setSendingKey(null);
    }
  }

  if (packs.length === 0) return <>{emptyState}</>;

  return (
    <ul className="space-y-2">
      {packs.map((p) => {
        const sent = sentKeys.has(p.key);
        const sending = sendingKey === p.key;
        return (
          <li
            key={p.key}
            className="rounded-xl border border-border/60 bg-card p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate text-sm font-semibold">
                  {p.itemName}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Pack {p.packIndex + 1} of {p.packCount} ·{" "}
                  <span className="font-mono">{p.qty}</span>
                  {p.uomSymbol ? ` ${p.uomSymbol}` : ""} ·{" "}
                  <span className="font-mono">
                    {p.packLengthMm}×{p.packWidthMm}×{p.packHeightMm}
                  </span>{" "}
                  mm
                </p>
                {p.supplierBatchNo && (
                  <p className="font-mono text-[11px] text-muted-foreground">
                    Batch: {p.supplierBatchNo}
                  </p>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                variant={sent ? "outline" : "default"}
                onClick={() => send(p)}
                disabled={sending}
                className="shrink-0 gap-1"
              >
                {sending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : sent ? (
                  <Check className="size-3.5" />
                ) : (
                  <Printer className="size-3.5" />
                )}
                {sending ? "Sending…" : sent ? "Sent" : "Send to laptop"}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ApproverPanel({
  inspection,
  lines,
  viewer,
  decision,
  onDecision,
  reason,
  onReason,
  onSignatureChange,
}: {
  inspection: Inspection;
  lines: PurchaseOrderLine[];
  viewer: User;
  decision: QualityDecision;
  onDecision: (d: QualityDecision) => void;
  reason: string;
  onReason: (r: string) => void;
  onSignatureChange: (s: string | null) => void;
}) {
  // Surface dual-role explicitly when the same user is about to sign
  // both ends. Allowed by our regulatory framework but worth flagging
  // so the operator-as-approver knows the second signature still
  // counts as an independent ESIGN event for the audit trail.
  const isSelfApproval =
    inspection.goods_in_operator?.id != null &&
    inspection.goods_in_operator.id === viewer.id;

  return (
    <section className="space-y-4" data-testid="approver-panel">
      <header className="space-y-1.5">
        <h2 className="text-base font-semibold">Review and approve</h2>
        <p className="text-xs text-muted-foreground">
          Signed by operator{" "}
          {inspection.goods_in_operator?.name ?? "—"} on{" "}
          {inspection.goods_in_operator_signed_at?.slice(0, 10) ?? "—"}.
        </p>
        {isSelfApproval && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            <span>
              You signed this inspection as operator. You're now signing
              as the quality approver — both signatures will be recorded
              independently on the audit trail.
            </span>
          </div>
        )}
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
      <ReadOnlyQuarantineLabels inspection={inspection} lines={lines} />
    </div>
  );
}

// Surfaces "Send to laptop" buttons on the read-only summary so the
// operator can re-print quarantine labels they missed during the
// wizard's print step. Active for every status — once the inspection
// is signed off the wizard's print panel is gone, but the dock still
// needs a way to recover a missing label without unlocking edits.
function ReadOnlyQuarantineLabels({
  inspection,
  lines,
}: {
  inspection: Inspection;
  lines: PurchaseOrderLine[];
}) {
  const printable = useMemo(
    () => buildPrintablePacksFromInspection(inspection, lines),
    [inspection, lines],
  );

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Quarantine labels
        </p>
        <p className="text-[10px] text-muted-foreground">
          Re-print missed labels
        </p>
      </div>
      <PrintablePackList
        inspectionUuid={inspection.uuid}
        packs={printable}
        emptyState={
          <p className="text-xs text-muted-foreground">
            No pack data captured on this inspection.
          </p>
        }
      />
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
