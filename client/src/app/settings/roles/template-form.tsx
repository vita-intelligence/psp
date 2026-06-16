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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { PermissionMatrixGrid } from "@/components/permissions/permission-matrix-grid";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorResult } from "@/lib/errors/server";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import {
  createTemplateAction,
  updateTemplateAction,
} from "@/lib/templates/actions";
import { invalidateAudit, subscribeRestore } from "@/lib/audit/invalidator";
import type { PermissionMatrix, PermissionTemplate } from "@/lib/types";
import { AlertCircle, Loader2, Lock, ShieldCheck } from "lucide-react";

type Action = "read" | "create" | "update" | "delete";
const ACTIONS: Action[] = ["read", "create", "update", "delete"];

interface TemplateFormProps {
  /** `null` ⇒ create mode; otherwise edit. */
  template: PermissionTemplate | null;
  matrix: PermissionMatrix;
  canEdit: boolean;
  /** Fired on successful save so the EditModeToggle wrapper flips
   *  the page back to view mode. */
  onSavedSuccess?: () => void;
}

interface FormState {
  name: string;
  description: string;
  permissions: string[];
}

type CommitPayload =
  | { kind: "created"; uuid: string; name: string }
  | { kind: "saved"; state: FormState };

function initialFrom(template: PermissionTemplate | null): FormState {
  if (!template) {
    return { name: "", description: "", permissions: [] };
  }
  return {
    name: template.name,
    description: template.description ?? "",
    permissions: [...template.permissions].sort(),
  };
}

export function TemplateForm({
  template,
  matrix,
  canEdit,
  onSavedSuccess,
}: TemplateFormProps) {
  const router = useRouter();
  const resource = template ? `role:${template.uuid}` : "role:new";
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
    disabled: !canEdit,
    initialState: useMemo(() => initialFrom(template), [template]),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Template created", {
          description: `${creator?.name ?? "The host"} just created "${msg.name}".`,
        });
        router.push(`/settings/roles/${msg.uuid}`);
      } else if (msg.kind === "saved") {
        toast.success("Template saved", {
          description: `${creator?.name ?? "The host"} just saved the changes.`,
        });
        setOriginal(msg.state);
        resetState(msg.state);
        if (template) invalidateAudit("template", template.id);
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
  useEffect(() => {
    if (!template) return;
    return subscribeRestore("template", template.id, (raw) => {
      const r = raw as Record<string, unknown>;
      const next: FormState = {
        name: typeof r.name === "string" ? r.name : "",
        description: typeof r.description === "string" ? r.description : "",
        permissions: Array.isArray(r.permissions)
          ? (r.permissions as string[]).slice().sort()
          : [],
      };
      resetState(next);
    });
  }, [template, resetState]);

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

  const [original, setOriginal] = useState<FormState>(() =>
    initialFrom(template),
  );
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const permsSet = useMemo(() => new Set(state.permissions), [state.permissions]);
  const dirty = useMemo(() => {
    if (state.name !== original.name) return true;
    if (state.description !== original.description) return true;
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
    setField("permissions", Array.from(next).sort());
  }

  function toggleResource(
    resource: { read: string | null; create: string | null; update: string | null; delete: string | null },
    on: boolean,
  ) {
    const next = new Set(permsSet);
    for (const action of ACTIONS) {
      const code = resource[action];
      if (!code) continue;
      if (on) next.add(code);
      else next.delete(code);
    }
    setField("permissions", Array.from(next).sort());
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setFieldErrors({});

    startTransition(async () => {
      const input = {
        name: state.name.trim(),
        description: state.description.trim(),
        permissions: state.permissions,
      };

      const res = template
        ? await updateTemplateAction(template.uuid, input)
        : await createTemplateAction(input);

      if (res.ok) {
        invalidateAudit("template", res.template.id);
        if (template) {
          toast.success("Template saved");
          setOriginal(state);
          broadcastCommit({ kind: "saved", state });
          onSavedSuccess?.();
          router.refresh();
        } else {
          toast.success("Template created");
          broadcastCommit({
            kind: "created",
            uuid: res.template.uuid,
            name: res.template.name,
          });
          router.push(`/settings/roles/${res.template.uuid}`);
        }
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  function onReset() {
    resetState(original);
    setActionError(null);
    setFieldErrors({});
  }

  if (joinError) {
    return <JoinErrorCard reason={joinError.reason} limit={joinError.limit} />;
  }

  const submitLabel = template ? "Save changes" : "Create template";

  return (
    <Card
      ref={cursorAnchorRef}
      onMouseMove={canEdit ? onCursorMove : undefined}
      onMouseLeave={canEdit ? hideCursor : undefined}
      className="relative border-border/60"
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
            <CardTitle>
              {template ? template.name || "Template" : "New template"}
            </CardTitle>
            <CardDescription>
              Pick a name and the permissions this template grants. Apply
              it from the access page on any user — perms get added to
              the matrix; nothing existing gets removed.
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
            {/* Name */}
            <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
              <Label htmlFor="name" className="pt-2.5">
                Name
              </Label>
              <div className="relative">
                <Input
                  id="name"
                  value={state.name}
                  onChange={(e) => setField("name", e.target.value)}
                  onFocus={() => focusField("name")}
                  onBlur={() => blurField("name")}
                  placeholder="e.g. Warehouse manager"
                  maxLength={80}
                  className="h-10"
                />
                <FieldEditingIndicator peer={fieldEditors.name} />
                {fieldErrors.name?.[0] && (
                  <p className="mt-1 text-xs text-destructive">
                    {fieldErrors.name[0]}
                  </p>
                )}
              </div>
            </div>

            {/* Description */}
            <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
              <Label htmlFor="description" className="pt-2.5">
                Description
              </Label>
              <div className="relative">
                <Textarea
                  id="description"
                  value={state.description}
                  onChange={(e) => setField("description", e.target.value)}
                  onFocus={() => focusField("description")}
                  onBlur={() => blurField("description")}
                  placeholder="Optional — what this template is for."
                  maxLength={400}
                  rows={2}
                />
                <FieldEditingIndicator peer={fieldEditors.description} />
                {fieldErrors.description?.[0] && (
                  <p className="mt-1 text-xs text-destructive">
                    {fieldErrors.description[0]}
                  </p>
                )}
              </div>
            </div>

            {/* Permissions matrix */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Permissions</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {state.permissions.length} selected
                </span>
              </div>
              <PermissionMatrixGrid
                matrix={matrix}
                selected={permsSet}
                onToggle={togglePermission}
                onToggleResource={(res, on) => toggleResource(res, on)}
              />
              {fieldErrors.permissions?.[0] && (
                <ErrorBanner
                  detail={fieldErrors.permissions[0]}
                  code={actionError?.code}
                  debug={actionError?.debug}
                />
              )}
            </div>

            {actionError &&
              !fieldErrors.name?.[0] &&
              !fieldErrors.description?.[0] &&
              !fieldErrors.permissions?.[0] && (
                <ErrorBanner
                  detail={actionError.detail}
                  code={actionError.code}
                  debug={actionError.debug}
                />
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
                    disabled={
                      !dirty || pending || !isCreator || !state.name.trim()
                    }
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
                    {submitLabel}
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
        ? `Up to ${limit} editors at once. Wait for someone to leave, then refresh.`
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

export { type FormState as TemplateFormState };
