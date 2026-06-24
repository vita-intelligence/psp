"use client";

/**
 * State-aware action card for a CO. Mirror of po-workflow-card, with
 * sell-side action set:
 *
 *   draft        → Submit (with gates), Cancel (with reason)
 *   pending_approver  → Sign as approver, Cancel
 *   pending_director  → Sign as director (segregation), Cancel
 *   approved     → Mark as confirmed, Cancel
 *   confirmed    → terminal (no actions in V1)
 *   cancelled    → terminal
 *
 * Pre-emptive 4-eyes warning on Sign-director: if the actor matches
 * the recorded approver signer, server will reject with
 * `same_signer` and we tell them before they try.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Receipt,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Truck,
} from "lucide-react";
import { createInvoiceFromCOAction } from "@/lib/customer-invoices/actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/forms/error-banner";
import { Badge } from "@/components/ui/badge-mini";
import type { CompanyDefaults, CustomerOrder, CustomerOrderStatus } from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import {
  cancelCOAction,
  markConfirmedCOAction,
  signApproverCOAction,
  signDirectorCOAction,
  submitCOAction,
} from "@/lib/customer-orders/actions";
import { formatCompanyDate } from "@/lib/format/company";

const STATUS_LABEL: Record<CustomerOrderStatus, string> = {
  draft: "Draft",
  pending_approver: "Awaiting approver",
  pending_director: "Awaiting director",
  approved: "Approved",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<
  CustomerOrderStatus,
  "emerald" | "amber" | "sky" | "muted" | "destructive"
> = {
  draft: "muted",
  pending_approver: "amber",
  pending_director: "amber",
  approved: "sky",
  confirmed: "emerald",
  cancelled: "destructive",
};

const STATUS_ICON: Record<CustomerOrderStatus, typeof CircleDashed> = {
  draft: CircleDashed,
  pending_approver: Send,
  pending_director: ShieldCheck,
  approved: CheckCircle2,
  confirmed: Truck,
  cancelled: ShieldX,
};

type ActionKey = "submit" | "sign_approver" | "sign_director" | "mark_confirmed" | "cancel";

interface Props {
  co: CustomerOrder;
  currentUserId: number;
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canDirectorApprove: boolean;
  canCreateInvoice: boolean;
  prefs: CompanyDefaults;
}

export function COWorkflowCard({
  co,
  currentUserId,
  canEdit,
  canSubmit,
  canApprove,
  canDirectorApprove,
  canCreateInvoice,
  prefs,
}: Props) {
  const [openAction, setOpenAction] = useState<ActionKey | null>(null);

  const Icon = STATUS_ICON[co.status];
  const approverSig = co.approvals.find((a) => a.kind === "approver");
  const directorSig = co.approvals.find((a) => a.kind === "director");

  const actorIsApprover = approverSig?.signed_by?.id === currentUserId;

  // Action visibility based on state
  const showSubmit = canSubmit && co.status === "draft";
  const showSignApprover = canApprove && co.status === "pending_approver";
  const showSignDirector = canDirectorApprove && co.status === "pending_director";
  const showMarkConfirmed = canDirectorApprove && co.status === "approved";
  const showCancel =
    canEdit &&
    co.status !== "confirmed" &&
    co.status !== "cancelled";

  // Generate invoice is the post-confirm action — flows into the
  // Invoices module's create-from-CO endpoint.
  const showGenerateInvoice = canCreateInvoice && co.status === "confirmed";

  // For action-list visibility — confirmed COs ARE terminal as far
  // as the CO state machine goes, but they're not idle (you generate
  // invoices from them).
  const isTerminal = co.status === "cancelled";

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="size-4 text-muted-foreground" />
              Workflow
              <Badge tone={STATUS_TONE[co.status]}>{STATUS_LABEL[co.status]}</Badge>
            </CardTitle>
            <CardDescription>
              Two-tier ESIGN approval. Director must differ from the approver
              (segregation of duties — server enforces too).
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stamp history — submitted / approver / director / confirmed / cancelled */}
        <ul className="space-y-1.5">
          {co.submitted_at && co.submitted_by && (
            <StampRow
              icon={Send}
              label="Submitted"
              actor={co.submitted_by.name}
              at={formatCompanyDate(co.submitted_at, prefs)}
            />
          )}
          {approverSig && approverSig.signed_by && (
            <StampRow
              icon={ShieldCheck}
              label="Approver-tier signed"
              actor={approverSig.signed_by.name}
              at={formatCompanyDate(approverSig.signed_at, prefs)}
              tone="sky"
              notes={approverSig.notes}
            />
          )}
          {directorSig && directorSig.signed_by && (
            <StampRow
              icon={ShieldCheck}
              label="Director-tier signed"
              actor={directorSig.signed_by.name}
              at={formatCompanyDate(directorSig.signed_at, prefs)}
              tone="sky"
              notes={directorSig.notes}
            />
          )}
          {co.confirmed_at && co.confirmed_by && (
            <StampRow
              icon={Truck}
              label="Confirmed"
              actor={co.confirmed_by.name}
              at={formatCompanyDate(co.confirmed_at, prefs)}
              tone="emerald"
            />
          )}
          {co.cancelled_at && co.cancelled_by && (
            <StampRow
              icon={ShieldX}
              label="Cancelled"
              actor={co.cancelled_by.name}
              at={formatCompanyDate(co.cancelled_at, prefs)}
              tone="destructive"
              notes={co.cancellation_reason}
            />
          )}
        </ul>

        {/* Actions */}
        {!isTerminal && (
          <div className="border-t border-border/60 pt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Actions
            </p>
            <div className="flex flex-wrap gap-2">
              {showSubmit && (
                <Button size="sm" onClick={() => setOpenAction("submit")}>
                  <Send className="mr-1.5 size-3.5" />
                  Submit for approval
                </Button>
              )}
              {showSignApprover && (
                <Button size="sm" onClick={() => setOpenAction("sign_approver")}>
                  <ShieldCheck className="mr-1.5 size-3.5" />
                  Sign as approver
                </Button>
              )}
              {showSignDirector && (
                <Button
                  size="sm"
                  onClick={() => setOpenAction("sign_director")}
                  disabled={actorIsApprover}
                  title={
                    actorIsApprover
                      ? "You signed as approver — a different reviewer must sign as director."
                      : undefined
                  }
                >
                  <ShieldCheck className="mr-1.5 size-3.5" />
                  Sign as director
                </Button>
              )}
              {showMarkConfirmed && (
                <Button size="sm" onClick={() => setOpenAction("mark_confirmed")}>
                  <Truck className="mr-1.5 size-3.5" />
                  Mark confirmed
                </Button>
              )}
              {showGenerateInvoice && <GenerateInvoiceButton co={co} />}
              {showCancel && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => setOpenAction("cancel")}
                >
                  <ShieldX className="mr-1.5 size-3.5" />
                  Cancel
                </Button>
              )}
            </div>
            {actorIsApprover && showSignDirector && (
              <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                <ShieldAlert className="mr-1 inline size-3" />
                You signed as approver. The director sign-off must come from
                a different reviewer.
              </p>
            )}
          </div>
        )}

        <SubmitDialog
          open={openAction === "submit"}
          onClose={() => setOpenAction(null)}
          co={co}
        />
        <SignApproverDialog
          open={openAction === "sign_approver"}
          onClose={() => setOpenAction(null)}
          co={co}
        />
        <SignDirectorDialog
          open={openAction === "sign_director"}
          onClose={() => setOpenAction(null)}
          co={co}
        />
        <MarkConfirmedDialog
          open={openAction === "mark_confirmed"}
          onClose={() => setOpenAction(null)}
          co={co}
        />
        <CancelDialog
          open={openAction === "cancel"}
          onClose={() => setOpenAction(null)}
          co={co}
        />
      </CardContent>
    </Card>
  );
}

