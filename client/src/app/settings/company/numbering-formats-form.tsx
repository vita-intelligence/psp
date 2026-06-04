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
import {
  NUMBERING_ENTITIES,
  type NumberingFormat,
  type NumberingFormats,
} from "@/lib/company/bags";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { Company } from "@/lib/types";
import type { ErrorResult } from "@/lib/errors/server";
import { Loader2, LockKeyhole } from "lucide-react";

interface Props {
  company: Company;
  canEdit: boolean;
}

const DEFAULT: NumberingFormat = { prefix: "", padding: 5 };

function normalize(input: unknown): NumberingFormats {
  const bag = (input ?? {}) as Record<string, unknown>;
  const out: NumberingFormats = {};
  for (const entity of NUMBERING_ENTITIES) {
    const v = bag[entity.key];
    if (v && typeof v === "object") {
      const f = v as Partial<NumberingFormat>;
      out[entity.key] = {
        prefix: typeof f.prefix === "string" ? f.prefix : "",
        padding: Number.isFinite(f.padding) ? Number(f.padding) : 5,
      };
    } else {
      out[entity.key] = { ...DEFAULT };
    }
  }
  return out;
}

function preview(prefix: string, padding: number): string {
  const safePad = Math.min(Math.max(padding, 0), 12);
  return `${prefix}${String(1).padStart(safePad, "0")}`;
}

export function NumberingFormatsForm({ company, canEdit }: Props) {
  const [original, setOriginal] = useState<NumberingFormats>(() =>
    normalize(company.numbering_formats),
  );
  const [state, setState] = useState<NumberingFormats>(() =>
    normalize(company.numbering_formats),
  );
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  function update(key: string, patch: Partial<NumberingFormat>) {
    setState((s) => ({
      ...s,
      [key]: { ...DEFAULT, ...s[key], ...patch },
    }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);

    const cleaned: NumberingFormats = {};
    for (const entity of NUMBERING_ENTITIES) {
      const v = state[entity.key] ?? DEFAULT;
      const padding = Math.min(Math.max(Number(v.padding) || 0, 0), 12);
      cleaned[entity.key] = {
        prefix: v.prefix.trim().toUpperCase(),
        padding,
      };
    }

    startTransition(async () => {
      const res = await updateCompanyBagAction("numbering_formats", cleaned);
      if (res.ok) {
        toast.success("Numbering formats updated");
        setOriginal(cleaned);
        setState(cleaned);
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
            <CardTitle>Numbering formats</CardTitle>
            <CardDescription>
              Per-entity prefix and zero-padding. New resources land with the
              next sequence number — existing IDs keep their format.
            </CardDescription>
          </div>
          {!canEdit && <ReadOnly />}
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <form onSubmit={onSubmit} className="space-y-5">
            <ul className="space-y-3">
              {NUMBERING_ENTITIES.map((entity) => {
                const v = state[entity.key] ?? DEFAULT;
                return (
                  <li
                    key={entity.key}
                    className="grid grid-cols-[140px_minmax(0,1fr)_80px_minmax(0,1fr)] items-end gap-3 rounded-md border border-border/60 p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{entity.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {entity.key}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor={`prefix-${entity.key}`}
                        className="text-xs uppercase tracking-wide text-muted-foreground"
                      >
                        Prefix
                      </Label>
                      <Input
                        id={`prefix-${entity.key}`}
                        type="text"
                        value={v.prefix}
                        onChange={(e) =>
                          update(entity.key, { prefix: e.target.value })
                        }
                        maxLength={8}
                        placeholder="U"
                        className="h-10 font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor={`padding-${entity.key}`}
                        className="text-xs uppercase tracking-wide text-muted-foreground"
                      >
                        Padding
                      </Label>
                      <Input
                        id={`padding-${entity.key}`}
                        type="number"
                        min={0}
                        max={12}
                        value={v.padding}
                        onChange={(e) =>
                          update(entity.key, {
                            padding: Number(e.target.value),
                          })
                        }
                        className="h-10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        Preview
                      </span>
                      <div className="flex h-10 items-center rounded-md border border-border/60 bg-muted/40 px-3 font-mono text-sm">
                        {preview(v.prefix, v.padding) || "—"}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

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
