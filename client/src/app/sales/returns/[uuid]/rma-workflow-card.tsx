"use client";

/**
 * RMA workflow card. State machine: draft → received → accepted /
 * rejected / cancelled (cancelled is also reachable from draft).
 *
 * Accept opens a dialog that lets quality set per-line qty_accepted +
 * inspection notes, then optionally auto-issues a credit note against
 * the source invoice. Reject + Cancel both require a reason.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Loader2,
  PackageOpen,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import type {
  CompanyDefaults,
  CustomerReturn,
  CustomerReturnStatus,
} from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import {
  acceptRMAAction,
  cancelRMAAction,
  markRMAReceivedAction,
  rejectRMAAction,
  type CRAcceptInput,
} from "@/lib/customer-returns/actions";
import {
  formatCompanyDate,
  formatCompanyNumber,
} from "@/lib/format/company";

const STATUS_LABEL: Record<CustomerReturnStatus, string> = {
  draft: "Draft",
  received: "Received",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<
  CustomerReturnStatus,
  "emerald" | "amber" | "sky" | "muted" | "destructive"
> = {
  draft: "muted",
  received: "sky",
  accepted: "emerald",
  rejected: "destructive",
  cancelled: "muted",
};

const STATUS_ICON: Record<CustomerReturnStatus, typeof CircleDashed> = {
  draft: CircleDashed,
  received: PackageOpen,
  accepted: CheckCircle2,
  rejected: ShieldX,
  cancelled: Ban,
};

type ActionKey = "receive" | "accept" | "reject" | "cancel";

interface Props {
  rma: CustomerReturn;
  canEdit: boolean;
  canReceive: boolean;
  canResolve: boolean;
  prefs: CompanyDefaults;
}

export function RMAWorkflowCard({
  rma,
  canEdit,
  canReceive,
  canResolve,
  prefs,
}: Props) {
  const [openAction, setOpenAction] = useState<ActionKey | null>(null);
  const Icon = STATUS_ICON[rma.status];

  const showReceive = canReceive && rma.status === "draft" && rma.lines.length > 0;
  const showAccept = canResolve && rma.status === "received";
  const showReject = canResolve && rma.status === "received";
  const showCancel =
    canEdit && (rma.status === "draft" || rma.status === "received");

  const isTerminal =
    rma.status === "accepted" ||
    rma.status === "rejected" ||
    rma.status === "cancelled";

  const totalCredit = rma.lines.reduce(
    (sum, line) => sum + Number(line.line_credit_amount ?? "0"),
    0,
  );
  const currency = rma.customer?.currency_code ?? "GBP";

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="size-4 text-muted-foreground" />
              Workflow
              <Badge tone={STATUS_TONE[rma.status]}>
                {STATUS_LABEL[rma.status]}
              </Badge>
            </CardTitle>
            <CardDescription>
              Mark received once goods are physically back. Then quality
              inspects per-line — accept (auto-issues a credit note) or
              reject with reason.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Money summary — only meaningful once accepted */}
        {rma.status === "accepted" && (
          <div className="rounded-md border border-border/40 bg-muted/30 px-4 py-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Credit issued
                </dt>
                <dd className="mt-0.5 font-mono text-sm font-semibold">
                  {formatCompanyNumber(String(totalCredit.toFixed(2)), prefs)}{" "}
                  {currency}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Lines accepted
                </dt>
                <dd className="mt-0.5 font-mono text-sm">
                  {rma.lines.filter((l) => Number(l.qty_accepted ?? "0") > 0).length}
                  /{rma.lines.length}
                </dd>
              </div>
            </dl>
          </div>
        )}

        {/* Stamp history */}
        <ul className="space-y-1.5">
          {rma.received_at && rma.received_by && (
            <StampRow
              icon={PackageOpen}
              label="Received"
              actor={rma.received_by.name}
              at={formatCompanyDate(rma.received_at, prefs)}
              tone="sky"
            />
          )}
          {rma.resolved_at && rma.resolved_by && rma.status === "accepted" && (
            <StampRow
              icon={CheckCircle2}
              label="Accepted"
              actor={rma.resolved_by.name}
              at={formatCompanyDate(rma.resolved_at, prefs)}
              tone="emerald"
            />
          )}
          {rma.resolved_at && rma.resolved_by && rma.status === "rejected" && (
            <StampRow
              icon={ShieldX}
              label="Rejected"
              actor={rma.resolved_by.name}
              at={formatCompanyDate(rma.resolved_at, prefs)}
              tone="destructive"
              notes={rma.rejection_reason}
            />
          )}
          {rma.cancelled_at && rma.cancelled_by && (
            <StampRow
              icon={Ban}
              label="Cancelled"
              actor={rma.cancelled_by.name}
              at={formatCompanyDate(rma.cancelled_at, prefs)}
              tone="muted"
              notes={rma.cancellation_reason}
            />
          )}
        </ul>

        {!isTerminal &&
          (showReceive || showAccept || showReject || showCancel) && (
            <div className="border-t border-border/60 pt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Actions
              </p>
              <div className="flex flex-wrap gap-2">
                {showReceive && (
                  <Button size="sm" onClick={() => setOpenAction("receive")}>
                    <PackageOpen className="mr-1.5 size-3.5" />
                    Mark received
                  </Button>
                )}
                {showAccept && (
                  <Button size="sm" onClick={() => setOpenAction("accept")}>
                    <CheckCircle2 className="mr-1.5 size-3.5" />
                    Accept & inspect
                  </Button>
                )}
                {showReject && (
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
                {showCancel && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setOpenAction("cancel")}
                  >
                    <Ban className="mr-1.5 size-3.5" />
                    Cancel RMA
                  </Button>
                )}
              </div>
              {rma.lines.length === 0 && rma.status === "draft" && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Add at least one line below before marking received.
                </p>
              )}
            </div>
          )}

        <ReceiveDialog
          open={openAction === "receive"}
          onClose={() => setOpenAction(null)}
          rma={rma}
        />
        <AcceptDialog
          open={openAction === "accept"}
          onClose={() => setOpenAction(null)}
          rma={rma}
          prefs={prefs}
        />
        <ReasonDialog
          open={openAction === "reject"}
          onClose={() => setOpenAction(null)}
          title="Reject RMA"
          description="Reject every line on this return — terminal. Use a clear reason; the customer may dispute the decision."
          confirmLabel="Reject RMA"
          run={(reason) => rejectRMAAction(rma.uuid, reason)}
          successMsg="RMA rejected"
        />
        <ReasonDialog
          open={openAction === "cancel"}
          onClose={() => setOpenAction(null)}
          title="Cancel RMA"
          description="Cancel this RMA before resolving it. Use this when the customer rescinded the return; for goods we received but won't credit, reject instead."
          confirmLabel="Cancel RMA"
          run={(reason) => cancelRMAAction(rma.uuid, reason)}
          successMsg="RMA cancelled"
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
      ? "text-sky-700 dark:text-sky-400"
      : tone === "emerald"
        ? "text-emerald-700 dark:text-emerald-400"
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
  rma: CustomerReturn;
}

