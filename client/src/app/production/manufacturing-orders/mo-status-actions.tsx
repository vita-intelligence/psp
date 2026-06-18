"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  CircleSlash,
  ClipboardCheck,
  GitMerge,
  Loader2,
  PenSquare,
  Play,
  RotateCcw,
  ShieldCheck,
  Undo2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/forms/error-banner";
import { cn } from "@/lib/utils";
import { format as formatDateFns } from "date-fns";
import { invalidateAudit } from "@/lib/audit/invalidator";
import {
  signMOAction,
  transitionManufacturingOrderAction,
} from "@/lib/production/actions";
import type {
  ManufacturingOrder,
  ManufacturingOrderStatus,
} from "@/lib/production/types";
import type { CompanyDefaults } from "@/lib/types";
import { MergeIntoBatchDialog } from "./merge-into-batch-dialog";

interface Props {
  mo: ManufacturingOrder;
  /** Can mark prepared / unprepare (1st signature). */
  canPrepare: boolean;
  /** Can approve / reject / amend (2nd signature). */
  canApprove: boolean;
  /** Can start / complete / cancel (run on the floor). */
  canExecute: boolean;
  /** Can edit MO header + merge-into-batch (structural changes). */
  canEdit: boolean;
  currentUserId: number;
  company: CompanyDefaults;
}

const STATUS_STYLES: Record<
  ManufacturingOrderStatus,
  { ring: string; bg: string; text: string; dot: string }
