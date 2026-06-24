"use client";

/**
 * Single combined "Onboarding & Approval" card for a customer.
 *
 * Replaces what used to be two separate cards (qualification +
 * approval). The compliance posture is the same — workers click
 * action buttons that capture WHO + WHEN + WHY (reason / evidence
 * file) and the system writes the audit row + flips the projection.
 * There is intentionally no status dropdown: per CLAUDE.md HARD
 * RULE #1, status is a projection of recorded actions, not a field
 * a worker types into.
 *
 * Lifecycle (server-enforced):
 *
 *     draft ─── Approve* ──▶ approved ─── Suspend* ──▶ suspended
 *       │                       │                          │
 *       ├── Reject* ──▶ rejected (terminal until Reopen)   │
 *       │                       │                          │
 *       │                       └── Reject* ───┐           │
 *       │                                      ▼           │
 *       │                                rejected          │
 *       │                                                  │
 *       └─────────────────────────────────────── Approve* ─┘
 *                                                          │
 *                                                          └── Reject*
 *
 *   * Approve: requires checklist complete + segregation of duties
 *     (actor ≠ qualified_by, falling back to ≠ created_by).
 *   * Suspend / Reject: require a reason (server enforces too).
 *   * `effective_approval_status` adds an auto-suspend overlay when
 *     re-qualification cadence (next_review_at) is overdue — the
 *     stored column doesn't move, but every gate reads the
 *     effective value.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  FileText,
  Loader2,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Upload,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge-mini";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import type {
  Customer,
  CustomerAmlOutcome,
  CustomerApprovalStatus,
  CustomerCreditCheckOutcome,
  CustomerFile,
} from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import {
  approveCustomerAction,
  updateCustomerQualificationAction,
  uploadCustomerFileAction,
} from "@/lib/customers/actions";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";

interface Props {
  customer: Customer;
  canEdit: boolean;
  canApprove: boolean;
  currentUserId: number;
  prefs: FormatPrefs;
}

const APPROVAL_LABEL: Record<CustomerApprovalStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  suspended: "Suspended",
  rejected: "Rejected",
};

const APPROVAL_TONE: Record<
  CustomerApprovalStatus,
  "emerald" | "amber" | "muted" | "destructive"
> = {
  approved: "emerald",
  draft: "amber",
  suspended: "muted",
  rejected: "destructive",
};

const APPROVAL_ICON: Record<CustomerApprovalStatus, typeof ShieldCheck> = {
  approved: ShieldCheck,
  draft: CircleDashed,
  suspended: ShieldAlert,
  rejected: ShieldX,
};

type SectionKey = "kyc" | "credit_check" | "aml" | "contract";
type ActionKey = "approve" | "suspend" | "reject" | "reopen";

const CREDIT_OUTCOMES: Array<{ value: CustomerCreditCheckOutcome; label: string }> =
  [
    { value: "pass", label: "Pass" },
    { value: "conditional", label: "Conditional" },
    { value: "fail", label: "Fail" },
  ];

const AML_OUTCOMES: Array<{ value: CustomerAmlOutcome; label: string }> = [
  { value: "clean", label: "Clean" },
  { value: "flagged", label: "Flagged" },
];

export function CustomerOnboardingCard({
  customer,
  canEdit,
  canApprove,
  currentUserId,
  prefs,
}: Props) {
  const router = useRouter();
  const [openSection, setOpenSection] = useState<SectionKey | null>(null);
  const [openAction, setOpenAction] = useState<ActionKey | null>(null);

  const sections = sectionsFor(customer);
  const completeCount = sections.filter((s) => s.complete).length;
  const totalCount = sections.length;
  const checklistComplete = customer.qualification["complete?"];

  const effectiveStatus = customer.effective_approval_status;
  const effectiveReason = customer.effective_approval_reason;
  const effectiveDiffers = effectiveReason !== "none";
  const Icon = APPROVAL_ICON[effectiveStatus];

  // Segregation of duties — pre-warn before submit.
  const actorIsQualifier = customer.qualified_by?.id === currentUserId;
  const actorIsCreatorFallback =
    !customer.qualified_by && customer.created_by?.id === currentUserId;
  const segregationConflict = actorIsQualifier || actorIsCreatorFallback;

  // Stored status (NOT effective) drives which action buttons appear —
  // we want the worker to act on the recorded decision, not the
  // overdue overlay (which only re-approving + re-qualifying lifts).
  const stored = customer.approval_status;
  const canShowApprove =
    canApprove && (stored === "draft" || stored === "suspended");
  const canShowSuspend = canApprove && stored === "approved";
  const canShowReject =
    canApprove &&
    (stored === "draft" || stored === "approved" || stored === "suspended");
  const canShowReopen = canApprove && stored === "rejected";

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      {/* Header — effective status + stored decision history */}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold tracking-tight">
              Onboarding &amp; approval
            </h2>
            <Badge tone={APPROVAL_TONE[effectiveStatus]}>
              {APPROVAL_LABEL[effectiveStatus]}
              {effectiveDiffers && " *"}
            </Badge>
            <Badge tone={checklistComplete ? "emerald" : "amber"}>
              {completeCount} / {totalCount} checklist
            </Badge>
          </div>
          {customer.approved_at && customer.approved_by ? (
            <p className="text-xs text-muted-foreground">
              Stored decision: {APPROVAL_LABEL[stored]} by{" "}
              <span className="font-medium text-foreground">
                {customer.approved_by.name}
              </span>{" "}
              on {formatCompanyDate(customer.approved_at, prefs)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {stored === "draft"
                ? "Awaiting approval — complete the onboarding checklist first."
                : APPROVAL_LABEL[stored]}
            </p>
          )}
          {customer.approval_notes && (
            <p className="rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {customer.approval_notes}
            </p>
          )}
        </div>
      </header>

      {effectiveDiffers && (
        <div className="mt-4 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {effectiveReason === "re_qualification_overdue" ? (
            <>
              <strong>Auto-suspended:</strong> re-qualification was due by{" "}
              {customer.next_review_at &&
                formatCompanyDate(customer.next_review_at, prefs)}
              . Re-record the onboarding evidence below and Approve again to
              lift this.
            </>
          ) : effectiveReason === "inactive" ? (
            <>
              <strong>Inactive:</strong> the customer is manually disabled.
              Re-activate them on the form before approving.
            </>
          ) : null}
        </div>
      )}

      {/* Checklist sections */}
      <div className="mt-4 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Onboarding checklist
        </p>
        <ul className="space-y-2">
          {sections.map((s) => (
            <SectionRow
              key={s.key}
              section={s}
              canEdit={canEdit}
              prefs={prefs}
              onOpen={() => setOpenSection(s.key)}
            />
          ))}
        </ul>
      </div>

      {/* Re-qualification cadence */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-muted-foreground" />
          <div>
            <p className="text-xs font-medium">Re-qualification cadence</p>
            <p className="text-[11px] text-muted-foreground">
              {customer.review_frequency_months ?? 12} months
              {customer.last_review_at && (
                <> · last {formatCompanyDate(customer.last_review_at, prefs)}</>
              )}
              {customer.next_review_at && (
                <>
                  {" · next "}
                  <span
                    className={
                      customer.review_overdue
                        ? "font-medium text-destructive"
                        : ""
                    }
                  >
                    {formatCompanyDate(customer.next_review_at, prefs)}
                  </span>
                  {customer.review_overdue && (
                    <span className="ml-1 text-destructive">(overdue)</span>
                  )}
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      {canApprove && (
        <div className="mt-5 border-t border-border/60 pt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Actions
          </p>
          <div className="flex flex-wrap gap-2">
            {canShowApprove && (
              <Button
                size="sm"
                onClick={() => setOpenAction("approve")}
                disabled={!checklistComplete}
                title={
                  !checklistComplete
                    ? "Complete the onboarding checklist first."
                    : segregationConflict
                      ? "You collected the evidence — get a different reviewer."
                      : undefined
                }
              >
                <ShieldCheck className="mr-1.5 size-3.5" />
                {stored === "suspended" ? "Re-approve" : "Approve customer"}
              </Button>
            )}
            {canShowSuspend && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpenAction("suspend")}
              >
                <ShieldAlert className="mr-1.5 size-3.5" />
                Suspend
              </Button>
            )}
            {canShowReject && (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:bg-destructive/10"
                onClick={() => setOpenAction("reject")}
              >
                <ShieldX className="mr-1.5 size-3.5" />
                Reject
              </Button>
            )}
            {canShowReopen && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpenAction("reopen")}
              >
                <RotateCcw className="mr-1.5 size-3.5" />
                Reopen
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Per-section "record evidence" dialogs */}
      <KycDialog
        open={openSection === "kyc"}
        onClose={() => setOpenSection(null)}
        customer={customer}
        onSaved={() => router.refresh()}
      />
      <CreditDialog
        open={openSection === "credit_check"}
        onClose={() => setOpenSection(null)}
        customer={customer}
        onSaved={() => router.refresh()}
      />
      <AmlDialog
        open={openSection === "aml"}
        onClose={() => setOpenSection(null)}
        customer={customer}
        onSaved={() => router.refresh()}
      />
      <ContractDialog
        open={openSection === "contract"}
        onClose={() => setOpenSection(null)}
        customer={customer}
        onSaved={() => router.refresh()}
      />

      {/* Approval action dialogs */}
      <ApproveDialog
        open={openAction === "approve"}
        onClose={() => setOpenAction(null)}
        customer={customer}
        segregationConflict={segregationConflict}
        actorIsQualifier={actorIsQualifier}
        onSaved={() => router.refresh()}
      />
      <SuspendDialog
        open={openAction === "suspend"}
        onClose={() => setOpenAction(null)}
        customer={customer}
        onSaved={() => router.refresh()}
      />
      <RejectDialog
        open={openAction === "reject"}
        onClose={() => setOpenAction(null)}
        customer={customer}
        onSaved={() => router.refresh()}
      />
      <ReopenDialog
        open={openAction === "reopen"}
        onClose={() => setOpenAction(null)}
        customer={customer}
        onSaved={() => router.refresh()}
      />
    </section>
  );
}

