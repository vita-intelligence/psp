"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { FieldError } from "@/components/forms/field-error";
import { ErrorBanner } from "@/components/forms/error-banner";
import {
  loginAction,
  verifyMfaAction,
  type FieldErrors,
} from "@/lib/auth/actions";
import type { ErrorResult } from "@/lib/errors/server";
import { cn } from "@/lib/utils";
import { Loader2, ShieldCheck } from "lucide-react";

export function LoginForm() {
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // When set, the password step succeeded and we're waiting for a
  // TOTP / recovery code. The token is short-lived (5 min) and lives
  // in state until the user submits the code or navigates away.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  function onSubmit(formData: FormData) {
    setActionError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await loginAction(formData);
      if (!res.ok) {
        setFieldErrors(res.fields ?? {});
        setActionError(res);
        return;
      }
      if ("mfa" in res) {
        setMfaToken(res.mfa.mfa_token);
        return;
      }
      // Straight-through login redirected inside the server action.
    });
  }

  function onVerifyMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setActionError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await verifyMfaAction({
        mfa_token: mfaToken,
        code: mfaCode,
      });
      if (res.ok) return;
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  if (mfaToken) {
    return (
      <Card className="border-border/60 shadow-lg shadow-foreground/[0.03]">
        <CardContent className="p-6 sm:p-7">
          <form onSubmit={onVerifyMfa} noValidate className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-brand/10">
                <ShieldCheck className="size-5 text-brand" />
              </div>
              <div>
                <p className="text-sm font-medium">Enter your verification code</p>
                <p className="text-xs text-muted-foreground">
                  Open your authenticator app or use a recovery code.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mfa-code" className="text-sm font-medium">
                6-digit code
              </Label>
              <Input
                id="mfa-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                placeholder="123 456"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                aria-invalid={Boolean(fieldErrors.code)}
                aria-describedby={fieldErrors.code ? "mfa-code-error" : undefined}
                className={cn(
                  "h-11 tracking-widest",
                  fieldErrors.code &&
                    "border-destructive focus-visible:ring-destructive/20",
                )}
              />
              <FieldError id="mfa-code-error" messages={fieldErrors.code} />
              <p className="text-xs text-muted-foreground">
                Lost your device? Paste a recovery code instead.
              </p>
            </div>

            {actionError &&
              (!actionError.fields ||
                Object.keys(actionError.fields).length === 0) && (
                <ErrorBanner
                  detail={actionError.detail}
                  code={actionError.code}
                  debug={actionError.debug}
                />
              )}

            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                className="h-11 w-full font-medium"
                disabled={pending}
              >
                {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Verify
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-9"
                onClick={() => {
                  setMfaToken(null);
                  setMfaCode("");
                  setActionError(null);
                  setFieldErrors({});
                }}
              >
                Start over
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 shadow-lg shadow-foreground/[0.03]">
      <CardContent className="p-6 sm:p-7">
        <form action={onSubmit} noValidate className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              Work email
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@vitamanufacture.co.uk"
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "email-error" : undefined}
              className={cn(
                "h-11",
                fieldErrors.email &&
                  "border-destructive focus-visible:ring-destructive/20",
              )}
            />
            <FieldError id="email-error" messages={fieldErrors.email} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot?
              </Link>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={
                fieldErrors.password ? "password-error" : undefined
              }
              className={cn(
                "h-11",
                fieldErrors.password &&
                  "border-destructive focus-visible:ring-destructive/20",
              )}
            />
            <FieldError id="password-error" messages={fieldErrors.password} />
          </div>

          {actionError &&
            (!actionError.fields ||
              Object.keys(actionError.fields).length === 0) && (
              <ErrorBanner
                detail={actionError.detail}
                code={actionError.code}
                debug={actionError.debug}
              />
            )}

          <Button
            type="submit"
            className="h-11 w-full font-medium"
            disabled={pending}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
