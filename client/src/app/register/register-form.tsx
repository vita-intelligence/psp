"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { registerAction } from "@/lib/auth/actions";
import { AlertCircle, CheckCircle2, Loader2, Mail } from "lucide-react";

export function RegisterForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    const email = (formData.get("email") || "").toString();
    startTransition(async () => {
      const res = await registerAction(formData);
      if (res.ok) {
        setSuccessEmail(email);
      } else {
        setError(res.error);
      }
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
        <form action={onSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm font-medium">
              Full name
            </Label>
            <Input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              minLength={1}
              maxLength={120}
              placeholder="Jane Doe"
              className="h-11"
            />
          </div>

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
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium">
              Password
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              placeholder="At least 8 characters"
              className="h-11"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
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