// ============================================================
// Checklist section types + row
// ============================================================

interface SectionView {
  key: SectionKey;
  label: string;
  description: string;
  complete: boolean;
  warning: string | null;
  at: string | null;
  actor: { name: string } | null;
  file: CustomerFile | null;
  outcome: string | null;
  notes: string | null;
}

function sectionsFor(customer: Customer): SectionView[] {
  const creditWarning =
    customer.credit_check_outcome === "fail"
      ? "Outcome: FAIL — re-run before approving"
      : customer.credit_check_outcome === "conditional"
        ? "Outcome: conditional — review with finance"
        : null;
  const amlWarning =
    customer.aml_outcome === "flagged"
      ? "FLAGGED — clearance notes required before approving"
      : null;

  return [
    {
      key: "kyc",
      label: "KYC verification",
      description:
        "Confirm the customer is a real registered entity + upload registry doc.",
      complete: Boolean(customer.kyc_verified_at),
      warning: null,
      at: customer.kyc_verified_at,
      actor: customer.kyc_verified_by,
      file: customer.kyc_file,
      outcome: null,
      notes: customer.kyc_notes,
    },
    {
      key: "credit_check",
      label: "Credit check",
      description: "Credit-bureau lookup + upload the report PDF.",
      complete:
        Boolean(customer.credit_check_at) &&
        customer.credit_check_outcome !== "fail",
      warning: creditWarning,
      at: customer.credit_check_at,
      actor: customer.credit_check_by,
      file: customer.credit_check_file,
      outcome: customer.credit_check_outcome
        ? customer.credit_check_outcome.toUpperCase()
        : null,
      notes: customer.credit_check_notes,
    },
    {
      key: "aml",
      label: "AML / sanctions screening",
      description: "Sanctions / PEP / adverse-media check.",
      complete:
        Boolean(customer.aml_screened_at) &&
        (customer.aml_outcome !== "flagged" ||
          (customer.aml_notes !== null && customer.aml_notes.trim() !== "")),
      warning: amlWarning,
      at: customer.aml_screened_at,
      actor: customer.aml_screened_by,
      file: null,
      outcome: customer.aml_outcome ? customer.aml_outcome.toUpperCase() : null,
      notes: customer.aml_notes,
    },
    {
      key: "contract",
      label: "Signed contract / MSA",
      description: "Date countersigned + upload the PDF.",
      complete: Boolean(customer.contract_signed_at),
      warning: null,
      at: customer.contract_signed_at,
      actor: customer.contract_signed_by,
      file: customer.contract_file,
      outcome: null,
      notes: customer.contract_notes,
    },
  ];
}

