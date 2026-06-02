"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { FieldError } from "@/components/forms/field-error";
import { forgotPasswordAction } from "@/lib/auth/profile-actions";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Loader2, Mail } from "lucide-react";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setFormError(null);
    startTransition(async () => {
      const res = await forgotPasswordAction(email);
      if (res.ok) {
        setSent(email);
        return;
      }
      if (res.fields?.email?.[0]) setEmailError(res.fields.email[0]);
      else setFormError(res.detail);
    });
  }

  if (sent) {
    return (
      <Card className="border-border/60 shadow-lg shadow-foreground/[0.03]">
        <CardContent className="p-6 sm:p-8 text-center space-y-4">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand/10">
            <CheckCircle2 className="size-7 text-brand" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">Check your inbox</h2>
            <p className="text-sm text-muted-foreground">
              If an account exists for
            </p>
            <p className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-sm font-medium">
              <Mail className="size-3.5 text-muted-foreground" />
              {sent}
            </p>
            <p className="pt-2 text-xs text-muted-foreground">
              we've sent a reset link. It expires in 1 hour.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 shadow-lg shadow-foreground/[0.03]">
      <CardContent className="p-6 sm:p-7">
        <form onSubmit={onSubmit} noValidate className="space-y-5">
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@vitamanufacture.co.uk"
              className={cn(
                "h-11",
                emailError &&
                  "border-destructive focus-visible:ring-destructive/20",
              )}
              aria-invalid={Boolean(emailError)}
            />
            <FieldError messages={emailError ? [emailError] : undefined} />
          </div>

          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <Button
            type="submit"
            className="h-11 w-full font-medium"
            disabled={pending}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Send reset link
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
