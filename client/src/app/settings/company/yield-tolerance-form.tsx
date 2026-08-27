"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, LockKeyhole } from "lucide-react";
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
import { FieldError } from "@/components/forms/field-error";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { cn } from "@/lib/utils";
import { updateCompanyYieldToleranceAction } from "@/lib/company/actions";
import { ErrorBanner } from "@/components/forms/error-banner";
import { formatCompanyNumber } from "@/lib/format/company";
import type { Company, CompanyDefaults } from "@/lib/types";
import type { FieldErrors } from "@/lib/auth/actions";
import type { ErrorResult } from "@/lib/errors/server";
import {
  CreatorLockBanner,
  JoinErrorCard,
  useFormCursorAnchor,
} from "./_realtime";

interface YieldToleranceFormProps {
  company: Company;
  canEdit: boolean;
  defaults: CompanyDefaults;
}

interface FormState {
  production_yield_tolerance_pct: string;
}

function initialFrom(company: Company): FormState {
  return {
    production_yield_tolerance_pct: company.production_yield_tolerance_pct,
  };
}

const P = "yield_tolerance_";

export function YieldToleranceForm({
  company,
  canEdit,
  defaults,
}: YieldToleranceFormProps) {
  useFormPresenceBeacon("company:1");

  const {
    state: form,
    setField,
    resetState,
    presence,
    fieldEditors,
    focusField,
    blurField,
    joinError,
    creator,
    isCreator,
    cursors,
    setCursor,
    hideCursor,
    broadcastCommit,
  } = useLiveForm<FormState>({
    resource: "company:1:yield-tolerance",
    disabled: !canEdit,
    initialState: initialFrom(company),
    onCommit: (raw) => {
      const msg = raw as { kind: "yield_tolerance:saved"; state: FormState } | null;
      if (!msg || msg.kind !== "yield_tolerance:saved") return;
      toast.success("Saved", {
        description: `${creator?.name ?? "The host"} just saved yield tolerance.`,
      });
      setOriginal(msg.state);
      resetState(msg.state);
    },
  });

  const [original, setOriginal] = useState<FormState>(() => initialFrom(company));
  useEffect(() => {
    setOriginal(initialFrom(company));
  }, [company]);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(form) !== JSON.stringify(original);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit || !isCreator) return;
    setFieldErrors({});
    setActionError(null);
    startTransition(async () => {
      const res = await updateCompanyYieldToleranceAction({
        production_yield_tolerance_pct: form.production_yield_tolerance_pct,
      });
      if (res.ok) {
        toast.success("Yield tolerance updated");
        setOriginal(form);
        broadcastCommit({ kind: "yield_tolerance:saved", state: form });
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  function onReset() {
    resetState(original);
    setFieldErrors({});
    setActionError(null);
  }

  const {
    attach: attachCursor,
    size: cursorSize,
    onMouseMove: onCursorMove,
    onMouseLeave: onCursorLeave,
  } = useFormCursorAnchor(setCursor, hideCursor);

  if (joinError) return <JoinErrorCard error={joinError} />;

  const fieldId = `${P}production_yield_tolerance_pct`;
  const errors = fieldErrors.production_yield_tolerance_pct;
  const hasError = Boolean(errors && errors.length > 0);

  return (
    <Card
      ref={attachCursor}
      onMouseMove={onCursorMove}
      onMouseLeave={onCursorLeave}
      className="relative border-border/60"
    >
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-xl">
        {Object.entries(cursors).map(([id, cursor]) => (
          <RemoteCursor
            key={id}
            cursor={cursor}
            anchorWidth={cursorSize.w}
            anchorHeight={cursorSize.h}
          />
        ))}
      </div>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Production yield tolerance</CardTitle>
            <CardDescription>
              How much a run&apos;s actual output is allowed to drift from
              the planned quantity before the customer order&apos;s
              ready-to-dispatch is blocked. Real-world manufacturing
              rarely hits the target on the nose — 10% either way is a
              safe default for capsules and powders.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <CollabAvatars peers={presence} />
            {!canEdit && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                <LockKeyhole className="size-3" />
                Read-only
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-[260px_minmax(0,1fr)] sm:gap-4">
              <Label htmlFor={fieldId} className="pt-2.5 text-sm font-medium">
                Acceptable variance (%)
              </Label>
              <div className="space-y-1.5">
                <div className="relative">
                  <Input
                    id={fieldId}
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={form.production_yield_tolerance_pct}
                    onChange={(e) =>
                      setField(
                        "production_yield_tolerance_pct",
                        e.target.value,
                      )
                    }
                    onFocus={() => focusField(fieldId)}
                    onBlur={() => blurField(fieldId)}
                    aria-invalid={hasError}
                    className={cn(
                      "h-11",
                      hasError &&
                        "border-destructive focus-visible:ring-destructive/20",
                    )}
                  />
                  <FieldEditingIndicator peer={fieldEditors[fieldId]} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Applied to every finished MO: a{" "}
                  {formatCompanyNumber(10000, defaults)}-unit order
                  closing at{" "}
                  <span className="font-medium">
                    {formatCompanyNumber(
                      Math.round(
                        10000 * (1 - Number(form.production_yield_tolerance_pct || 0) / 100),
                      ),
                      defaults,
                    )}
                  </span>
                  –
                  <span className="font-medium">
                    {formatCompanyNumber(
                      Math.round(
                        10000 * (1 + Number(form.production_yield_tolerance_pct || 0) / 100),
                      ),
                      defaults,
                    )}
                  </span>{" "}
                  units clears the fulfilment gate. Anything short of
                  the lower bound blocks dispatch until a top-up MO is
                  raised or the operator accepts a short delivery.
                </p>
                <FieldError messages={errors} />
              </div>
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

            {canEdit && (
              <>
                {!isCreator && <CreatorLockBanner creator={creator} />}
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  {dirty && !pending && isCreator && (
                    <Button type="button" variant="ghost" onClick={onReset}>
                      Discard
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={!dirty || pending || !isCreator}
                    title={
                      isCreator
                        ? undefined
                        : creator
                          ? `Only ${creator.name} can save from this room.`
                          : undefined
                    }
                  >
                    {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                    Save changes
                  </Button>
                </div>
              </>
            )}
          </form>
        </fieldset>
      </CardContent>
    </Card>
  );
}
