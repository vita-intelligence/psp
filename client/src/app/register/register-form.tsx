"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { FieldError } from "@/components/forms/field-error";
import { ErrorBanner } from "@/components/forms/error-banner";
import { registerAction, type FieldErrors } from "@/lib/auth/actions";
import type { ErrorResult } from "@/lib/errors/server";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, Mail } from "lucide-react";

export function RegisterForm() {
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setActionError(null);
    setFieldErrors({});
    const email = (formData.get("email") || "").toString();

    startTransition(async () => {
      const res = await registerAction(formData);
      if (res.ok) {
        setSuccessEmail(email);
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  if (successEmail) {
    return (
      <Card className="border-border/60 shadow-lg shadow-foreground/[0.03]">
        <CardContent className="p-6 sm:p-8 text-center space-y-4">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand/10">
            <CheckCircle2 className="size-7 text-brand" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">Check your inbox</h2>
            <p className="text-sm text-muted-foreground">
              We sent a confirmation link to
            </p>
            <p className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-sm font-medium">
              <Mail className="size-3.5 text-muted-foreground" />
              {successEmail}
            </p>
            <p className="pt-2 text-xs text-muted-foreground">
              Click the link to activate your account.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 shadow-lg shadow-foreground/[0.03]">
      <CardContent className="p-6 sm:p-7">
        <form action={onSubmit} noValidate className="space-y-5">
          <FormField
            id="name"
            label="Full name"
            type="text"
            autoComplete="name"
            placeholder="Jane Doe"
            required
            errors={fieldErrors.name}
          />

          <FormField
            id="email"
            label="Work email"
            type="email"
            autoComplete="email"
            placeholder="you@vitamanufacture.co.uk"
            required
            errors={fieldErrors.email}
          />

          <FormField
            id="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            required
            errors={fieldErrors.password}
          />

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
            Create account
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

interface FormFieldProps {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
  placeholder: string;
  required?: boolean;
  errors?: string[];
}

function FormField({
  id,
  label,
  type,
  autoComplete,
  placeholder,
  required,
  errors,
}: FormFieldProps) {
  const hasError = Boolean(errors && errors.length > 0);
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <Input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        aria-invalid={hasError}
        aria-describedby={hasError ? `${id}-error` : undefined}
        className={cn(
          "h-11",
          hasError && "border-destructive focus-visible:ring-destructive/20",
        )}
      />
      <FieldError id={`${id}-error`} messages={errors} />
    </div>
  );
}