> = {
  draft: {
    ring: "ring-border",
    bg: "bg-muted/60",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
  prepared: {
    ring: "ring-amber-200 dark:ring-amber-900/50",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-800 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  approved: {
    ring: "ring-indigo-200 dark:ring-indigo-900/50",
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    text: "text-indigo-700 dark:text-indigo-300",
    dot: "bg-indigo-500",
  },
  scheduled: {
    ring: "ring-sky-200 dark:ring-sky-900/50",
    bg: "bg-sky-50 dark:bg-sky-950/30",
    text: "text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
  },
  in_progress: {
    ring: "ring-amber-200 dark:ring-amber-900/50",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-800 dark:text-amber-300",
    dot: "bg-amber-500 animate-pulse",
  },
  completed: {
    ring: "ring-emerald-200 dark:ring-emerald-900/50",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  cancelled: {
    ring: "ring-destructive/30",
    bg: "bg-destructive/10",
    text: "text-destructive",
    dot: "bg-destructive",
  },
};

const STATUS_LABEL: Record<ManufacturingOrderStatus, string> = {
  draft: "Draft",
  prepared: "Awaiting approval",
  approved: "Approved",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function MOStatusActions({
  mo,
  canPrepare,
  canApprove,
  canExecute,
  canEdit,
  currentUserId,
  company,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [actionError, setActionError] = useState<{
    detail: string;
    code?: string;
  } | null>(null);

  // Sub-MOs don't get their own signature buttons — approval is
  // handled at the root of the chain. We still allow execution
  // actions (start/complete/cancel) on a child since each MO runs
  // independently once approved.
  const isChild = mo.parent_mo_id != null;

  function runStatus(
    label: string,
    to: ManufacturingOrderStatus,
    confirmMsg?: string,
  ) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setActionError(null);
    setPendingLabel(label);
    startTransition(async () => {
      const res = await transitionManufacturingOrderAction(mo.uuid, to);
      setPendingLabel(null);
      if (res.ok) {
        toast.success(`Status → ${STATUS_LABEL[res.mo.status]}`);
        invalidateAudit("manufacturing_order", mo.id);
        router.refresh();
      } else {
        setActionError({ detail: res.detail, code: res.code });
      }
    });
  }

  function runSignature(
    label: string,
    action: "prepare" | "unprepare" | "approve" | "amend",
  ) {
    setActionError(null);
    setPendingLabel(label);
    startTransition(async () => {
      const res = await signMOAction(mo.uuid, action);
      setPendingLabel(null);
      if (res.ok) {
        toast.success(`Status → ${STATUS_LABEL[res.mo.status]}`);
        invalidateAudit("manufacturing_order", mo.id);
        router.refresh();
      } else {
        setActionError({ detail: res.detail, code: res.code });
      }
    });
  }

  function submitReject(reason: string) {
    setActionError(null);
    setPendingLabel("Reject");
    startTransition(async () => {
      const res = await signMOAction(mo.uuid, "reject", reason);
      setPendingLabel(null);
      if (res.ok) {
        toast.success("Rejected. Tree returned to draft for revisions.");
        invalidateAudit("manufacturing_order", mo.id);
        setRejectOpen(false);
        router.refresh();
      } else {
        setActionError({ detail: res.detail, code: res.code });
      }
    });
  }

  const style = STATUS_STYLES[mo.status];
  const isPreparer = mo.prepared_by_id === currentUserId;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
            style.bg,
            style.text,
            style.ring,
          )}
        >
          <span className={cn("size-1.5 rounded-full", style.dot)} />
          {STATUS_LABEL[mo.status]}
        </span>

        {mo.blocking_children_count > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50">
            <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden />
            Waiting on {mo.blocking_children_count} sub-MO
            {mo.blocking_children_count === 1 ? "" : "s"}
          </span>
        )}

        {mo.parent_mo && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300 dark:ring-indigo-900/50">
            <span className="size-1.5 rounded-full bg-indigo-500" aria-hidden />
            Feeds {mo.parent_mo.code ?? `MO #${mo.parent_mo.id}`}
          </span>
        )}

        {/* Shared-batch consumer pills */}
        {mo.consumer_links.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 ring-1 ring-inset ring-teal-200 dark:bg-teal-950/30 dark:text-teal-300 dark:ring-teal-900/50">
            <GitMerge className="size-3" />
            Also feeds {mo.consumer_links.length} other MO
            {mo.consumer_links.length === 1 ? "" : "s"}
          </span>
        )}

        {mo.supplier_links.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 ring-1 ring-inset ring-teal-200 dark:bg-teal-950/30 dark:text-teal-300 dark:ring-teal-900/50">
            <GitMerge className="size-3" />
            Supplied by shared batch{" "}
            {mo.supplier_links
              .map((l) => l.batch_mo?.code ?? `MO #${l.batch_mo?.id ?? "?"}`)
              .join(", ")}
          </span>
        )}

        {/* Action buttons */}
        <ActionStrip
          mo={mo}
          isChild={isChild}
          canPrepare={canPrepare}
          canApprove={canApprove}
          canExecute={canExecute}
          canEdit={canEdit}
          isPreparer={isPreparer}
          pending={pending}
          pendingLabel={pendingLabel}
          onPrepare={() => runSignature("Mark prepared", "prepare")}
          onUnprepare={() => runSignature("Unprepare", "unprepare")}
          onApprove={() => runSignature("Approve", "approve")}
          onReject={() => setRejectOpen(true)}
          onAmend={() => runSignature("Amend", "amend")}
          onStart={() => runStatus("Start", "in_progress")}
          onComplete={() => runStatus("Complete", "completed")}
          onCancel={() =>
            runStatus(
              "Cancel",
              "cancelled",
              "Cancel this MO? Active bookings will be released and draft sub-MOs cancelled.",
            )
          }
          onMerge={() => setMergeOpen(true)}
        />
      </div>

      {/* Rejection reason banner */}
      {mo.status === "draft" && mo.rejection_reason && (
        <div className="rounded-md border border-destructive/30 bg-destructive/[0.04] px-3 py-2 text-xs text-destructive">
          <p className="flex items-start gap-2">
            <XCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-medium">Rejected.</span>{" "}
              {mo.rejection_reason}
            </span>
          </p>
        </div>
      )}

      {/* Signature line */}
      {(mo.prepared_by || mo.approved_by) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {mo.prepared_by && mo.prepared_at && (
            <span className="inline-flex items-center gap-1">
              <PenSquare className="size-3 text-amber-700 dark:text-amber-300" />
              Prepared by{" "}
              <span className="font-medium text-foreground">
                {mo.prepared_by.name}
              </span>{" "}
              · {formatDateFns(new Date(mo.prepared_at), "dd MMM yyyy HH:mm")}
            </span>
          )}
          {mo.approved_by && mo.approved_at && (
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3 text-emerald-700 dark:text-emerald-300" />
              Approved by{" "}
              <span className="font-medium text-foreground">
                {mo.approved_by.name}
              </span>{" "}
              · {formatDateFns(new Date(mo.approved_at), "dd MMM yyyy HH:mm")}
            </span>
          )}
        </div>
      )}

      {/* Same-signer hint for the approver */}
      {mo.status === "prepared" && canApprove && isPreparer && (
        <p className="rounded-md border border-amber-500/30 bg-amber-50/40 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          You prepared this MO, so a different user needs to approve it (4-eyes rule).
        </p>
      )}

      {/* Child-MO approval hint */}
      {isChild && (mo.status === "draft" || mo.status === "prepared") && (
        <p className="text-[11px] text-muted-foreground">
          Approval is handled at{" "}
          {mo.parent_mo ? (
            <Link
              href={`/production/manufacturing-orders/${mo.parent_mo.uuid}`}
              className="font-medium text-brand hover:underline"
            >
              {mo.parent_mo.code ?? `MO #${mo.parent_mo.id}`}
            </Link>
          ) : (
            "the root MO"
          )}
          .
        </p>
      )}

      {actionError && (
        <ErrorBanner detail={actionError.detail} code={actionError.code} />
      )}

      {rejectOpen && (
        <RejectDialog
          open={rejectOpen}
          onOpenChange={setRejectOpen}
          onSubmit={submitReject}
          pending={pending && pendingLabel === "Reject"}
        />
      )}

      {mergeOpen && (
        <MergeIntoBatchDialog
          source={mo}
          company={company}
          open={mergeOpen}
          onOpenChange={setMergeOpen}
        />
      )}
    </div>
  );
}