function useActionRunner(onClose: () => void) {
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

function ReceiveDialog({ open, onClose, rma }: DialogProps) {
  const { pending, error, run } = useActionRunner(onClose);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark RMA received</DialogTitle>
          <DialogDescription>
            Confirms goods are physically back in our warehouse. Locks
            header + line edits and unlocks the inspection workflow for
            quality.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-[11px]">
            <p className="font-medium">After receive:</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              <li>• Header + line edits locked</li>
              <li>• Quality can set qty_accepted per line</li>
              <li>• Accept / Reject buttons unlock</li>
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
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Back
          </Button>
          <Button
            type="button"
            onClick={() =>
              run(() => markRMAReceivedAction(rma.uuid), "RMA marked received")
            }
            disabled={pending}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            <PackageOpen className="mr-1.5 size-4" />
            Mark received
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AcceptDialog({
  open,
  onClose,
  rma,
  prefs,
}: DialogProps & { prefs: CompanyDefaults }) {
  const { pending, error, run } = useActionRunner(onClose);

  // Local state for per-line decisions. Pre-populated with the
  // qty_accepted already stamped on each line (quality may set those
  // line-by-line on the lines card before opening this dialog).
  const [decisions, setDecisions] = useState<
    Record<string, { qty: string; notes: string }>
  >({});

  useEffect(() => {
    if (!open) return;
    const next: Record<string, { qty: string; notes: string }> = {};
    for (const line of rma.lines) {
      next[line.uuid] = {
        qty: line.qty_accepted ?? line.qty_returned,
        notes: line.inspection_notes ?? "",
      };
    }
    setDecisions(next);
  }, [open, rma]);

  const [issueCreditNote, setIssueCreditNote] = useState<boolean>(
    Boolean(rma.customer_invoice_id),
  );

  const currency = rma.customer?.currency_code ?? "GBP";

  const previewCredit = rma.lines.reduce((sum, line) => {
    const qtyAcc = Number(decisions[line.uuid]?.qty ?? "0");
    const price = Number(line.unit_price ?? "0");
    return sum + (Number.isFinite(qtyAcc * price) ? qtyAcc * price : 0);
  }, 0);

  const anyAccepted = rma.lines.some(
    (line) => Number(decisions[line.uuid]?.qty ?? "0") > 0,
  );

  function buildInput(): CRAcceptInput {
    const lineDecisions: CRAcceptInput["line_decisions"] = {};
    for (const line of rma.lines) {
      const d = decisions[line.uuid];
      if (!d) continue;
      lineDecisions[line.uuid] = {
        qty_accepted: d.qty,
        inspection_notes: d.notes.trim() || null,
      };
    }
    return {
      line_decisions: lineDecisions,
      issue_credit_note: issueCreditNote,
    };
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Accept RMA</DialogTitle>
          <DialogDescription>
            Quality sign-off. Set how many units we&rsquo;re accepting per
            line — at least one line must have a positive accepted qty. If
            an invoice was linked, a credit note is auto-issued for the
            accepted value.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <ul className="divide-y divide-border/60 overflow-hidden rounded-md border border-border/60">
            <li className="grid grid-cols-[minmax(0,1fr)_90px_90px_minmax(0,1.2fr)] items-center gap-3 bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Item</span>
              <span className="text-right">Returned</span>
              <span className="text-right">Accepted</span>
              <span>Inspection notes</span>
            </li>
            {rma.lines.map((line) => {
              const d = decisions[line.uuid] ?? { qty: "0", notes: "" };
              return (
                <li
                  key={line.uuid}
                  className="grid grid-cols-[minmax(0,1fr)_90px_90px_minmax(0,1.2fr)] items-center gap-3 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {line.item?.name ?? "—"}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {line.reason_code.replace(/_/g, " ")}
                    </p>
                  </div>
                  <span className="text-right font-mono">
                    {line.qty_returned}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    max={Number(line.qty_returned)}
                    step="any"
                    value={d.qty}
                    onChange={(e) =>
                      setDecisions((prev) => ({
                        ...prev,
                        [line.uuid]: { ...d, qty: e.target.value },
                      }))
                    }
                    className="h-9 text-right font-mono"
                  />
                  <Input
                    value={d.notes}
                    onChange={(e) =>
                      setDecisions((prev) => ({
                        ...prev,
                        [line.uuid]: { ...d, notes: e.target.value },
                      }))
                    }
                    placeholder="Optional"
                    className="h-9"
                  />
                </li>
              );
            })}
          </ul>

          {rma.customer_invoice_id && (
            <label className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
              <Checkbox
                checked={issueCreditNote}
                onCheckedChange={(v) => setIssueCreditNote(Boolean(v))}
              />
              <div>
                <p className="font-medium">Issue credit note</p>
                <p className="text-muted-foreground">
                  Auto-creates a sent credit-note invoice for the accepted
                  value, linked back to this RMA + the source invoice.
                  Outstanding A/R drops by the same amount.
                </p>
              </div>
            </label>
          )}

          <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
            <p className="text-muted-foreground">Preview credit</p>
            <p className="font-mono text-base font-semibold">
              {formatCompanyNumber(previewCredit.toFixed(2), prefs)} {currency}
            </p>
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
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Back
          </Button>
          <Button
            type="button"
            onClick={() =>
              run(
                async () => {
                  const res = await acceptRMAAction(rma.uuid, buildInput());
                  return res;
                },
                issueCreditNote && rma.customer_invoice_id
                  ? "RMA accepted — credit note issued"
                  : "RMA accepted",
              )
            }
            disabled={pending || !anyAccepted}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            <CheckCircle2 className="mr-1.5 size-4" />
            Accept RMA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  run: runner,
  successMsg,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  run: (reason: string) => Promise<
    | { ok: true }
    | { ok: false; detail: string; code: string; debug?: ErrorDebug }
  >;
  successMsg: string;
}) {
  const [reason, setReason] = useState("");
  const { pending, error, run } = useActionRunner(() => {
    setReason("");
    onClose();
  });
  const reasonMissing = !reason.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Back
          </Button>
          <Button
            type="button"
            variant="outline"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => run(() => runner(reason.trim()), successMsg)}
            disabled={pending || reasonMissing}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
