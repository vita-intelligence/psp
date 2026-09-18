"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  ClipboardSignature,
  Loader2,
  Lock,
  RotateCcw,
  Send,
  Trash2,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge-mini";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorDebug } from "@/lib/errors/types";
import type { StockWriteOff } from "@/lib/types";
import {
  STOCK_MOVEMENT_REASON_CATEGORY_LABEL,
  STOCK_WRITE_OFF_DISPOSAL_METHOD_LABEL,
  STOCK_WRITE_OFF_STATUS_LABEL,
} from "@/lib/types";
import {
  formatCompanyDate,
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import {
  approveWriteOffAction,
  authoriseWriteOffAction,
  deleteWriteOffAction,
  rejectWriteOffAction,
  revertWriteOffAction,
  submitWriteOffAction,
} from "@/lib/stock/actions";

interface Props {
  writeOff: StockWriteOff;
  currentUserId: number;
  canApprove: boolean;
  canAuthorise: boolean;
  canRevert: boolean;
}

type ActionKind = "approve" | "authorise" | "reject" | "revert";

export function WriteOffDetail({
  writeOff,
  currentUserId,
  canApprove,
  canAuthorise,
  canRevert,
}: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();
  const [pending, startTransition] = useTransition();
  const [pinAction, setPinAction] = useState<ActionKind | null>(null);
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  const wo = writeOff;
  const isCreator = wo.created_by?.id === currentUserId;
  const isPreviousApprover = wo.approved_by?.id === currentUserId;
  const status = wo.status;

  const value = useMemo(() => {
    if (!wo.total_value) return null;
    return formatCompanyMoney(wo.total_value, prefs, {
      currency_code: wo.currency_snapshot,
    });
  }, [wo.total_value, wo.currency_snapshot, prefs]);

  const uomSymbol = wo.unit_of_measurement?.symbol ?? "";

  function refreshAfter() {
    router.refresh();
  }

  function submitDraft() {
    setError(null);
    startTransition(async () => {
      const res = await submitWriteOffAction(wo.uuid);
      if (res.ok) {
        toast.success("Sent for approval");
        refreshAfter();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  function deleteDraft() {
    if (!confirm("Delete this draft? Nothing has been written to stock yet.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteWriteOffAction(wo.uuid);
      if (res.ok) {
        toast.success("Draft deleted");
        router.push("/stock/write-offs");
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        {/* --------- Summary card --------- */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-sm">Details</CardTitle>
            </div>
            <StatusPill status={status} />
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              <Field label="Quantity">
                <span className="font-mono font-semibold text-rose-600 dark:text-rose-500">
                  −{formatCompanyNumber(wo.qty, prefs)} {uomSymbol}
                </span>
              </Field>
              <Field label="Value">{value ?? "—"}</Field>
              <Field label="Reason">
                {STOCK_MOVEMENT_REASON_CATEGORY_LABEL[wo.reason_category] ??
                  wo.reason_category}
              </Field>
              <Field label="Disposal method">
                {STOCK_WRITE_OFF_DISPOSAL_METHOD_LABEL[wo.disposal_method] ??
                  wo.disposal_method}
              </Field>
              <Field label="Filed">
                {formatCompanyDate(wo.inserted_at, prefs)}
              </Field>
              <Field label="Activated">
                {wo.activated_at ? formatCompanyDate(wo.activated_at, prefs) : "—"}
              </Field>
            </dl>
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                Narrative
              </p>
              <p className="whitespace-pre-wrap rounded-md border border-border/60 bg-muted/20 p-3 text-xs leading-relaxed">
                {wo.reason_narrative}
              </p>
            </div>

            {error && (
              <ErrorBanner
                detail={error.detail}
                code={error.code}
                debug={error.debug}
              />
            )}
          </CardContent>
        </Card>

        {/* --------- Signatures --------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Signatures</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <SigRow
              label="Creator"
              actor={wo.created_by?.name ?? wo.created_by?.email ?? null}
              at={wo.submitted_at ?? wo.inserted_at}
              prefs={prefs}
              done
            />
            <SigRow
              label="Approver"
              actor={wo.approved_by?.name ?? wo.approved_by?.email ?? null}
              at={wo.approved_at}
              note={wo.approved_note}
              prefs={prefs}
              done={!!wo.approved_at}
            />
            <SigRow
              label="Authoriser"
              actor={wo.authorised_by?.name ?? wo.authorised_by?.email ?? null}
              at={wo.authorised_at}
              note={wo.authorised_note}
              prefs={prefs}
              done={!!wo.authorised_at}
            />
            {wo.reverted_at && (
              <SigRow
                label="Reverted"
                actor={wo.reverted_by?.name ?? wo.reverted_by?.email ?? null}
                at={wo.reverted_at}
                note={wo.revert_reason}
                prefs={prefs}
                done
                tone="destructive"
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* --------- Action bar --------- */}
      <ActionBar
        status={status}
        isCreator={isCreator}
        isPreviousApprover={isPreviousApprover}
        canApprove={canApprove}
        canAuthorise={canAuthorise}
        canRevert={canRevert}
        pending={pending}
        onSubmit={submitDraft}
        onDelete={deleteDraft}
        onApprove={() => setPinAction("approve")}
        onAuthorise={() => setPinAction("authorise")}
        onReject={() => setPinAction("reject")}
        onRevert={() => setPinAction("revert")}
      />

      {pinAction && (
        <PinModal
          kind={pinAction}
          writeOffCode={wo.code ?? wo.uuid.slice(0, 8)}
          open
          onClose={() => setPinAction(null)}
          onSuccess={refreshAfter}
        >
          {(inputs) => {
            switch (pinAction) {
              case "approve":
                return approveWriteOffAction(wo.uuid, inputs);
              case "authorise":
                return authoriseWriteOffAction(wo.uuid, inputs);
              case "reject":
                return rejectWriteOffAction(wo.uuid, {
                  password: inputs.password,
                  note: inputs.note ?? "",
                });
              case "revert":
                return revertWriteOffAction(wo.uuid, {
                  password: inputs.password,
                  reason: inputs.note ?? "",
                });
            }
          }}
        </PinModal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: StockWriteOff["status"] }) {
  const tone: "muted" | "amber" | "emerald" | "destructive" =
    status === "active"
      ? "emerald"
      : status === "reverted"
        ? "destructive"
        : status === "draft"
          ? "muted"
          : "amber";
  return <Badge tone={tone}>{STOCK_WRITE_OFF_STATUS_LABEL[status]}</Badge>;
}

function SigRow({
  label,
  actor,
  at,
  note,
  prefs,
  done,
  tone,
}: {
  label: string;
  actor: string | null;
  at: string | null;
  note?: string | null;
  prefs: ReturnType<typeof useFormatPrefs>;
  done: boolean;
  tone?: "destructive";
}) {
  return (
    <div
      className={`rounded-md border p-2.5 ${
        done
          ? tone === "destructive"
            ? "border-destructive/40 bg-destructive/5"
            : "border-emerald-500/30 bg-emerald-500/5"
          : "border-border/40 bg-muted/20"
      }`}
    >
      <div className="flex items-center justify-between">
        <p
          className={`text-[10px] font-semibold uppercase tracking-wider ${
            done && tone !== "destructive" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
          }`}
        >
          {label}
        </p>
        {done ? (
          <CheckCircle2
            className={`size-3.5 ${
              tone === "destructive"
                ? "text-destructive"
                : "text-emerald-600 dark:text-emerald-500"
            }`}
          />
        ) : (
          <Lock className="size-3.5 text-muted-foreground/50" />
        )}
      </div>
      {done ? (
        <>
          <p className="mt-1 text-xs font-medium">{actor ?? "—"}</p>
          <p className="text-[10px] text-muted-foreground">
            {at ? formatCompanyDate(at, prefs) : "—"}
          </p>
          {note && (
            <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
              {note}
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 text-[11px] italic text-muted-foreground/70">Pending…</p>
      )}
    </div>
  );
}

function ActionBar({
  status,
  isCreator,
  isPreviousApprover,
  canApprove,
  canAuthorise,
  canRevert,
  pending,
  onSubmit,
  onDelete,
  onApprove,
  onAuthorise,
  onReject,
  onRevert,
}: {
  status: StockWriteOff["status"];
  isCreator: boolean;
  isPreviousApprover: boolean;
  canApprove: boolean;
  canAuthorise: boolean;
  canRevert: boolean;
  pending: boolean;
  onSubmit: () => void;
  onDelete: () => void;
  onApprove: () => void;
  onAuthorise: () => void;
  onReject: () => void;
  onRevert: () => void;
}) {
  const showSubmit = status === "draft" && isCreator;
  const showDelete = status === "draft" && isCreator;
  const showApprove = status === "pending_approval" && canApprove && !isCreator;
  const showAuthorise =
    status === "pending_authorisation" &&
    canAuthorise &&
    !isCreator &&
    !isPreviousApprover;
  const showReject =
    (status === "pending_approval" || status === "pending_authorisation") &&
    (canApprove || canAuthorise) &&
    !isCreator;
  const showRevert = status === "active" && canRevert;

  if (
    !showSubmit &&
    !showDelete &&
    !showApprove &&
    !showAuthorise &&
    !showReject &&
    !showRevert
  ) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card p-3">
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      {showSubmit && (
        <Button size="sm" onClick={onSubmit} disabled={pending}>
          <Send className="mr-1.5 size-3.5" />
          Submit for review
        </Button>
      )}
      {showApprove && (
        <Button size="sm" onClick={onApprove} disabled={pending}>
          <ClipboardSignature className="mr-1.5 size-3.5" />
          Approve
        </Button>
      )}
      {showAuthorise && (
        <Button size="sm" onClick={onAuthorise} disabled={pending}>
          <ClipboardSignature className="mr-1.5 size-3.5" />
          Authorise
        </Button>
      )}
      {showReject && (
        <Button size="sm" variant="outline" onClick={onReject} disabled={pending}>
          <XCircle className="mr-1.5 size-3.5" />
          Reject back to draft
        </Button>
      )}
      {showRevert && (
        <Button size="sm" variant="outline" onClick={onRevert} disabled={pending}>
          <RotateCcw className="mr-1.5 size-3.5" />
          Revert (restore qty)
        </Button>
      )}
      {showDelete && (
        <Button
          size="sm"
          variant="outline"
          className="text-destructive"
          onClick={onDelete}
          disabled={pending}
        >
          <Trash2 className="mr-1.5 size-3.5" />
          Delete draft
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
 *  PIN modal — re-verifies the actor's password as the electronic
 *  signature. Also collects the note / revert-reason for the sig row.
 * ---------------------------------------------------------------- */
function PinModal({
  kind,
  writeOffCode,
  open,
  onClose,
  onSuccess,
  children,
}: {
  kind: ActionKind;
  writeOffCode: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  children: (inputs: {
    password: string;
    note?: string;
  }) => Promise<{ ok: true } | { ok: false; detail: string; code?: string; debug?: ErrorDebug }>;
}) {
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<{ detail: string; code?: string; debug?: ErrorDebug } | null>(null);

  const cfg = MODAL_COPY[kind];
  const canSubmit =
    password.length > 0 &&
    (!cfg.noteRequired || note.trim().length >= cfg.noteMin) &&
    !pending;

  function submit() {
    if (!canSubmit) return;
    setErr(null);
    startTransition(async () => {
      const res = await children({ password, note: note.trim() });
      if (res.ok) {
        toast.success(cfg.successToast);
        onSuccess();
        onClose();
      } else {
        setErr({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{cfg.title}</DialogTitle>
          <DialogDescription>
            {cfg.desc} <span className="font-mono">{writeOffCode}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {cfg.noteLabel}
              {cfg.noteRequired && ` (min ${cfg.noteMin} chars)`}
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={cfg.notePlaceholder}
              rows={3}
              disabled={pending}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Your account password
            </Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Confirm your identity"
              disabled={pending}
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground">
              Re-entering your password is your electronic signature on this action.
            </p>
          </div>

          {err && <ErrorBanner detail={err.detail} code={err.code} debug={err.debug} />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {cfg.cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MODAL_COPY: Record<
  ActionKind,
  {
    title: string;
    desc: string;
    cta: string;
    successToast: string;
    noteLabel: string;
    notePlaceholder: string;
    noteRequired: boolean;
    noteMin: number;
  }
> = {
  approve: {
    title: "Approve write-off",
    desc: "Sign off on the paperwork for",
    cta: "Approve",
    successToast: "Approved — awaiting authoriser",
    noteLabel: "Approval note",
    notePlaceholder: "Optional — what evidence did you check?",
    noteRequired: false,
    noteMin: 0,
  },
  authorise: {
    title: "Authorise write-off",
    desc: "Fire the stock movement for",
    cta: "Authorise & post movement",
    successToast: "Authorised — stock adjusted",
    noteLabel: "Authorisation note",
    notePlaceholder: "Optional — anything future-you should know",
    noteRequired: false,
    noteMin: 0,
  },
  reject: {
    title: "Reject back to draft",
    desc: "Send back to the creator for",
    cta: "Reject",
    successToast: "Sent back to draft",
    noteLabel: "Rejection reason",
    notePlaceholder: "What needs fixing before this can proceed?",
    noteRequired: true,
    noteMin: 10,
  },
  revert: {
    title: "Revert write-off",
    desc: "Restore the qty for",
    cta: "Revert",
    successToast: "Reverted — qty restored",
    noteLabel: "Revert reason (min 10 chars)",
    notePlaceholder: "Why is this being undone?",
    noteRequired: true,
    noteMin: 10,
  },
};
