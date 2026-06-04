"use client";

import { useState, useTransition } from "react";
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
import { cn } from "@/lib/utils";
import { changePasswordAction } from "@/lib/auth/profile-actions";
import type { FieldErrors } from "@/lib/auth/actions";
import type { ErrorResult } from "@/lib/errors/server";
import { Loader2, ShieldCheck } from "lucide-react";

export function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function clear() {
    setCurrentPassword("");
    setPassword("");
    setConfirm("");
    setFieldErrors({});
    setActionError(null);
  }

  function preflight(): FieldErrors | null {
    const errors: FieldErrors = {};
    if (!currentPassword)
      errors.current_password = ["Enter your current password."];
    if (!password) errors.password = ["Choose a new password."];
    else if (password.length < 8)
      errors.password = ["Password must be at least 8 characters."];
    if (!confirm) errors.confirm = ["Confirm your new password."];
    else if (confirm !== password)
      errors.confirm = ["Passwords don't match."];
    return Object.keys(errors).length > 0 ? errors : null;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const preflightErrors = preflight();
    if (preflightErrors) {
      setFieldErrors(preflightErrors);
      setActionError(null);
      return;
    }
    setFieldErrors({});
    setActionError(null);
    setConfirmOpen(true);
  }

  function onConfirmed() {
    setConfirmOpen(false);
    startTransition(async () => {
      const res = await changePasswordAction({
        current_password: currentPassword,
        password,
      });
      if (res.ok) {
        toast.success("Password changed", {
          description: "We've emailed you a heads-up for the change.",
        });
        clear();
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  return (
    <>
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Use a strong password — at least 8 characters. You'll get an
            email confirming the change.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <Field
              id="current-password"
              label="Current password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={setCurrentPassword}
              errors={fieldErrors.current_password}
            />

            <Field
              id="new-password"
              label="New password"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              errors={fieldErrors.password}
            />

            <Field
              id="confirm-password"
              label="Confirm new password"
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
              errors={fieldErrors.confirm}
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

            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Change password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        {/* `size="sm"` keeps the dialog narrow AND keeps the header
            centered at every viewport — without it, shadcn's default
            applies `sm:text-left` and our centered icon ends up
            sitting above left-aligned copy. */}
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-brand/10">
              <ShieldCheck className="size-6 text-brand" />
            </div>
            <AlertDialogTitle>Change your password?</AlertDialogTitle>
            <AlertDialogDescription>
              We'll email you a confirmation. Other signed-in devices
              stay signed in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmed}>
              Yes, change it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface FieldProps {
  id: string;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (v: string) => void;
  errors?: string[];
}

function Field({
  id,
  label,
  autoComplete,
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
