"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { FieldError } from "@/components/forms/field-error";
import { resetPasswordAction } from "@/lib/auth/profile-actions";
import type { FieldErrors } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";
import { AlertCircle, Loader2 } from "lucide-react";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const errors: FieldErrors = {};
    if (!password) errors.password = ["Choose a new password."];
    else if (password.length < 8)
      errors.password = ["Password must be at least 8 characters."];
    if (!confirm) errors.confirm = ["Confirm your new password."];
    else if (confirm !== password)
      errors.confirm = ["Passwords don't match."];
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    startTransition(async () => {
      const res = await resetPasswordAction({ token, password });
      // Success path calls redirect("/") so we never see ok:true here.
      if (res && !res.ok) {
        setFieldErrors(res.fields ?? {});
        if (!res.fields || Object.keys(res.fields).length === 0) {
          setFormError(res.detail);
        }
      }
    });
  }

  return (
    <Card className="border-border/60 shadow-lg shadow-foreground/[0.03]">
      <CardContent className="p-6 sm:p-7">
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <Field
            id="password"
            label="New password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={setPassword}
            errors={fieldErrors.password}
          />

          <Field
            id="confirm"
            label="Confirm new password"
            autoComplete="new-password"
            placeholder="Re-enter the same password"
            value={confirm}
            onChange={setConfirm}
            errors={fieldErrors.confirm}
          />

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
            Save new password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

interface FieldProps {
  id: string;
  label: string;
  autoComplete: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  errors?: string[];
}

function Field({
  id,
  label,
  autoComplete,
  placeholder,
  value,
  onChange,
  errors,
}: FieldProps) {
  const hasError = Boolean(errors && errors.length > 0);
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "h-11",
          hasError && "border-destructive focus-visible:ring-destructive/20",
        )}
        aria-invalid={hasError}
      />
      <FieldError messages={errors} />
    </div>
  );
}
