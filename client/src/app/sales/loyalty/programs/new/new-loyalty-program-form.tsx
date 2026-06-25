"use client";

/**
 * New-loyalty-program form. Lightweight: name + description + the
 * scheme/basis/payout enums (locked to their single V1 option). Once
 * the program exists we redirect to the detail page where the full
 * collab header form + tier editor + lifecycle card live.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldError } from "@/components/forms/field-error";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { FieldErrors } from "@/lib/auth/actions";
import { createLoyaltyProgramAction } from "@/lib/loyalty/actions";
import type { ErrorResult } from "@/lib/errors/server";

export function NewLoyaltyProgramForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setActionError(null);

    if (!name.trim()) {
      setErrors({ name: ["Give the program a name."] });
      return;
    }

    startTransition(async () => {
      const res = await createLoyaltyProgramAction({
        name: name.trim(),
        description: description.trim() || null,
        scheme: "tiered_rebate",
        basis: "ytd_revenue",
        payout_kind: "credit",
      });
      if (res.ok) {
        toast.success("Program created", {
          description:
            "Add tiers and activate it from the detail page.",
        });
        router.push(`/sales/loyalty/programs/${res.loyalty_program.uuid}`);
      } else {
        setErrors(res.fields ?? {});
        setActionError(res);
      }
    });
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>Program details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FormRow label="Name *">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Trade Loyalty 2026"
              className="h-11"
              autoFocus
            />
            <FieldError messages={errors.name} />
          </FormRow>

          <FormRow label="Description">
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short summary of who qualifies and why."
            />
            <p className="text-[11px] text-muted-foreground">
              This program will be a <strong>tiered rebate</strong> on{" "}
              <strong>YTD revenue</strong>, paid as <strong>credit</strong>{" "}
              against future invoices. (V1 only ships these options — more
              schemes/payouts will come later.)
            </p>
          </FormRow>

          {actionError && (
            <ErrorBanner
              detail={actionError.detail}
              code={actionError.code}
              debug={actionError.debug}
            />
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create program
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function FormRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
      <Label className="pt-2.5 text-sm font-medium">{label}</Label>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
