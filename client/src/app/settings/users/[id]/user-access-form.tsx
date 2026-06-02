"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
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
import { Badge } from "@/components/ui/badge-mini";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { cn } from "@/lib/utils";
import { updateUserAccessAction } from "@/lib/users/actions";
import { invalidateAudit, subscribeRestore } from "@/lib/audit/invalidator";
import { ApplyTemplateButton } from "./apply-template-button";
import { PermissionMatrixGrid } from "@/components/permissions/permission-matrix-grid";
import type {
  PermissionMatrix,
  PermissionMatrixResource,
  User,
} from "@/lib/types";
import { AlertCircle, Loader2, Lock, ShieldCheck } from "lucide-react";

type Action = "read" | "create" | "update" | "delete";
const ACTIONS: Action[] = ["read", "create", "update", "delete"];

interface UserAccessFormProps {
  subject: User;
  matrix: PermissionMatrix;
  canEdit: boolean;
  /** Whether the current actor can see the templates list. Hides the
   *  "Apply template" button when false — separate from `canEdit`
   *  because an admin might be able to edit access without seeing
   *  templates (rare but legal: roles.edit without roles.view). */
  canApplyTemplate: boolean;
}

interface FormState {
  is_admin: boolean;
  /** Sorted, de-duped permission codes — what the matrix grants. */
  permissions: string[];
  /** Hourly wage as a string (preserves decimals across the wire). */
  hourly_wage: string;
}

type CommitPayload = { kind: "saved"; state: FormState };

function initialFrom(subject: User): FormState {
  const perms = [...(subject.permissions ?? [])].sort();
  return {
    is_admin: Boolean(subject.is_admin),
    permissions: perms,
    hourly_wage:
      subject.hourly_wage === null || subject.hourly_wage === undefined
        ? ""
        : String(subject.hourly_wage),
  };
}