interface ActionStripProps {
  mo: ManufacturingOrder;
  isChild: boolean;
  canPrepare: boolean;
  canApprove: boolean;
  canExecute: boolean;
  canEdit: boolean;
  isPreparer: boolean;
  pending: boolean;
  pendingLabel: string | null;
  onPrepare: () => void;
  onUnprepare: () => void;
  onApprove: () => void;
  onReject: () => void;
  onAmend: () => void;
  onStart: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onMerge: () => void;
}

function ActionStrip(props: ActionStripProps) {
  const {
    mo,
    isChild,
    canPrepare,
    canApprove,
    canExecute,
    canEdit,
    isPreparer,
    pending,
    pendingLabel,
  } = props;

  // Buttons rendered for the current status. Child MOs hide the
  // signature actions (prepare/approve/reject/amend) since approval
  // happens at the root.
  const buttons: React.ReactNode[] = [];

  function actionButton(opts: {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
    variant?: "default" | "outline" | "ghost";
    disabled?: boolean;
    title?: string;
    destructive?: boolean;
  }) {
    const Icon = opts.icon;
    const isThisPending = pending && pendingLabel === opts.label;
    buttons.push(
      <Button
        key={opts.label}
        type="button"
        size="sm"
        variant={opts.variant ?? "default"}
        disabled={pending || opts.disabled}
        onClick={opts.onClick}
        title={opts.title}
        className={
          opts.destructive
            ? "text-destructive hover:bg-destructive/10 hover:text-destructive"
            : undefined
        }
      >
        {isThisPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Icon className="size-3.5" />
        )}
        {opts.label}
      </Button>,
    );
  }

  if (mo.status === "draft" && !isChild && canPrepare) {
    actionButton({
      label: "Mark prepared",
      icon: ClipboardCheck,
      onClick: props.onPrepare,
    });
  }

  if (mo.status === "prepared" && !isChild) {
    if (canApprove) {
      actionButton({
        label: "Approve",
        icon: ShieldCheck,
        onClick: props.onApprove,
        disabled: isPreparer,
        title: isPreparer
          ? "You prepared this MO — a different user must approve it."
          : undefined,
      });
      actionButton({
        label: "Reject",
        icon: XCircle,
        onClick: props.onReject,
        variant: "outline",
        destructive: true,
      });
    }
    if (canPrepare && isPreparer) {
      actionButton({
        label: "Unprepare",
        icon: Undo2,
        onClick: props.onUnprepare,
        variant: "ghost",
      });
    }
  }

  if (mo.status === "approved") {
    if (canExecute) {
      actionButton({
        label: "Start",
        icon: Play,
        onClick: props.onStart,
        disabled: mo.blocking_children_count > 0,
        title:
          mo.blocking_children_count > 0
            ? "Finish or cancel every sub-MO before starting."
            : undefined,
      });
    }
    if (canApprove && !isChild) {
      actionButton({
        label: "Amend",
        icon: RotateCcw,
        onClick: props.onAmend,
        variant: "outline",
      });
    }
  }

  if (mo.status === "in_progress" && canExecute) {
    actionButton({
      label: "Complete",
      icon: CheckCircle2,
      onClick: props.onComplete,
    });
  }

  // Cancel is available at every pre-complete stage when canExecute.
  if (
    canExecute &&
    mo.status !== "completed" &&
    mo.status !== "cancelled"
  ) {
    actionButton({
      label: "Cancel",
      icon: CircleSlash,
      onClick: props.onCancel,
      variant: "ghost",
      destructive: true,
    });
  }

  // Merge-into-batch only on sub-MOs (must have a parent) that are
  // pre-execution and produce a semi-finished item.
  if (
    isChild &&
    canEdit &&
    (mo.status === "draft" || mo.status === "approved") &&
    mo.item?.item_type === "semi_finished"
  ) {
    actionButton({
      label: "Merge into batch",
      icon: GitMerge,
      onClick: props.onMerge,
      variant: "outline",
    });
  }

  if (buttons.length === 0) return null;

  return (
    <>
      <span className="h-5 w-px bg-border" aria-hidden />
      {buttons}
    </>
  );
}

function RejectDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim() === "") return;
    onSubmit(reason.trim());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject this MO</DialogTitle>
          <DialogDescription>
            Send the tree back to draft with a reason. The preparer will
            see your note as a banner and the audit log will record both
            signatures.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason" className="text-sm font-medium">
              Reason
            </Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="Why are you rejecting this run? Be specific so the preparer can fix it."
              required
              disabled={pending}
            />
          </div>

          <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50/40 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              The whole tree (this MO + every draft/prepared/approved child)
              will return to draft. Bookings stay put — they only release on
              cancel.
            </span>
          </p>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || reason.trim() === ""}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Reject
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
