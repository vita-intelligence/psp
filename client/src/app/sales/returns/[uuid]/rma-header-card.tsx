"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, LockKeyhole } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner } from "@/components/forms/error-banner";
import { FieldError } from "@/components/forms/field-error";
import type { CustomerReturn } from "@/lib/types";
import type { ErrorResult } from "@/lib/errors/server";
import type { FieldErrors } from "@/lib/auth/actions";
import {
  updateCustomerReturnAction,
  type CustomerReturnInput,
} from "@/lib/customer-returns/actions";

interface Props {
  rma: CustomerReturn;
  canEdit: boolean;
  onSavedSuccess?: () => void;
}

export function RMAHeaderCard({ rma, canEdit, onSavedSuccess }: Props) {
  const router = useRouter();
  const [returnDate, setReturnDate] = useState(rma.return_date);
  const [reasonSummary, setReasonSummary] = useState(rma.reason_summary ?? "");
  const [notes, setNotes] = useState(rma.notes ?? "");
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);

  function save() {
    setErrors({});
    setActionError(null);

    const payload: CustomerReturnInput = {
      return_date: returnDate,
      reason_summary: reasonSummary.trim() || null,
      notes: notes.trim() || null,
    };

    startTransition(async () => {
      const res = await updateCustomerReturnAction(rma.uuid, payload);
      if (res.ok) {
        toast.success("Saved");
        onSavedSuccess?.();
        router.refresh();
      } else {
        setErrors(res.fields ?? {});
        setActionError(res);
      }
    });
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">RMA header</CardTitle>
            <CardDescription>
              Return date and reason summary. Locked once the RMA is marked
              received.
            </CardDescription>
          </div>
          {!canEdit && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              <LockKeyhole className="size-3" />
              Read-only
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Return date">
              <Input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="h-11"
              />
              <FieldError messages={errors.return_date} />
            </Field>

            <Field label="Reason summary">
              <Input
                value={reasonSummary}
                onChange={(e) => setReasonSummary(e.target.value)}
                placeholder="One-line headline"
                className="h-11"
              />
              <FieldError messages={errors.reason_summary} />
            </Field>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
            <Label className="pt-2.5 text-sm font-medium">Notes</Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {actionError && (
            <div className="mt-4">
              <ErrorBanner
                detail={actionError.detail}
                code={actionError.code}
                debug={actionError.debug}
              />
            </div>
          )}

          {canEdit && (
            <div className="mt-4 flex justify-end">
              <Button type="button" onClick={save} disabled={pending}>
                {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save changes
              </Button>
            </div>
          )}
        </fieldset>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
    </div>
  );
}
