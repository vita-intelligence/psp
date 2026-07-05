"use client";

/**
 * Loyalty-program lifecycle card. Two action surfaces:
 *
 *   1. Activate / Deactivate — deactivate requires a reason so the
 *      audit trail captures *why* the program stopped accruing.
 *   2. Set-as-default — only one program at a time can be the default
 *      and only when `is_default = false` (button is hidden otherwise).
 *
 * Mirrors the customer suspend dialog pattern: a small Dialog with a
 * required Reason textarea + a clear Cancel/Confirm pair.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  CircleSlash,
  Loader2,
  PowerOff,
  Power,
  ShieldAlert,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge-mini";
import { ErrorBanner } from "@/components/forms/error-banner";
import { usePageLeadership } from "@/components/realtime/page-lock-guard";
import type { CompanyDefaults, LoyaltyProgram } from "@/lib/types";
import {
  setProgramActiveAction,
  setProgramDefaultAction,
} from "@/lib/loyalty/actions";
import { formatCompanyDate } from "@/lib/format/company";
import type { ErrorResult } from "@/lib/errors/server";

interface Props {
  program: LoyaltyProgram;
  prefs: CompanyDefaults;
  canManage: boolean;
  pageId?: string;
}

export function LoyaltyLifecycleCard({
  program,
  prefs,
  canManage,
  pageId,
}: Props) {
  const router = useRouter();
  const { isLeader, leader } = usePageLeadership(pageId ?? "", !pageId);
  const locked = !!pageId && !isLeader && !!leader;
  const [deactivating, setDeactivating] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ErrorResult | null>(null);

  function onActivate() {
    if (locked) return;
    setError(null);
    startTransition(async () => {
      const res = await setProgramActiveAction(program.uuid, true);
      if (res.ok) {
        toast.success("Program activated");
        router.refresh();
      } else {
        setError(res);
        toast.error(res.detail);
      }
    });
  }

  function onSetDefault() {
    if (locked) return;
    setError(null);
    startTransition(async () => {
      const res = await setProgramDefaultAction(program.uuid);
      if (res.ok) {
        toast.success("Set as the default program");
        router.refresh();
      } else {
        setError(res);
        toast.error(res.detail);
      }
    });
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Lifecycle</CardTitle>
            <CardDescription>
              Activate or deactivate the program. Only one program can
              be the company-wide default at a time.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {program.is_default && (
              <Badge tone="indigo">
                <Star className="size-3" />
                Default
              </Badge>
            )}
            <Badge tone={program.is_active ? "emerald" : "muted"}>
              {program.is_active ? (
                <>
                  <CheckCircle2 className="size-3" />
                  Active
                </>
              ) : (
                <>
                  <CircleSlash className="size-3" />
                  Inactive
                </>
              )}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Activated
            </dt>
            <dd className="font-mono">
              {program.activated_at
                ? formatCompanyDate(program.activated_at, prefs)
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Deactivated
            </dt>
            <dd className="font-mono">
              {program.deactivated_at
                ? formatCompanyDate(program.deactivated_at, prefs)
                : "—"}
            </dd>
          </div>
          {program.deactivation_reason && (
            <div className="sm:col-span-2">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Deactivation reason
              </dt>
              <dd className="rounded-md border border-border/40 bg-muted/30 p-2 text-[11px]">
                {program.deactivation_reason}
              </dd>
            </div>
          )}
        </dl>

        {error && (
          <ErrorBanner detail={error.detail} code={error.code} debug={error.debug} />
        )}

        {canManage && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {program.is_active ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (locked) return;
                  setDeactivating(true);
                }}
                disabled={pending || locked}
              >
                <PowerOff className="mr-1.5 size-4" />
                Deactivate
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onActivate}
                disabled={pending || locked}
              >
                {pending ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Power className="mr-1.5 size-4" />
                )}
                Activate
              </Button>
            )}

            {!program.is_default && program.is_active && (
              <Button
                type="button"
                size="sm"
                onClick={onSetDefault}
                disabled={pending || locked}
              >
                <Star className="mr-1.5 size-4" />
                Set as default
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <DeactivateDialog
        open={deactivating}
        onClose={() => setDeactivating(false)}
        program={program}
        onSaved={() => router.refresh()}
      />
    </Card>
  );
}

// ============================================================
// Deactivate dialog
// ============================================================

function DeactivateDialog({
  open,
  onClose,
  program,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  program: LoyaltyProgram;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ErrorResult | null>(null);

  const reasonMissing = !reason.trim();

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await setProgramActiveAction(
        program.uuid,
        false,
        reason.trim(),
      );
      if (res.ok) {
        toast.success("Program deactivated");
        setReason("");
        onSaved();
        onClose();
      } else {
        setError(res);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deactivate loyalty program</DialogTitle>
          <DialogDescription>
            New invoice payments stop accruing against this program.
            Existing customer balances are unaffected — workers can still
            redeem credit earned earlier.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <strong>Common reasons:</strong> superseded by a new program,
            seasonal pause, accidental setup being archived, board
            decision to stop rebates.
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are we stopping this program?"
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
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={run}
            disabled={pending || reasonMissing}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            <ShieldAlert className="mr-1.5 size-4" />
            Deactivate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
