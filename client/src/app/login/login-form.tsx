"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { FieldError } from "@/components/forms/field-error";
import { loginAction, type FieldErrors } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";
import { AlertCircle, Loader2 } from "lucide-react";

export function LoginForm() {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function onSubmit(formData: FormData) {
    setFormError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await loginAction(formData);
      if (res.ok) return;
      setFieldErrors(res.fields ?? {});
      // Only show the banner if we have no field-level errors —
      // otherwise the inline messages already explain what's wrong.
      if (!res.fields || Object.keys(res.fields).length === 0) {
        setFormError(res.detail);
      }
    });
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
            Sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
