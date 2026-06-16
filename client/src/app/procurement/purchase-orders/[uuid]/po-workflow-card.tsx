"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  Send,
  ShieldCheck,
  ShieldX,
  Truck,
  Workflow,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge-mini";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { PurchaseOrder, PurchaseOrderStatus } from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import {
  cancelPOAction,
  markOrderedAction,
  signApproverAction,
  signDirectorAction,
  submitPOAction,
} from "@/lib/purchase-orders/actions";

interface Props {
  po: PurchaseOrder;
  canSubmit: boolean;
  canApprove: boolean;
  canDirectorApprove: boolean;
  canCancel: boolean;
}

type DialogAction = "approver" | "director" | "cancel" | null;

export function POWorkflowCard({
  po,
  canSubmit,
  canApprove,
  canDirectorApprove,
  canCancel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openDialog, setOpenDialog] = useState<DialogAction>(null);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  function openSignDialog(kind: "approver" | "director") {
    setNotes("");
    setError(null);
    setOpenDialog(kind);
  }

  function openCancelDialog() {
    setReason("");
    setError(null);
    setOpenDialog("cancel");
  }

  function runDirect(promise: Promise<unknown>, label: string) {
    setError(null);
    startTransition(async () => {
      const res = (await promise) as { ok: boolean } & ErrorDebug & {
          detail?: string;
          code?: string;
        };
      if (res.ok) {
        toast.success(label);
        router.refresh();
      } else {
        const ed = res as unknown as {
          detail: string;
          code?: string;
          debug?: ErrorDebug;
        };
        setError({ detail: ed.detail, code: ed.code, debug: ed.debug });
        toast.error(ed.detail);
      }
    });
  }

  function onSubmit() {
    runDirect(submitPOAction(po.uuid), "PO submitted");
  }

  function onSign(kind: "approver" | "director") {
    setError(null);
    startTransition(async () => {
      const res =
        kind === "approver"
          ? await signApproverAction(po.uuid, notes.trim() || null)
          : await signDirectorAction(po.uuid, notes.trim() || null);
      if (res.ok) {
        toast.success("Signed");
        setOpenDialog(null);
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  function onMarkOrdered() {
    runDirect(markOrderedAction(po.uuid), "Marked as ordered");
  }

  function onCancel() {
    if (!reason.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await cancelPOAction(po.uuid, reason.trim());
      if (res.ok) {
        toast.success("PO cancelled");
        setOpenDialog(null);
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  const approverSig = po.approvals.find((a) => a.kind === "approver");
  const directorSig = po.approvals.find((a) => a.kind === "director");

  return (
    <section className="space-y-4 rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="flex items-center gap-2">
        <Workflow className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">Workflow</h2>
      </header>

      <StepRow
        status={po.status}
        step="draft"
        label="Draft"
        actor={po.created_by ?? null}
        timestamp={po.inserted_at}
      />
      <StepRow
        status={po.status}
        step="pending_approver"
        label="Submitted for approval"
        actor={po.submitted_by}
        timestamp={po.submitted_at}
      />
      <StepRow
        status={po.status}
        step="pending_director"
        label="Approver sign-off"
        actor={approverSig?.signed_by ?? null}
        timestamp={approverSig?.signed_at ?? null}
        notes={approverSig?.notes ?? null}
      />
      <StepRow
        status={po.status}
        step="approved"
        label="Director sign-off"
        actor={directorSig?.signed_by ?? null}
        timestamp={directorSig?.signed_at ?? null}
        notes={directorSig?.notes ?? null}
      />
      <StepRow
        status={po.status}
        step="ordered"
        label="Sent to vendor"
        actor={po.ordered_by}
        timestamp={po.ordered_at}
      />
      {/* "Received" rolls in once the goods-in operator signs the
          inspection on the phone — that flow auto-calls
          `receive_against_po` and stamps `received_by` with the
          operator. Empty state (no actor, no timestamp) renders as
          pending until that happens. */}
      <StepRow
        status={po.status}
        step="received"
        label="Received"
        actor={po.received_by}
        timestamp={po.received_at}
      />

      {po.status === "cancelled" && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive">
            Cancelled by {po.cancelled_by?.name ?? "—"}
          </p>
          {po.cancellation_reason && (
            <p className="mt-1 text-xs">{po.cancellation_reason}</p>
          )}
        </div>
      )}

      {error && (
        <ErrorBanner
          detail={error.detail}
          code={error.code}
          debug={error.debug}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {po.status === "draft" && canSubmit && (
          <Button size="sm" onClick={onSubmit} disabled={pending}>
            {pending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            <Send className="mr-1.5 size-4" />
            Submit for approval
          </Button>
        )}
        {po.status === "pending_approver" && canApprove && (
          <Button
            size="sm"
            onClick={() => openSignDialog("approver")}
            disabled={pending}
          >
            <ShieldCheck className="mr-1.5 size-4" />
            Sign as approver
          </Button>
        )}
        {po.status === "pending_director" && canDirectorApprove && (
          <Button
            size="sm"
            onClick={() => openSignDialog("director")}
            disabled={pending}
          >
            <ShieldCheck className="mr-1.5 size-4" />
            Sign as director
          </Button>
        )}
        {po.status === "approved" && canDirectorApprove && (
          <Button
            size="sm"
            onClick={onMarkOrdered}
            disabled={pending}
          >
            {pending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            <Truck className="mr-1.5 size-4" />
            Mark as ordered
          </Button>
        )}
        {canCancel &&
          !["received", "cancelled"].includes(po.status) && (
            <Button
              size="sm"
              variant="outline"
              onClick={openCancelDialog}
              disabled={pending}
            >
              <ShieldX className="mr-1.5 size-4" />
              Cancel PO
            </Button>
          )}
      </div>

      <Dialog
        open={openDialog === "approver" || openDialog === "director"}
        onOpenChange={(o) => !o && setOpenDialog(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {openDialog === "approver"
                ? "Sign as approver"
                : "Sign as director"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Your name and the current time will be stamped onto the PO.
              {openDialog === "director" &&
                " The director signature must be a different user from the approver."}
            </p>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Notes (optional)
              </Label>
              <Textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            {error && (
              <ErrorBanner
                detail={error.detail}
                code={error.code}
                debug={error.debug}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                openDialog === "approver" ? onSign("approver") : onSign("director")
              }
              disabled={pending}
            >
              {pending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              <CheckCircle2 className="mr-1.5 size-4" />
              Sign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openDialog === "cancel"}
        onOpenChange={(o) => !o && setOpenDialog(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel purchase order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Reason
              </Label>
              <Textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Required — what's the reason for cancelling?"
              />
            </div>
            {error && (
              <ErrorBanner
                detail={error.detail}
                code={error.code}
                debug={error.debug}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(null)}>
              Keep
            </Button>
            <Button
              variant="destructive"
              onClick={onCancel}
              disabled={pending || !reason.trim()}
            >
              {pending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Cancel PO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

const STEP_ORDER: PurchaseOrderStatus[] = [
  "draft",
  "pending_approver",
  "pending_director",
  "approved",
  "ordered",
  "partially_received",
  "received",
];

function StepRow({
  status,
  step,
  label,
  actor,
  timestamp,
  notes,
}: {
  status: PurchaseOrderStatus;
  step: PurchaseOrderStatus;
  label: string;
  actor: { name: string } | null;
  timestamp: string | null;
  notes?: string | null;
}) {
  const currentIdx = STEP_ORDER.indexOf(status);
  const stepIdx = STEP_ORDER.indexOf(step);
  // "Received" is the terminal step + has an in-flight `partially_received`
  // sibling status. Treat the pair explicitly so the row turns emerald
  // once the PO is fully received (no later step exists to flip
  // `done` via the default rule) and amber while partial.
  const done =
    step === "received"
      ? status === "received"
      : currentIdx >= 0 && currentIdx >= stepIdx + 1;
  const current =
    step === "received"
      ? status === "partially_received"
      : status === step;

  return (
    <div
      className={`flex items-start gap-3 rounded-md border px-3 py-2 ${
        done
          ? "border-emerald-500/30 bg-emerald-500/5"
          : current
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-border/40 bg-muted/20"
      }`}
    >
      <div
        className={`mt-0.5 flex size-5 items-center justify-center rounded-full text-[10px] font-semibold ${
          done
            ? "bg-emerald-500 text-white"
            : current
              ? "bg-amber-500 text-white"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {done ? "✓" : stepIdx + 1}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        {actor && timestamp ? (
          <p className="text-[11px] text-muted-foreground">
            {actor.name} · {new Date(timestamp).toLocaleString()}
          </p>
        ) : current ? (
          <p className="text-[11px] text-muted-foreground">Awaiting action.</p>
        ) : (
          <p className="text-[11px] text-muted-foreground/60">Not yet.</p>
        )}
        {notes && (
          <p className="rounded-md border border-border/40 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground">
            {notes}
          </p>
        )}
      </div>
      {current && <Badge tone="amber">Current</Badge>}
      {done && <Badge tone="emerald">Done</Badge>}
    </div>
  );
}
