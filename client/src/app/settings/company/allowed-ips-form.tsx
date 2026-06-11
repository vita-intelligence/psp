"use client";

import { useEffect, useState, useTransition } from "react";
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
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { updateCompanyBagAction } from "@/lib/company/bag-actions";
import { ErrorBanner } from "@/components/forms/error-banner";
import { clientValidationError } from "@/lib/errors/client";
import type { AllowedIp } from "@/lib/company/bags";
import type { Company } from "@/lib/types";
import type { ErrorResult } from "@/lib/errors/server";
import {
  AlertTriangle,
  Loader2,
  LockKeyhole,
  Plus,
  Shield,
  Trash2,
} from "lucide-react";
import {
  CreatorLockBanner,
  JoinErrorCard,
  useFormCursorAnchor,
} from "./_realtime";

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

const P = "allowed_ips_";

export function AllowedIpsForm({ company, canEdit }: Props) {
  useFormPresenceBeacon("company:1");

  const {
    state,
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
  } = useLiveForm<State>({
    resource: "company:1",
    disabled: !canEdit,
    initialState: normalize(company.allowed_ips),
    onCommit: (raw) => {
      const msg = raw as { kind: "allowed_ips:saved"; state: State } | null;
      if (!msg || msg.kind !== "allowed_ips:saved") return;
      toast.success("Saved", {
        description: `${creator?.name ?? "The host"} just saved the IP allow-list.`,
      });
      setOriginal(msg.state);
      resetState(msg.state);
    },
  });

  const [original, setOriginal] = useState<State>(() =>
    normalize(company.allowed_ips),
  );
  useEffect(() => {
    setOriginal(normalize(company.allowed_ips));
  }, [company]);

  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  function setEnabled(enabled: boolean) {
    setField("enabled", enabled);
  }

  function addRow() {
    setField("items", [...state.items, { cidr: "", label: "" }]);
  }

  function remove(index: number) {
    setField(
      "items",
      state.items.filter((_, i) => i !== index),
    );
  }

  function update(index: number, patch: Partial<AllowedIp>) {
    setField(
      "items",
      state.items.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit || !isCreator) return;
    setActionError(null);

    const cleanedItems = state.items
      .map((i) => ({
        cidr: i.cidr.trim(),
        label: i.label?.trim() || undefined,
      }))
      .filter((i) => i.cidr.length > 0);

    for (const i of cleanedItems) {
      if (!CIDR_PATTERN.test(i.cidr)) {
        setActionError(
          clientValidationError({
            source: "AllowedIpsForm",
            detail: `"${i.cidr}" doesn't look like a valid IP or CIDR.`,
            exception: `invalid CIDR: ${i.cidr}`,
          }),
        );
        return;
      }
    }

    if (state.enabled && cleanedItems.length === 0) {
      setActionError(
        clientValidationError({
          source: "AllowedIpsForm",
          detail:
            "Turn the allow-list off, or add at least one IP. Otherwise you'd lock everyone out.",
          exception: "allow-list enabled with zero entries",
        }),
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
        resetState(payload);
        broadcastCommit({ kind: "allowed_ips:saved", state: payload });
        return;
      }
      setActionError(res);
    });
  }

  function onReset() {
    resetState(original);
    setActionError(null);
  }

  const {
    attach: attachCursor,
    size: cursorSize,
    onMouseMove: onCursorMove,
    onMouseLeave: onCursorLeave,
  } = useFormCursorAnchor(setCursor, hideCursor);

  if (joinError) return <JoinErrorCard error={joinError} />;

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
            <CardTitle>Allowed IPs</CardTitle>
            <CardDescription>
              Optional. When enabled, only sign-ins from these IPs or CIDR
              blocks are accepted.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <CollabAvatars peers={presence} />
            {!canEdit && <ReadOnly />}
          </div>
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
                state.items.map((row, i) => {
                  const cidrId = `${P}${i}_cidr`;
                  const labelId = `${P}${i}_label`;
                  return (
                    <li
                      key={i}
                      className="grid grid-cols-[1.5fr_1fr_auto] items-center gap-3 px-4 py-2"
                    >
                      <div className="relative">
                        <Input
                          id={cidrId}
                          type="text"
                          placeholder="192.168.1.0/24"
                          value={row.cidr}
                          onChange={(e) => update(i, { cidr: e.target.value })}
                          onFocus={() => focusField(cidrId)}
                          onBlur={() => blurField(cidrId)}
                          className="h-10 font-mono"
                          aria-label="IP or CIDR"
                        />
                        <FieldEditingIndicator peer={fieldEditors[cidrId]} />
                      </div>
                      <div className="relative">
                        <Input
                          id={labelId}
                          type="text"
                          placeholder="e.g. Office VPN"
                          value={row.label ?? ""}
                          onChange={(e) => update(i, { label: e.target.value })}
                          onFocus={() => focusField(labelId)}
                          onBlur={() => blurField(labelId)}
                          maxLength={120}
                          className="h-10"
                          aria-label="Label"
                        />
                        <FieldEditingIndicator peer={fieldEditors[labelId]} />
                      </div>
                      {canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(i)}
                          disabled={!isCreator}
                          className="size-9 text-muted-foreground hover:text-destructive"
                          aria-label="Remove entry"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </li>
                  );
                })
              )}
            </ul>

            {canEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
                disabled={!isCreator}
              >
                <Plus className="mr-1.5 size-4" />
                Add IP
              </Button>
            )}

            {actionError && (
              <ErrorBanner
                detail={actionError.detail}
                code={actionError.code}
                debug={actionError.debug}
              />
            )}

            {canEdit && (
              <>
                {!isCreator && <CreatorLockBanner creator={creator} />}
                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
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

function ReadOnly() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
      <LockKeyhole className="size-3" />
      Read-only
    </span>
  );
}