function SectionRow({
  section,
  canEdit,
  prefs,
  onOpen,
}: {
  section: SectionView;
  canEdit: boolean;
  prefs: FormatPrefs;
  onOpen: () => void;
}) {
  const StatusIcon = section.complete
    ? CheckCircle2
    : section.warning
      ? ShieldAlert
      : section.at
        ? XCircle
        : CircleDashed;
  const toneClass = section.complete
    ? "text-emerald-600 dark:text-emerald-400"
    : section.warning
      ? "text-amber-600 dark:text-amber-400"
      : section.at
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <li className="rounded-md border border-border/60 bg-card/60 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <StatusIcon className={`size-4 ${toneClass}`} />
            <span className="text-sm font-medium">{section.label}</span>
            {section.outcome && (
              <Badge
                tone={
                  section.warning
                    ? "amber"
                    : section.complete
                      ? "emerald"
                      : "muted"
                }
              >
                {section.outcome}
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {section.description}
          </p>
          {section.warning && (
            <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
              {section.warning}
            </p>
          )}
          {section.at && section.actor && (
            <p className="text-[11px] text-muted-foreground">
              {formatCompanyDate(section.at, prefs)} by{" "}
              <span className="font-medium text-foreground">
                {section.actor.name}
              </span>
            </p>
          )}
          {section.file && (
            <p className="text-[11px]">
              <a
                href={section.file.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-brand hover:underline"
              >
                <FileText className="size-3" />
                {section.file.filename}
              </a>
            </p>
          )}
          {section.notes && (
            <p className="text-[11px] italic text-muted-foreground">
              &ldquo;{section.notes}&rdquo;
            </p>
          )}
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={onOpen}>
            {section.at ? "Re-record" : "Record"}
          </Button>
        )}
      </div>
    </li>
  );
}

