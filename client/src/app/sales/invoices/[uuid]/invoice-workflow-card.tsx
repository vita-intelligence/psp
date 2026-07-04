"use client";

/**
 * Invoice workflow card. Smaller cousin of the CO workflow card —
 * no 2-tier ESIGN; the gates that matter are Send (validates
 * customer approved + lines + positive total) and Cancel (only
 * allowed pre-payment).
 *
 * The Payments card sits below this one and runs its own actions.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  CircleDashed,
  Coins,
  Loader2,
  Send,
  ShieldX,
} from "lucide-react";
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
import { usePageLeadership } from "@/components/realtime/page-lock-guard";
import { Badge } from "@/components/ui/badge-mini";
import type {
  CompanyDefaults,
  CustomerInvoice,
  CustomerInvoiceStatus,
} from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import {
  cancelCustomerInvoiceAction,
  sendCustomerInvoiceAction,
} from "@/lib/customer-invoices/actions";
import {
  formatCompanyDate,
  formatCompanyNumber,
} from "@/lib/format/company";

const STATUS_LABEL: Record<CustomerInvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<
  CustomerInvoiceStatus,
  "emerald" | "amber" | "sky" | "muted" | "destructive"
> = {
  draft: "muted",
  sent: "amber",
  partially_paid: "sky",
  paid: "emerald",
  cancelled: "destructive",
};

const STATUS_ICON: Record<CustomerInvoiceStatus, typeof CircleDashed> = {
  draft: CircleDashed,
  sent: Send,
  partially_paid: Coins,
  paid: CheckCircle2,
  cancelled: ShieldX,
};

type ActionKey = "send" | "cancel";

interface Props {
  invoice: CustomerInvoice;
  canEdit: boolean;
  canSend: boolean;
  prefs: CompanyDefaults;
  pageId?: string;
}

export function InvoiceWorkflowCard({
  invoice,
  canEdit,
  canSend,
  prefs,
  pageId,
}: Props) {
  const { isLeader, leader } = usePageLeadership(pageId ?? "", !pageId);
  const locked = !!pageId && !isLeader && !!leader;
  const [openAction, setOpenAction] = useState<ActionKey | null>(null);
  const Icon = STATUS_ICON[invoice.status];

  const showSend = canSend && invoice.status === "draft";
  const showCancel =
    canEdit &&
    invoice.status !== "paid" &&
    invoice.status !== "cancelled" &&
    invoice.payments.every((p) => Number(p.amount) <= 0);

  const isTerminal = invoice.status === "paid" || invoice.status === "cancelled";

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="size-4 text-muted-foreground" />
              Workflow
              <Badge tone={STATUS_TONE[invoice.status]}>
                {STATUS_LABEL[invoice.status]}
              </Badge>
            </CardTitle>
            <CardDescription>
              Send the invoice to lock edits + start the payment clock.
              Multiple partial payments per invoice; status auto-flips on
              each one.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Money summary line */}
        <div className="rounded-md border border-border/40 bg-muted/30 px-4 py-3">
          <dl className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Grand total
              </dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold">
                {formatCompanyNumber(invoice.grand_total, prefs)}{" "}
                {invoice.currency_code}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Paid
              </dt>
              <dd className="mt-0.5 font-mono text-sm">
                {formatCompanyNumber(invoice.paid_amount, prefs)}{" "}
                {invoice.currency_code}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Outstanding
              </dt>
              <dd
                className={`mt-0.5 font-mono text-sm font-semibold ${
                  Number(invoice.outstanding) > 0 && invoice.status !== "cancelled"
                    ? "text-amber-700 dark:text-amber-400"
                    : ""
                }`}
              >
                {formatCompanyNumber(invoice.outstanding, prefs)}{" "}
                {invoice.currency_code}
              </dd>
            </div>
          </dl>
        </div>

        {/* Stamp history */}
        <ul className="space-y-1.5">
          {invoice.sent_at && invoice.sent_by && (
            <StampRow
              icon={Send}
              label="Sent"
              actor={invoice.sent_by.name}
              at={formatCompanyDate(invoice.sent_at, prefs)}
              tone="amber"
            />
          )}
          {invoice.cancelled_at && invoice.cancelled_by && (
            <StampRow
              icon={ShieldX}
              label="Cancelled"
              actor={invoice.cancelled_by.name}
              at={formatCompanyDate(invoice.cancelled_at, prefs)}
              tone="destructive"
              notes={invoice.cancellation_reason}
            />
          )}
        </ul>

        {/* Actions */}
        {!isTerminal && (showSend || showCancel) && (
          <div className="border-t border-border/60 pt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Actions
            </p>
            <div className="flex flex-wrap gap-2">
              {showSend && (
                <Button
                  size="sm"
                  onClick={() => {
                    if (locked) return;
                    setOpenAction("send");
                  }}
                  disabled={locked}
                  title={locked ? "Only the head of the room can act here." : undefined}
                >
                  <Send className="mr-1.5 size-3.5" />
                  Send invoice
                </Button>
              )}
              {showCancel && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:bg-destructive/10"
                  disabled={locked}
                  title={locked ? "Only the head of the room can act here." : undefined}
                  onClick={() => {
                    if (locked) return;
                    setOpenAction("cancel");
                  }}
                >
                  <ShieldX className="mr-1.5 size-3.5" />
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}

        <SendDialog
          open={openAction === "send"}
          onClose={() => setOpenAction(null)}
          invoice={invoice}
        />
        <CancelDialog
          open={openAction === "cancel"}
          onClose={() => setOpenAction(null)}
          invoice={invoice}
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
  tone?: "muted" | "amber" | "destructive";
  notes?: string | null;
}) {
  const toneClass =
    tone === "amber"
      ? "text-amber-700 dark:text-amber-400"
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
  invoice: CustomerInvoice;
}

