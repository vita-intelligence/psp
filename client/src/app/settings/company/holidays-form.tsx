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
import type { Holiday } from "@/lib/company/bags";
import type { Company } from "@/lib/types";
import {
  AlertCircle,
  CalendarOff,
  Loader2,
  LockKeyhole,
  Plus,
  Trash2,
} from "lucide-react";

interface Props {
  company: Company;
  canEdit: boolean;
}

function normalize(input: unknown): Holiday[] {
  const bag = (input ?? {}) as { items?: unknown };
  const items = Array.isArray(bag.items) ? bag.items : [];
  return items
    .filter(
      (i): i is Holiday =>
        typeof i === "object" &&
        i !== null &&
        typeof (i as Holiday).date === "string",
    )
    .map((i) => ({ date: i.date, label: i.label ?? "" }));
}

function sortByDate(items: Holiday[]): Holiday[] {
  return [...items].sort((a, b) => a.date.localeCompare(b.date));
}

export function HolidaysForm({ company, canEdit }: Props) {
  const [original, setOriginal] = useState<Holiday[]>(() =>
    normalize(company.holidays),
  );
  const [items, setItems] = useState<Holiday[]>(() =>
    normalize(company.holidays),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(items) !== JSON.stringify(original);

  function addRow() {
    setItems((s) => [...s, { date: "", label: "" }]);
  }

  function remove(index: number) {
    setItems((s) => s.filter((_, i) => i !== index));
  }

  function update(index: number, patch: Partial<Holiday>) {
    setItems((s) => s.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    // Drop blank rows so the saved bag stays tidy.
    const cleaned = sortByDate(
      items
        .filter((i) => i.date.trim().length > 0)
        .map((i) => ({
          date: i.date,
          ...(i.label && i.label.trim().length > 0 ? { label: i.label.trim() } : {}),
        })),
    );

    startTransition(async () => {
      const res = await updateCompanyBagAction("holidays", { items: cleaned });
      if (res.ok) {
        toast.success("Holidays updated");
        setOriginal(cleaned);
        setItems(cleaned);
        return;
      }
      setFormError(res.detail);
    });
  }

  function onReset() {
    setItems(original);
    setFormError(null);
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Holidays</CardTitle>
            <CardDescription>
              Days when production is closed. Scheduling skips them automatically.
            </CardDescription>
          </div>
          {!canEdit && <ReadOnly />}
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <form onSubmit={onSubmit} className="space-y-4">
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border/60 py-8 text-center">
                <CalendarOff className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium">No holidays yet</p>
                <p className="text-xs text-muted-foreground">
                  Add the dates production is closed.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                <li className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Date</span>
                  <span>Label (optional)</span>
                  <span className="sr-only">Actions</span>
                </li>
                {items.map((item, i) => (
                  <li
                    key={i}
                    className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 px-4 py-2"
                  >
                    <Input
                      type="date"
                      value={item.date}
                      onChange={(e) => update(i, { date: e.target.value })}
                      className="h-10"
                      aria-label="Date"
                    />
                    <Input
                      type="text"
                      placeholder="e.g. Christmas Day"
                      value={item.label ?? ""}
                      onChange={(e) => update(i, { label: e.target.value })}
                      maxLength={120}
                      className="h-10"
                      aria-label="Label"
                    />
                    {canEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(i)}
                        className="size-9 text-muted-foreground hover:text-destructive"
                        aria-label="Remove holiday"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
              >
                <Plus className="mr-1.5 size-4" />
                Add holiday
              </Button>
            )}

            {formError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{formError}</span>
              </div>
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