// ============================================================
// Section-recording dialogs (KYC / Credit / AML / Contract)
// ============================================================

interface SectionDialogProps {
  open: boolean;
  onClose: () => void;
  customer: Customer;
  onSaved: () => void;
}

function useUploadAndQualify(customer: Customer, onSaved: () => void) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  async function uploadIfPresent(
    file: File | null,
    kind: CustomerFile["kind"],
  ): Promise<number | null | "error"> {
    if (!file) return null;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    const res = await uploadCustomerFileAction(customer.uuid, fd);
    if (!res.ok) {
      setError({ detail: res.detail, code: res.code, debug: res.debug });
      return "error";
    }
    return res.file.id;
  }

  function runQualify(
    file: File | null,
    fileKind: CustomerFile["kind"],
    payload: (fileId: number | null) => Record<string, unknown>,
  ) {
    setError(null);
    startTransition(async () => {
      const uploadedId = await uploadIfPresent(file, fileKind);
      if (uploadedId === "error") return;

      const res = await updateCustomerQualificationAction(
        customer.uuid,
        payload(uploadedId),
      );
      if (res.ok) {
        toast.success("Qualification recorded");
        onSaved();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  return { pending, error, setError, runQualify };
}

function KycDialog({ open, onClose, customer, onSaved }: SectionDialogProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState(customer.kyc_notes ?? "");
  const { pending, error, runQualify } = useUploadAndQualify(customer, () => {
    onSaved();
    onClose();
    setFile(null);
    setNotes("");
  });

  function submit() {
    runQualify(file, "other", (fileId) => ({
      kyc_verified_at: new Date().toISOString(),
      kyc_file_id: fileId ?? customer.kyc_file?.id ?? null,
      kyc_notes: notes.trim() || null,
    }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record KYC verification</DialogTitle>
          <DialogDescription>
            Upload the corporate registry / certificate of incorporation. Your
            name + the current time are stamped on the record.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Evidence file
            </Label>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".pdf,image/*,.doc,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mr-1.5 size-4" />
              {file
                ? file.name
                : customer.kyc_file
                  ? `Keep existing: ${customer.kyc_file.filename}`
                  : "Choose file"}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Notes
            </Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did you check? Registry name + ref #?"
            />
          </div>
          {error && (
            <ErrorBanner detail={error.detail} code={error.code} debug={error.debug} />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreditDialog({ open, onClose, customer, onSaved }: SectionDialogProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [outcome, setOutcome] = useState<CustomerCreditCheckOutcome>(
    customer.credit_check_outcome ?? "pass",
  );
  const [score, setScore] = useState(customer.credit_check_score ?? "");
  const [notes, setNotes] = useState(customer.credit_check_notes ?? "");
  const { pending, error, runQualify } = useUploadAndQualify(customer, () => {
    onSaved();
    onClose();
    setFile(null);
  });

  function submit() {
    runQualify(file, "credit_check", (fileId) => ({
      credit_check_at: new Date().toISOString(),
      credit_check_outcome: outcome,
      credit_check_score: score.trim() || null,
      credit_check_file_id: fileId ?? customer.credit_check_file?.id ?? null,
      credit_check_notes: notes.trim() || null,
    }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record credit check</DialogTitle>
          <DialogDescription>
            Outcome drives the trade-credit-limit conversation. Upload the
            bureau report PDF.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Outcome
              </Label>
              <Select
                value={outcome}
                onValueChange={(v) => setOutcome(v as CustomerCreditCheckOutcome)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CREDIT_OUTCOMES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Score (optional)
              </Label>
              <Input
                value={score}
                onChange={(e) => setScore(e.target.value)}
                placeholder="e.g. 78"
                className="h-9 font-mono"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Evidence file
            </Label>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mr-1.5 size-4" />
              {file
                ? file.name
                : customer.credit_check_file
                  ? `Keep existing: ${customer.credit_check_file.filename}`
                  : "Choose file"}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Notes
            </Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Bureau used + any conditions"
            />
          </div>
          {error && (
            <ErrorBanner detail={error.detail} code={error.code} debug={error.debug} />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AmlDialog({ open, onClose, customer, onSaved }: SectionDialogProps) {
  const [outcome, setOutcome] = useState<CustomerAmlOutcome>(
    customer.aml_outcome ?? "clean",
  );
  const [notes, setNotes] = useState(customer.aml_notes ?? "");
  const { pending, error, runQualify } = useUploadAndQualify(customer, () => {
    onSaved();
    onClose();
  });

  const flaggedRequiresNotes = outcome === "flagged" && !notes.trim();

  function submit() {
    runQualify(null, "other", () => ({
      aml_screened_at: new Date().toISOString(),
      aml_outcome: outcome,
      aml_notes: notes.trim() || null,
    }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record AML / sanctions screening</DialogTitle>
          <DialogDescription>
            Sanctions / PEP / adverse-media check. If flagged, clearance notes
            are required before the customer can be approved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Outcome
            </Label>
            <Select
              value={outcome}
              onValueChange={(v) => setOutcome(v as CustomerAmlOutcome)}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AML_OUTCOMES.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Notes {outcome === "flagged" && <span className="text-destructive">*</span>}
            </Label>
            <Textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                outcome === "flagged"
                  ? "What was the hit, and how was it cleared?"
                  : "Tool used + scan reference (optional)"
              }
            />
          </div>
          {error && (
            <ErrorBanner detail={error.detail} code={error.code} debug={error.debug} />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || flaggedRequiresNotes}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContractDialog({ open, onClose, customer, onSaved }: SectionDialogProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [signedDate, setSignedDate] = useState(
    customer.contract_signed_at
      ? customer.contract_signed_at.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState(customer.contract_notes ?? "");
  const { pending, error, runQualify } = useUploadAndQualify(customer, () => {
    onSaved();
    onClose();
    setFile(null);
  });

  function submit() {
    runQualify(file, "contract", (fileId) => ({
      contract_signed_at: new Date(signedDate + "T12:00:00Z").toISOString(),
      contract_file_id: fileId ?? customer.contract_file?.id ?? null,
      contract_notes: notes.trim() || null,
    }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record signed contract</DialogTitle>
          <DialogDescription>
            Upload the countersigned MSA / NDA. Without this, payment terms
            aren&rsquo;t legally enforceable.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Signed on
            </Label>
            <Input
              type="date"
              value={signedDate}
              onChange={(e) => setSignedDate(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Evidence file
            </Label>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mr-1.5 size-4" />
              {file
                ? file.name
                : customer.contract_file
                  ? `Keep existing: ${customer.contract_file.filename}`
                  : "Choose file"}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Notes
            </Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contract reference / scope notes"
            />
          </div>
          {error && (
            <ErrorBanner detail={error.detail} code={error.code} debug={error.debug} />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Approval action dialogs (Approve / Suspend / Reject / Reopen)
// ============================================================

interface ApprovalDialogProps {
  open: boolean;
  onClose: () => void;
  customer: Customer;
  onSaved: () => void;
}

function useApprovalAction(customer: Customer, onSaved: () => void) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  function run(status: CustomerApprovalStatus, notes: string | null) {
    setError(null);
    startTransition(async () => {
      const res = await approveCustomerAction(customer.uuid, {
        approval_status: status,
        approval_notes: notes,
      });
      if (res.ok) {
        toast.success(`Approval set to ${APPROVAL_LABEL[status]}`);
        onSaved();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  return { pending, error, setError, run };
}

function ApproveDialog({
  open,
  onClose,
  customer,
  segregationConflict,
  actorIsQualifier,
  onSaved,
}: ApprovalDialogProps & {
  segregationConflict: boolean;
  actorIsQualifier: boolean;
}) {
  const [notes, setNotes] = useState("");
  const { pending, error, run } = useApprovalAction(customer, () => {
    onSaved();
    onClose();
    setNotes("");
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve customer</DialogTitle>
          <DialogDescription>
            Stamps your name + the current time and freezes an evidence
            snapshot of the onboarding checklist. Sales orders can then be
            raised against this customer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {segregationConflict && (
            <div className="rounded-md border border-sky-300/60 bg-sky-50 p-3 dark:border-sky-500/30 dark:bg-sky-500/10">
              <p className="text-[11px] text-sky-900 dark:text-sky-200">
                <strong>Segregation of duties:</strong>{" "}
                {actorIsQualifier
                  ? "You last touched the onboarding evidence — approval must be signed by a different reviewer."
                  : "You created this customer — a different reviewer needs to sign off."}{" "}
                The server will reject this attempt.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Notes (optional)
            </Label>
            <Textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Credit limit basis? Any conditions?"
            />
          </div>
          {error && (
            <ErrorBanner detail={error.detail} code={error.code} debug={error.debug} />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => run("approved", notes.trim() || null)}
            disabled={pending}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Approve customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuspendDialog({ open, onClose, customer, onSaved }: ApprovalDialogProps) {
  const [reason, setReason] = useState("");
  const { pending, error, run } = useApprovalAction(customer, () => {
    onSaved();
    onClose();
    setReason("");
  });

  const reasonMissing = !reason.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Suspend customer</DialogTitle>
          <DialogDescription>
            Temporary block — no new sales orders can be raised. Existing
            orders are unaffected. The evidence snapshot is cleared; the
            customer must be re-approved (and possibly re-qualified) to lift
            the suspension.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <strong>Common reasons:</strong> past-due A/R, credit-limit
            breach, pending sanctions review, customer-requested pause.
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What's the trigger, and what would lift this?"
              required
            />
          </div>
          {error && (
            <ErrorBanner detail={error.detail} code={error.code} debug={error.debug} />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => run("suspended", reason.trim())}
            disabled={pending || reasonMissing}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            <ShieldAlert className="mr-1.5 size-4" />
            Suspend
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ open, onClose, customer, onSaved }: ApprovalDialogProps) {
  const [reason, setReason] = useState("");
  const { pending, error, run } = useApprovalAction(customer, () => {
    onSaved();
    onClose();
    setReason("");
  });

  const reasonMissing = !reason.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject customer</DialogTitle>
          <DialogDescription>
            Marks the customer as not approved. Use for KYC fail, sanctions
            hit, fraud signal, or a definitive credit-bureau rejection. The
            customer stays on the books (so the audit trail survives) but no
            sales orders can be raised.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-destructive/40 bg-destructive/[0.04] px-3 py-2 text-[11px] text-destructive">
            <strong>Not reversible by edit</strong> — to undo, hit{" "}
            <em>Reopen</em> on the customer once this is logged. The action
            is recorded with your name + a permanent audit row.
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this customer being rejected?"
              required
            />
          </div>
          {error && (
            <ErrorBanner detail={error.detail} code={error.code} debug={error.debug} />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => run("rejected", reason.trim())}
            disabled={pending || reasonMissing}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            <ShieldX className="mr-1.5 size-4" />
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReopenDialog({ open, onClose, customer, onSaved }: ApprovalDialogProps) {
  const [notes, setNotes] = useState("");
  const { pending, error, run } = useApprovalAction(customer, () => {
    onSaved();
    onClose();
    setNotes("");
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reopen customer</DialogTitle>
          <DialogDescription>
            Returns to <strong>Draft</strong> for re-onboarding. Existing
            evidence stays attached — you only need to update what changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Notes (optional)
            </Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What changed since rejection?"
            />
          </div>
          {error && (
            <ErrorBanner detail={error.detail} code={error.code} debug={error.debug} />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => run("draft", notes.trim() || null)}
            disabled={pending}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            <RotateCcw className="mr-1.5 size-4" />
            Reopen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
