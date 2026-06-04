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
import { updateCompanyBagAction } from "@/lib/company/bag-actions";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorResult } from "@/lib/errors/server";
import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  type Weekday,
  type DayHours,
  type WorkingHours,
} from "@/lib/company/bags";
import type { Company } from "@/lib/types";
import { Loader2, LockKeyhole } from "lucide-react";

interface Props {
  company: Company;
  canEdit: boolean;
}

const EMPTY_DAY: DayHours = { opens_at: null, closes_at: null };

function normalize(input: unknown): Record<Weekday, DayHours> {
  const safe = (input ?? {}) as Record<string, unknown>;
  return WEEKDAYS.reduce(
    (acc, day) => {
      const v = safe[day];
      if (v && typeof v === "object") {
        const entry = v as Partial<DayHours>;
        acc[day] = {
          opens_at: entry.opens_at ?? null,
          closes_at: entry.closes_at ?? null,
        };
      } else {
        acc[day] = { ...EMPTY_DAY };
      }
      return acc;
    },
    {} as Record<Weekday, DayHours>,
  );
}

export function WorkingHoursForm({ company, canEdit }: Props) {
  const [original, setOriginal] = useState(() =>
    normalize(company.working_hours),
  );
  const [state, setState] = useState(() => normalize(company.working_hours));
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  function updateDay(day: Weekday, field: keyof DayHours, value: string) {
    setState((s) => ({
      ...s,
      [day]: { ...s[day], [field]: value || null },
    }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);

    // Trim closed days to null, drop daily rows that are entirely empty
    // so the stored bag is clean.
    const cleaned: WorkingHours = {};
    for (const day of WEEKDAYS) {
      const v = state[day];
      if (v.opens_at && v.closes_at) {
        cleaned[day] = v;
      } else {
        cleaned[day] = null;
      }
    }

    startTransition(async () => {
      const res = await updateCompanyBagAction("working_hours", cleaned);
      if (res.ok) {
        toast.success("Working hours updated");
        setOriginal(normalize(cleaned));
        return;
      }
      setActionError(res);
    });
  }

  function onReset() {
    setState(original);
    setActionError(null);
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Working hours</CardTitle>
            <CardDescription>
              Days and hours your operations run. Leave a day blank to mark it as closed.
            </CardDescription>
          </div>
          {!canEdit && <ReadOnly />}
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <form onSubmit={onSubmit} className="space-y-3">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4"
              >
                <Label
                  htmlFor={`${day}-opens`}
                  className="text-sm font-medium"
                >
                  {WEEKDAY_LABELS[day]}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`${day}-opens`}
                    type="time"
                    value={state[day].opens_at ?? ""}
                    onChange={(e) =>
                      updateDay(day, "opens_at", e.target.value)
                    }
                    className="h-10 max-w-[120px]"
                    aria-label={`${WEEKDAY_LABELS[day]} opens at`}
                  />
                  <span aria-hidden className="text-muted-foreground">
                    –
                  </span>
                  <Input
                    type="time"
                    value={state[day].closes_at ?? ""}
                    onChange={(e) =>
                      updateDay(day, "closes_at", e.target.value)
                    }
                    className="h-10 max-w-[120px]"
                    aria-label={`${WEEKDAY_LABELS[day]} closes at`}
                  />
                </div>
              </div>
            ))}

            {actionError && (
              <ErrorBanner
                detail={actionError.detail}
                code={actionError.code}
                debug={actionError.debug}
              />
            )}

            {canEdit && (
              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
                {dirty && !pending && (
                  <Button type="button" variant="ghost" onClick={onReset}>
                    Discard
                  </Button>
                )}
                <Button type="submit" disabled={!dirty || pending}>
                  {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save changes
                </Button>
              </div>
            )}
          </form>
        </fieldset>
      </CardContent>
    </Card>
  );
}

function ReadOnly() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
      <LockKeyhole className="size-3" />
      Read-only
    </span>
  );
}