function StampRow({
  icon: Icon,
  label,
  actor,
  at,
  tone = "muted",
  notes,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  actor: string;
  at: string;
  tone?: "muted" | "sky" | "emerald" | "destructive";
  notes?: string | null;
}) {
  const toneClass =
    tone === "sky"
      ? "text-sky-700 dark:text-sky-300"
      : tone === "emerald"
        ? "text-emerald-700 dark:text-emerald-300"
        : tone === "destructive"
          ? "text-destructive"
          : "text-muted-foreground";
  return (
    <li className="rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Icon className={`size-3.5 ${toneClass}`} />
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          — {actor} on {at}
        </span>
      </div>
      {notes && (
        <p className="mt-1 pl-5 italic text-muted-foreground">
          &ldquo;{notes}&rdquo;
        </p>
      )}
    </li>
  );
}

// ============================================================
// Dialogs
// ============================================================

interface DialogProps {
  open: boolean;
  onClose: () => void;
  co: CustomerOrder;
}

function useActionRunner(co: CustomerOrder, onClose: () => void) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  function run<T>(
    runner: () => Promise<{ ok: true } | { ok: false; detail: string; code: string; debug?: ErrorDebug }>,
    successMsg: string,
  ) {
    setError(null);
    startTransition(async () => {
      const res = await runner();
      if (res.ok) {
        toast.success(successMsg);
        onClose();
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  return { pending, error, setError, run };
}

function SubmitDialog({ open, onClose, co }: DialogProps) {
  const { pending, error, run } = useActionRunner(co, onClose);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Submit for approval</DialogTitle>
          <DialogDescription>
            Server-side gates: customer must be effectively approved, all
            items must be sellable to this customer, and the CO total must
            not push outstanding A/R past the trade-credit-limit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-[11px]">
            <p className="font-medium">After submit:</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              <li>• Header + line edits are locked</li>
              <li>• An approver must sign first, then a different director</li>
            </ul>
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
            onClick={() => run(() => submitCOAction(co.uuid), "Submitted for approval")}
            disabled={pending}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            <Send className="mr-1.5 size-4" />
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SignApproverDialog({ open, onClose, co }: DialogProps) {
  const [notes, setNotes] = useState("");
  const { pending, error, run } = useActionRunner(co, onClose);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign as approver (1st of 2)</DialogTitle>
          <DialogDescription>
            Stamps your name + the current time on the approver-tier
            signature row. After this, a different user must sign as
            director.
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
              placeholder="What did you check? Any caveats?"
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
            onClick={() =>
              run(
                () => signApproverCOAction(co.uuid, notes.trim() || null),
                "Approver-tier signed",
              )
            }
            disabled={pending}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Sign as approver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SignDirectorDialog({ open, onClose, co }: DialogProps) {
  const [notes, setNotes] = useState("");
  const { pending, error, run } = useActionRunner(co, onClose);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign as director (2nd of 2)</DialogTitle>
          <DialogDescription>
            Final approval. Must differ from the approver-tier signer —
            server enforces.
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
              placeholder="Approval rationale, any conditions?"
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
            onClick={() =>
              run(
                () => signDirectorCOAction(co.uuid, notes.trim() || null),
                "Director-tier signed",
              )
            }
            disabled={pending}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Sign as director
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MarkConfirmedDialog({ open, onClose, co }: DialogProps) {
  const { pending, error, run } = useActionRunner(co, onClose);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as confirmed</DialogTitle>
          <DialogDescription>
            Commits the order to the customer. From V1 this is terminal
            until the warehouse pick + invoice modules ship — once
            confirmed, the CO can&rsquo;t be cancelled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-amber-300/60 bg-amber-50 p-3 text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle className="mr-1 inline size-3.5" />
            Counts toward the customer&rsquo;s outstanding A/R from this
            point — the trade-credit-limit gate uses confirmed orders.
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
            onClick={() =>
              run(() => markConfirmedCOAction(co.uuid), "CO confirmed")
            }
            disabled={pending}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            <Truck className="mr-1.5 size-4" />
            Mark confirmed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ open, onClose, co }: DialogProps) {
  const [reason, setReason] = useState("");
  const { pending, error, run } = useActionRunner(co, onClose);
  const reasonMissing = !reason.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel customer order</DialogTitle>
          <DialogDescription>
            Sets the CO to <strong>cancelled</strong> — terminal. Confirmed
            orders cannot be cancelled in V1.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this CO being cancelled?"
              required
            />
          </div>
          {error && (
            <ErrorBanner detail={error.detail} code={error.code} debug={error.debug} />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Back
          </Button>
          <Button
            type="button"
            variant="outline"
            className="text-destructive hover:bg-destructive/10"
            onClick={() =>
              run(() => cancelCOAction(co.uuid, reason.trim()), "CO cancelled")
            }
            disabled={pending || reasonMissing}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            <ShieldX className="mr-1.5 size-4" />
            Cancel order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Generate invoice — post-confirm action that hands off to the
// Invoices module. Calls create_from_co and redirects to the new
// invoice detail. Server skips lines already fully billed; if every
// line is fully billed it returns 422 and we surface a toast.
// ============================================================

function GenerateInvoiceButton({ co }: { co: CustomerOrder }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function generate() {
    startTransition(async () => {
      const res = await createInvoiceFromCOAction(co.uuid, {});
      if (res.ok) {
        toast.success("Invoice generated");
        router.push(`/sales/invoices/${res.customer_invoice.uuid}`);
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <Button size="sm" onClick={generate} disabled={pending}>
      {pending ? (
        <Loader2 className="mr-1.5 size-4 animate-spin" />
      ) : (
        <Receipt className="mr-1.5 size-3.5" />
      )}
      Generate invoice
    </Button>
  );
}
