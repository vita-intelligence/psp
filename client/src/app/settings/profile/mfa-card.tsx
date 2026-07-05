"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FieldError } from "@/components/forms/field-error";
import { ErrorBanner } from "@/components/forms/error-banner";
import {
  confirmMfaAction,
  disableMfaAction,
  enrollMfaAction,
  getMfaStatusAction,
  type MfaStatus,
} from "@/lib/auth/mfa-actions";
import type { ErrorResult } from "@/lib/errors/server";
import { Loader2, ShieldCheck, ShieldOff, Copy, Check } from "lucide-react";

type EnrollState = {
  secret: string;
  otpauth_uri: string;
};

/**
 * MFA settings card: shows status, walks the user through enrollment
 * (QR code + confirmation code), lets them view remaining recovery
 * codes, and offers a password-gated disable.
 */
export function MfaCard() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [enrollState, setEnrollState] = useState<EnrollState | null>(null);
  const [code, setCode] = useState("");
  const [freshRecoveryCodes, setFreshRecoveryCodes] = useState<string[] | null>(
    null,
  );
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [actionError, setActionError] = useState<ErrorResult | null>(null);

  useEffect(() => {
    (async () => {
      const res = await getMfaStatusAction();
      if ("enrolled" in res) setStatus(res);
      setLoading(false);
    })();
  }, []);

  function refreshStatus() {
    startTransition(async () => {
      const res = await getMfaStatusAction();
      if ("enrolled" in res) setStatus(res);
    });
  }

  function onEnroll() {
    setActionError(null);
    startTransition(async () => {
      const res = await enrollMfaAction();
      if (!res.ok) {
        setActionError(res);
        return;
      }
      setEnrollState({ secret: res.secret, otpauth_uri: res.otpauth_uri });
    });
  }

  function onConfirm() {
    if (!enrollState) return;
    setActionError(null);
    startTransition(async () => {
      const res = await confirmMfaAction({ code });
      if (!res.ok) {
        setActionError(res);
        return;
      }
      setFreshRecoveryCodes(res.recovery_codes);
      setEnrollState(null);
      setCode("");
      refreshStatus();
      toast.success("MFA enabled", {
        description: "Save the recovery codes shown below — you won't see them again.",
      });
    });
  }

  function onDisable() {
    setDisableOpen(false);
    setActionError(null);
    startTransition(async () => {
      const res = await disableMfaAction({ current_password: disablePassword });
      if (!res.ok) {
        setActionError(res);
        return;
      }
      setDisablePassword("");
      refreshStatus();
      toast.success("MFA disabled", {
        description: "You'll only need your password from now on.",
      });
    });
  }

  if (loading) {
    return (
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
        </CardHeader>
        <CardContent>
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            Add a 6-digit code from an authenticator app on top of
            your password. Recovery codes let you sign in if you lose
            your phone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {actionError && (
            <ErrorBanner
              detail={actionError.detail}
              code={actionError.code}
              debug={actionError.debug}
            />
          )}

          {status?.enrolled && !enrollState && (
            <EnrolledPanel
              status={status}
              onDisable={() => setDisableOpen(true)}
              pending={pending}
            />
          )}

          {!status?.enrolled && !enrollState && (
            <NotEnrolledPanel
              status={status}
              onEnroll={onEnroll}
              pending={pending}
            />
          )}

          {enrollState && (
            <EnrollmentPanel
              secret={enrollState.secret}
              otpauthUri={enrollState.otpauth_uri}
              code={code}
              setCode={setCode}
              onConfirm={onConfirm}
              onCancel={() => {
                setEnrollState(null);
                setCode("");
              }}
              pending={pending}
              fieldErrors={actionError?.fields ?? {}}
            />
          )}

          {freshRecoveryCodes && (
            <RecoveryCodesPanel
              codes={freshRecoveryCodes}
              onDismiss={() => setFreshRecoveryCodes(null)}
            />
          )}
        </CardContent>
      </Card>

      <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <ShieldOff className="size-6 text-destructive" />
            </div>
            <AlertDialogTitle>Turn off two-factor?</AlertDialogTitle>
            <AlertDialogDescription>
              Your account will be less protected. Enter your current
              password to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="disable-password">Current password</Label>
            <Input
              id="disable-password"
              type="password"
              autoComplete="current-password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              className="h-11"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDisable}>
              Turn it off
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EnrolledPanel({
  status,
  onDisable,
  pending,
}: {
  status: MfaStatus;
  onDisable: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500/15">
          <ShieldCheck className="size-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <p className="text-sm font-medium">Two-factor is on</p>
          <p className="text-xs text-muted-foreground">
            {status.recovery_codes_remaining} recovery code
            {status.recovery_codes_remaining === 1 ? "" : "s"} left.
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={onDisable}
        disabled={pending}
      >
        Turn off
      </Button>
    </div>
  );
}

function NotEnrolledPanel({
  status,
  onEnroll,
  pending,
}: {
  status: MfaStatus | null;
  onEnroll: () => void;
  pending: boolean;
}) {
  const graceCopy = status?.grace_deadline
    ? `Your admin requires MFA — set it up by ${new Date(status.grace_deadline).toLocaleDateString()}.`
    : "Recommended for anyone who can approve orders or manage users.";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">Two-factor is off</p>
        <p className="text-xs text-muted-foreground">{graceCopy}</p>
      </div>
      <Button type="button" onClick={onEnroll} disabled={pending}>
        {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
        Set up
      </Button>
    </div>
  );
}

function EnrollmentPanel({
  secret,
  otpauthUri,
  code,
  setCode,
  onConfirm,
  onCancel,
  pending,
  fieldErrors,
}: {
  secret: string;
  otpauthUri: string;
  code: string;
  setCode: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  pending: boolean;
  fieldErrors: Record<string, string[]>;
}) {
  const [copied, setCopied] = useState(false);
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUri)}`;

  return (
    <div className="space-y-4 rounded-md border border-brand/30 bg-brand/[0.04] p-4">
      <div>
        <p className="text-sm font-medium">1. Scan this QR code</p>
        <p className="text-xs text-muted-foreground">
          Open your authenticator (Authy, 1Password, Google
          Authenticator) and add a new account.
        </p>
      </div>

      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <img
          src={qrSrc}
          alt="MFA QR code"
          width={200}
          height={200}
          className="rounded-md border border-border/60 bg-white p-2"
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Or enter this key manually
            </p>
            <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background p-2 font-mono text-xs">
              <span className="min-w-0 flex-1 truncate">{secret}</span>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(secret);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Copy secret"
              >
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium">2. Enter the 6-digit code</p>
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123 456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="h-11 tracking-widest"
              aria-invalid={Boolean(fieldErrors.code)}
            />
            <FieldError messages={fieldErrors.code} />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" onClick={onConfirm} disabled={pending || code.length < 6}>
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Confirm
        </Button>
      </div>
    </div>
  );
}

function RecoveryCodesPanel({
  codes,
  onDismiss,
}: {
  codes: string[];
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/[0.08] p-4">
      <div>
        <p className="text-sm font-semibold">Save your recovery codes</p>
        <p className="text-xs text-amber-900 dark:text-amber-200">
          Each code works once. Store them in a password manager — you
          won't see them again.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 font-mono text-xs">
        {codes.map((c) => (
          <div
            key={c}
            className="rounded border border-border/60 bg-background px-2 py-1.5 text-center"
          >
            {c}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(codes.join("\n"));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? (
            <Check className="mr-2 size-3.5" />
          ) : (
            <Copy className="mr-2 size-3.5" />
          )}
          Copy all
        </Button>
        <Button type="button" size="sm" onClick={onDismiss}>
          I've saved them
        </Button>
      </div>
    </div>
  );
}
