"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/forms/field-error";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorResult } from "@/lib/errors/server";
import {
  formatCompanyDate,
  formatCompanyMoney,
} from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type { HREmployee, HREmployeeWage } from "@/lib/hr/types";
import { addWageAction } from "@/lib/hr/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";

interface Props {
  employee: HREmployee;
  initial: HREmployeeWage[];
  canEdit: boolean;
  /** If set, a subtle "View all →" link renders in the card header
   *  pointing at the dedicated infinite-scroll page. The parent only
   *  passes this when the server reported `next_cursor !== null`. */
  viewAllHref?: string;
}

export function WagesCard({ employee, initial, canEdit, viewAllHref }: Props) {
  const prefs = useFormatPrefs();
  const [wages, setWages] = useState<HREmployeeWage[]>(initial);
  const [open, setOpen] = useState(false);

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-4 text-muted-foreground" />
              Wage history
            </CardTitle>
            <CardDescription>
              Every rate change writes a new row. The topmost entry with no
              end date is currently in effect; the cost-breakdown report
              projects the wage that applied at each session&apos;s
              start_time.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {viewAllHref && (
              <Link
                href={viewAllHref}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                View all →
              </Link>
            )}
            {canEdit && (
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => setOpen(true)}
              >
                <Plus className="mr-1.5 size-4" />
                Add wage change
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {wages.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
            No wage recorded yet. Add the starting rate so the cost-breakdown
            report has something to project.
          </p>
        ) : (
          <ol className="relative space-y-4 border-l border-border/60 pl-6">
            {wages.map((w) => {
              const active = w.effective_to === null;
              return (
                <li key={w.id} className="relative">
                  <span
                    aria-hidden
                    className={`absolute -left-[26px] top-1.5 flex size-3 items-center justify-center rounded-full ring-4 ring-background ${
                      active
                        ? "bg-emerald-500"
                        : "bg-muted-foreground/50"
                    }`}
                  />
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold">
                        {formatCompanyMoney(w.hourly_rate, {
                          ...prefs,
                          currency_code:
                            w.currency_code ?? prefs.currency_code,
                        })}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        /hour
                      </span>
                      {active && (
                        <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                          Current
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {formatCompanyDate(w.effective_from, prefs)}
                      {w.effective_to && (
                        <>
                          <span aria-hidden> → </span>
                          {formatCompanyDate(w.effective_to, prefs)}
                        </>
                      )}
                    </span>
                  </div>
                  {w.reason && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {w.reason}
                    </p>
                  )}
                  {w.approved_by && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                      Approved by {w.approved_by.name}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>

      <AddWageDialog
        employee={employee}
        open={open}
        onOpenChange={setOpen}
        onCreated={(wage) => {
          setWages((prev) => [wage, ...prev]);
          invalidateAudit("hr_employee", employee.id);
        }}
      />
    </Card>
  );
}

interface AddWageDialogProps {
  employee: HREmployee;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (wage: HREmployeeWage) => void;
}

function AddWageDialog({
  employee,
  open,
  onOpenChange,
  onCreated,
}: AddWageDialogProps) {
  const [effectiveFrom, setEffectiveFrom] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [hourlyRate, setHourlyRate] = useState("");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string[] | undefined>
  >({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setHourlyRate("");
    setReason("");
    setFieldErrors({});
    setActionError(null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setActionError(null);

    startTransition(async () => {
      const res = await addWageAction(employee.uuid, {
        effective_from: effectiveFrom,
        hourly_rate: hourlyRate,
        currency_code:
          employee.current_wage?.currency_code ?? undefined,
        reason: reason.trim() || null,
      });
      if (res.ok) {
        toast.success("Wage recorded");
        onCreated(res.wage);
        reset();
        onOpenChange(false);
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record wage change</DialogTitle>
          <DialogDescription>
            Sets the new effective rate for {employee.full_name}. The
            previous open interval is closed automatically on{" "}
            {effectiveFrom || "the chosen effective_from"} − 1 day.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="wage_effective_from">Effective from</Label>
            <Input
              id="wage_effective_from"
              type="date"
              required
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
            <FieldError messages={fieldErrors.effective_from} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wage_hourly_rate">Hourly rate</Label>
            <Input
              id="wage_hourly_rate"
              type="number"
              min="0"
              step="0.0001"
              required
              inputMode="decimal"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              placeholder="e.g. 14.25"
            />
            <p className="text-xs text-muted-foreground">
              Denominated in{" "}
              <span className="font-mono">
                {employee.current_wage?.currency_code ?? "company base"}
              </span>
              . Decimal(10,4) precision.
            </p>
            <FieldError messages={fieldErrors.hourly_rate} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wage_reason">Reason (optional)</Label>
            <Textarea
              id="wage_reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Annual review, promotion, minimum-wage adjustment…"
            />
            <FieldError messages={fieldErrors.reason} />
          </div>
          {actionError && (
            <ErrorBanner
              detail={actionError.detail}
              code={actionError.code}
              debug={actionError.debug}
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !hourlyRate}>
              {pending ? "Saving…" : "Record wage"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