export function UserAccessForm({
  subject,
  matrix,
  canEdit,
  canApplyTemplate,
}: UserAccessFormProps) {
  const router = useRouter();
  const resource = `user-access:${subject.uuid}`;
  useFormPresenceBeacon(resource);

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
  } = useLiveForm<FormState>({
    resource,
    // Viewer (no `roles.edit`) ⇒ skip the channel: the backend would
    // 403 the join anyway, and a viewer has nothing to broadcast.
    disabled: !canEdit,
    initialState: useMemo(() => initialFrom(subject), [subject]),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "saved") {
        toast.success("Access updated", {
          description: `${creator?.name ?? "The host"} saved the changes.`,
        });
        setOriginal(msg.state);
        resetState(msg.state);
        invalidateAudit("user", subject.id);
        router.refresh();
      }
    },
  });

  const cursorAnchorRef = useRef<HTMLDivElement | null>(null);
  const [anchorSize, setAnchorSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  useEffect(() => {
    const el = cursorAnchorRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setAnchorSize({ w: rect.width, h: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => hideCursor();
  }, [hideCursor]);

  // "Restore version" listener — see warehouse-form for the pattern.
  // Hourly wage is stored as Decimal on the server, comes back as a
  // string from the audit JSONB.
  useEffect(() => {
    return subscribeRestore("user", subject.id, (raw) => {
      const r = raw as Record<string, unknown>;
      const next: FormState = {
        is_admin: r.is_admin === true,
        permissions: Array.isArray(r.permissions)
          ? (r.permissions as string[]).slice().sort()
          : [],
        hourly_wage:
          r.hourly_wage === null || r.hourly_wage === undefined
            ? ""
            : String(r.hourly_wage),
      };
      resetState(next);
    });
  }, [subject.id, resetState]);

  const onCursorMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = cursorAnchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      setCursor(
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
      );
    },
    [setCursor],
  );

  const [original, setOriginal] = useState<FormState>(() => initialFrom(subject));
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const permsSet = useMemo(() => new Set(state.permissions), [state.permissions]);
  const dirty = useMemo(() => {
    if (state.is_admin !== original.is_admin) return true;
    if (state.hourly_wage !== original.hourly_wage) return true;
    if (state.permissions.length !== original.permissions.length) return true;
    const a = [...state.permissions].sort();
    const b = [...original.permissions].sort();
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
    return false;
  }, [state, original]);

  function togglePermission(code: string) {
    const next = new Set(permsSet);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    const sorted = Array.from(next).sort();
    setField("permissions", sorted);
  }

  function applyTemplate(codes: string[]) {
    // Additive: union the template's codes with existing matrix
    // ticks. Never removes a code that was already selected — admins
    // expect this to be safe to click multiple times. Unknown codes
    // (older template referencing a since-removed permission) are
    // dropped silently on Save; matrix UI just won't show them.
    const next = new Set(permsSet);
    for (const code of codes) next.add(code);
    setField("permissions", Array.from(next).sort());
  }

  function toggleResource(resource: PermissionMatrixResource, on: boolean) {
    // Convenience: clicking the resource row toggles all of that
    // resource's mapped action codes at once. Hidden columns (cells
    // with `null`) are skipped — they don't represent permissions.
    const next = new Set(permsSet);
    for (const action of ACTIONS) {
      const code = resource[action];
      if (!code) continue;
      if (on) next.add(code);
      else next.delete(code);
    }
    setField("permissions", Array.from(next).sort());
  }

  function setAdmin(value: boolean) {
    setField("is_admin", value);
  }

  function onWageChange(value: string) {
    setField("hourly_wage", value);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});

    startTransition(async () => {
      const res = await updateUserAccessAction(subject.uuid, {
        is_admin: state.is_admin,
        permissions: state.permissions,
        hourly_wage: state.hourly_wage.trim() || null,
      });

      if (res.ok) {
        toast.success("Access updated");
        setOriginal(state);
        invalidateAudit("user", subject.id);
        broadcastCommit({ kind: "saved", state });
        router.refresh();
        return;
      }
      setFieldErrors(res.fields ?? {});
      setFormError(res.detail);
    });
  }

  function onReset() {
    resetState(original);
    setFormError(null);
    setFieldErrors({});
  }

  if (joinError) {
    return <JoinErrorCard reason={joinError.reason} limit={joinError.limit} />;
  }

  return (
    <Card
      ref={cursorAnchorRef}
      onMouseMove={canEdit ? onCursorMove : undefined}
      onMouseLeave={canEdit ? hideCursor : undefined}
      className="relative max-w-4xl border-border/60"
    >
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-xl">
        {Object.entries(cursors).map(([id, cursor]) => (
          <RemoteCursor
            key={id}
            cursor={cursor}
            anchorWidth={anchorSize.w}
            anchorHeight={anchorSize.h}
          />
        ))}
      </div>

      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Access</CardTitle>
            <CardDescription>
              Pick what this user can see and do. <b>Admin</b> bypasses
              every check; otherwise only the boxes you tick are granted.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <CollabAvatars peers={presence} />
            {!canEdit && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                <Lock className="size-3" />
                Read-only
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <form onSubmit={onSubmit} className="space-y-6">
            {/* Admin bypass */}
            <div
              className={cn(
                "flex flex-wrap items-start gap-3 rounded-md border p-3 transition-colors",
                state.is_admin
                  ? "border-brand/40 bg-brand/[0.04]"
                  : "border-border/60",
              )}
              onMouseEnter={() => focusField("is_admin")}
              onMouseLeave={() => blurField("is_admin")}
            >
              <Switch
                checked={state.is_admin}
                onCheckedChange={setAdmin}
                aria-label="Admin"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  Admin
                  {fieldEditors.is_admin && (
                    <span className="ml-2 inline-flex">
                      <FieldEditingIndicator peer={fieldEditors.is_admin} />
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Grants every permission, current and future. The matrix
                  below becomes informational — the user still has full
                  access regardless of which boxes are ticked.
                </p>
              </div>
            </div>

            {fieldErrors.is_admin?.[0] && (
              <FieldErrorBanner message={fieldErrors.is_admin[0]} />
            )}

            {/* Matrix header — title left, Apply-template button right.
                The button stays available even while Admin is on, so
                you can stage perms in advance of turning Admin off. */}
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Permissions</p>
                <p className="text-xs text-muted-foreground">
                  Tick what this user can do. {state.is_admin ? "Admin overrides any choice below." : `${state.permissions.length} selected.`}
                </p>
              </div>
              {canEdit && canApplyTemplate && (
                <ApplyTemplateButton
                  currentPermissions={state.permissions}
                  onApply={applyTemplate}
                />
              )}
            </div>

            <PermissionMatrixGrid
              matrix={matrix}
              selected={permsSet}
              onToggle={togglePermission}
              onToggleResource={toggleResource}
              dimmed={state.is_admin}
            />

            {fieldErrors.permissions?.[0] && (
              <FieldErrorBanner message={fieldErrors.permissions[0]} />
            )}

            {/* Hourly wage */}
            <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
              <label
                htmlFor="hourly_wage"
                className="pt-2.5 text-sm font-medium"
              >
                Hourly wage
              </label>
              <div className="relative max-w-xs">
                <Input
                  id="hourly_wage"
                  type="number"
                  step="0.01"
                  min={0}
                  inputMode="decimal"
                  value={state.hourly_wage}
                  onChange={(e) => onWageChange(e.target.value)}
                  onFocus={() => focusField("hourly_wage")}
                  onBlur={() => blurField("hourly_wage")}
                  className="h-10 pr-8"
                  placeholder="0.00"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  £
                </span>
                <FieldEditingIndicator peer={fieldEditors.hourly_wage} />
              </div>
            </div>

            {formError &&
              !fieldErrors.is_admin?.[0] &&
              !fieldErrors.permissions?.[0] && (
                <FieldErrorBanner message={formError} />
              )}

            {canEdit && (
              <>
                {!isCreator && creator && (
                  <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                    <Lock className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Only{" "}
                      <span className="font-medium text-foreground">
                        {creator.name}
                      </span>{" "}
                      can save changes here. Your edits sync to them live.
                    </span>
                  </div>
                )}
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
                    {pending && (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    )}
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

function FieldErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function JoinErrorCard({
  reason,
  limit,
}: {
  reason: "forbidden" | "form_full" | "bad_topic" | "unknown";
  limit?: number;
}) {
  const config = {
    form_full: {
      icon: AlertCircle,
      title: "Form is at capacity",
      detail: limit
        ? `Up to ${limit} admins can edit access at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: ShieldCheck,
      title: "You can't edit here",
      detail: "Ask an admin for the `roles.edit` permission to join.",
    },
    bad_topic: {
      icon: AlertCircle,
      title: "Unknown form",
      detail: "We couldn't find this form. The link may have been malformed.",
    },
    unknown: {
      icon: AlertCircle,
      title: "Couldn't open the form",
      detail: "Something went wrong on our end. Please try again.",
    },
  }[reason];

  const Icon = config.icon;
  return (
    <Card className="border-border/60">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Icon className="size-6 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold">{config.title}</p>
          <p className="text-xs text-muted-foreground">{config.detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}