function useActionRunner(invoice: CustomerInvoice, onClose: () => void) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  function run(
    runner: () => Promise<
      | { ok: true }
      | { ok: false; detail: string; code: string; debug?: ErrorDebug }
    >,
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

function SendDialog({ open, onClose, invoice }: DialogProps) {
  const { pending, error, run } = useActionRunner(invoice, onClose);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send invoice</DialogTitle>
          <DialogDescription>
            Locks lines + header edits and flips status to{" "}
            <strong>sent</strong>. Server-side gates: customer must be
            effectively approved, lines must be present, grand total must be
            positive.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-[11px]">
            <p className="font-medium">After send:</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              <li>• Header + line edits locked</li>
              <li>
                • Outstanding A/R counts this invoice toward the customer&rsquo;s
                trade-credit-limit
              </li>
              <li>• Payments can be recorded</li>
            </ul>
          </div>
          {error && (
            <ErrorBanner
              detail={error.detail}
              code={error.code}
              debug={error.debug}
            />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() =>
              run(() => sendCustomerInvoiceAction(invoice.uuid), "Invoice sent")
            }
            disabled={pending}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            <Send className="mr-1.5 size-4" />
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ open, onClose, invoice }: DialogProps) {
  const [reason, setReason] = useState("");
  const { pending, error, run } = useActionRunner(invoice, onClose);
  const reasonMissing = !reason.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel invoice</DialogTitle>
          <DialogDescription>
            Sets the invoice to <strong>cancelled</strong> — terminal. Once
            any positive payment is recorded, cancel is blocked; issue a
            negative payment (refund) first.
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
              placeholder="Why is this invoice being cancelled?"
              required
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

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={pending}
          >
            Back
          </Button>
          <Button
            type="button"
            variant="outline"
            className="text-destructive hover:bg-destructive/10"
            onClick={() =>
              run(
                () => cancelCustomerInvoiceAction(invoice.uuid, reason.trim()),
                "Invoice cancelled",
              )
            }
            disabled={pending || reasonMissing}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            <ShieldX className="mr-1.5 size-4" />
            Cancel invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
