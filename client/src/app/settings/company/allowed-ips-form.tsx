"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updateCompanyBagAction } from "@/lib/company/bag-actions";
import type { AllowedIp } from "@/lib/company/bags";
import type { Company } from "@/lib/types";
import {
  AlertCircle,
  AlertTriangle,
  Loader2,
  LockKeyhole,
  Plus,
  Shield,
  Trash2,
} from "lucide-react";

interface Props {
  company: Company;
  canEdit: boolean;
}

// Very forgiving — accepts a bare IPv4/IPv6, a CIDR block, or a host
// name (some VPN setups hand out names not addresses). Real validation
// happens server-side when the lock-out check runs.
const CIDR_PATTERN = /^[a-zA-Z0-9.:/-]+$/;

interface State {
  enabled: boolean;
  items: AllowedIp[];
}

function normalize(input: unknown): State {
  const bag = (input ?? {}) as { enabled?: unknown; items?: unknown };
  const items = Array.isArray(bag.items) ? bag.items : [];
  return {
    enabled: Boolean(bag.enabled),
    items: items
      .filter(
        (i): i is AllowedIp =>
          typeof i === "object" &&
          i !== null &&
          typeof (i as AllowedIp).cidr === "string",
      )
      .map((i) => ({ cidr: i.cidr, label: i.label ?? "" })),
  };
}

export function AllowedIpsForm({ company, canEdit }: Props) {
  const [original, setOriginal] = useState<State>(() =>
    normalize(company.allowed_ips),
  );
  const [state, setState] = useState<State>(() => normalize(company.allowed_ips));
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  function setEnabled(enabled: boolean) {
    setState((s) => ({ ...s, enabled }));
  }

  function addRow() {
    setState((s) => ({ ...s, items: [...s.items, { cidr: "", label: "" }] }));
  }

  function remove(index: number) {
    setState((s) => ({
      ...s,
      items: s.items.filter((_, i) => i !== index),
    }));
  }

  function update(index: number, patch: Partial<AllowedIp>) {
    setState((s) => ({
      ...s,
      items: s.items.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const cleanedItems = state.items
      .map((i) => ({
        cidr: i.cidr.trim(),
        label: i.label?.trim() || undefined,
      }))
      .filter((i) => i.cidr.length > 0);

    for (const i of cleanedItems) {
      if (!CIDR_PATTERN.test(i.cidr)) {
        setFormError(`"${i.cidr}" doesn't look like a valid IP or CIDR.`);
        return;
      }
    }

    if (state.enabled && cleanedItems.length === 0) {
      setFormError(
        "Turn the allow-list off, or add at least one IP. Otherwise you'd lock everyone out.",
      );
      return;
    }

    const payload: State = {
      enabled: state.enabled,
      items: cleanedItems,
    };

    startTransition(async () => {
      const res = await updateCompanyBagAction("allowed_ips", payload);
      if (res.ok) {
        toast.success("Allow-list updated");
        setOriginal(payload);
        setState(payload);
        return;
      }
      setFormError(res.detail);
    });
  }

  function onReset() {
    setState(original);
    setFormError(null);
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Allowed IPs</CardTitle>
            <CardDescription>
              Optional. When enabled, only sign-ins from these IPs or CIDR
              blocks are accepted.
            </CardDescription>
          </div>
          {!canEdit && <ReadOnly />}
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="flex items-start gap-3 rounded-md border border-border/60 p-3">
              <Shield className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  Enforce IP allow-list
                </p>
                <p className="text-xs text-muted-foreground">
                  Off by default. Turn this on only after adding the IPs
                  you'll sign in from — otherwise you'll lock yourself out.
                </p>
              </div>
              <Switch
                checked={state.enabled}
                onCheckedChange={setEnabled}
                aria-label="Enforce IP allow-list"
              />
            </div>

            {state.enabled && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50/50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Once enforced, sign-ins from outside this list are rejected.
                  Double-check before saving.
                </span>
              </div>
            )}

            <ul className="divide-y divide-border/60 rounded-md border border-border/60">
              <li className="grid grid-cols-[1.5fr_1fr_auto] items-center gap-3 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span>IP or CIDR</span>
                <span>Label (optional)</span>
                <span className="sr-only">Actions</span>
              </li>
              {state.items.length === 0 ? (
                <li className="px-4 py-6 text-center text-xs text-muted-foreground">
                  No IPs added.
                </li>
              ) : (
                state.items.map((row, i) => (
                  <li
                    key={i}
                    className="grid grid-cols-[1.5fr_1fr_auto] items-center gap-3 px-4 py-2"
                  >
                    <Input
                      type="text"
                      placeholder="192.168.1.0/24"
                      value={row.cidr}
                      onChange={(e) => update(i, { cidr: e.target.value })}
                      className="h-10 font-mono"
                      aria-label="IP or CIDR"
                    />
                    <Input
                      type="text"
                      placeholder="e.g. Office VPN"
                      value={row.label ?? ""}
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
                        aria-label="Remove entry"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </li>
                ))
              )}
            </ul>

            {canEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
              >
                <Plus className="mr-1.5 size-4" />
                Add IP
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
