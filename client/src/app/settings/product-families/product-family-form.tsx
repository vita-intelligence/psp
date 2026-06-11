"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  Loader2,
  Lock,
  LockKeyhole,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorBanner } from "@/components/forms/error-banner";
import { FieldError } from "@/components/forms/field-error";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm, type JoinError } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import {
  createFamilyAction,
  deleteFamilyAction,
  updateFamilyAction,
} from "@/lib/product-families/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type { ProductFamily } from "@/lib/types";

interface FormProps {
  /** `null` ⇒ new family; otherwise the row being edited. */
  family: ProductFamily | null;
  canEdit: boolean;
}

interface FormState {
  name: string;
  description: string;
  is_active: boolean;
}

function initialFrom(family: ProductFamily | null): FormState {
  return {
    name: family?.name ?? "",
    description: family?.description ?? "",
    is_active: family?.is_active ?? true,
  };
}

/** Single-record form for the product-families admin. Mirrors the
 *  storage-tag form pattern. Code is auto-rendered from numbering
 *  format; only name / description / active are editable. */
export function ProductFamilyForm({ family, canEdit }: FormProps) {
  const router = useRouter();
  const isEdit = family !== null;
  const resource = family
    ? `product-family:${family.uuid}`
    : "product-family:new";

  useFormPresenceBeacon(resource);

  type CommitPayload =
    | { kind: "created"; uuid: string; name: string }
    | { kind: "saved"; state: FormState };

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
    initialState: useMemo(() => initialFrom(family), [family]),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Family created", {
          description: `${creator?.name ?? "The host"} just finalised "${msg.name}".`,
        });
        router.push("/settings/product-families");
      } else if (msg.kind === "saved") {
        toast.success("Saved", {
          description: `${creator?.name ?? "The host"} just saved the family.`,
        });
        setOriginal(msg.state);
        resetState(msg.state);
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

  useEffect(() => () => hideCursor(), [hideCursor]);

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

  const [original, setOriginal] = useState<FormState>(() => initialFrom(family));
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isCreator) return;
    setActionError(null);
    setFieldErrors({});

    startTransition(async () => {
      const payload = {
        name: state.name.trim(),
        description: state.description.trim() || null,
        is_active: state.is_active,
      };

      const res = isEdit
        ? await updateFamilyAction(family!.uuid, payload)
        : await createFamilyAction(payload);

      if (!res.ok) {
        setFieldErrors(res.fields ?? {});
        setActionError(res);
        return;
      }

      toast.success(isEdit ? "Family updated" : "Family created");
      setOriginal(state);

      if (isEdit) {
        broadcastCommit({ kind: "saved", state });
      } else {
        broadcastCommit({
          kind: "created",
          uuid: res.family.uuid,
          name: res.family.name,
        });
      }
      router.push("/settings/product-families");
      router.refresh();
    });
  }

  function onReset() {
    resetState(original);
    setActionError(null);
    setFieldErrors({});
  }

  function onDelete() {
    if (!family) return;
    if (
      !window.confirm(
        `Delete "${family.name}"? Items linked to this family will be unlinked (their family field clears).`,
      )
    ) {
      return;
    }
    setActionError(null);
    startTransition(async () => {
      const res = await deleteFamilyAction(family.uuid);
      if (!res.ok) {
        setActionError(res);
        return;
      }
      toast.success("Family removed");
      router.push("/settings/product-families");
      router.refresh();
    });
  }

  if (joinError) {
    return <JoinErrorCard error={joinError} isEdit={isEdit} />;
  }

  return (
    <div
      ref={cursorAnchorRef}
      onMouseMove={canEdit ? onCursorMove : undefined}
      onMouseLeave={canEdit ? hideCursor : undefined}
      className="relative rounded-lg border border-border/60 bg-background p-5"
    >
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-lg">
        {Object.entries(cursors).map(([id, cursor]) => (
          <RemoteCursor
            key={id}
            cursor={cursor}
            anchorWidth={anchorSize.w}
            anchorHeight={anchorSize.h}
          />
        ))}
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {isEdit && family?.code ? (
            <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
              <span className="font-medium text-muted-foreground">Code</span>
              <span className="font-mono">{family.code}</span>
              <span className="text-muted-foreground/70">
                — auto-generated from your Numbering format, cannot be edited
              </span>
            </div>
          ) : (
            <span />
          )}
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

        <fieldset disabled={!canEdit || pending} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pf-name" className="text-sm">
              Name
            </Label>
            <div className="relative">
              <Input
                id="pf-name"
                value={state.name}
                onChange={(e) => setField("name", e.target.value)}
                onFocus={() => focusField("name")}
                onBlur={() => blurField("name")}
                placeholder="Vitamin C"
                maxLength={120}
                required
              />
              <FieldEditingIndicator peer={fieldEditors.name} />
            </div>
            <p className="text-xs text-muted-foreground">
              Group label shown on the items list. All variants (capsule /
              tablet / powder / flavoured…) sit under one family.
            </p>
            <FieldError messages={fieldErrors.name} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pf-desc" className="text-sm">
              Description (optional)
            </Label>
            <div className="relative">
              <Textarea
                id="pf-desc"
                value={state.description}
                onChange={(e) => setField("description", e.target.value)}
                onFocus={() => focusField("description")}
                onBlur={() => blurField("description")}
                rows={3}
                placeholder="What's in this family? Used in pickers and reports."
              />
              <FieldEditingIndicator peer={fieldEditors.description} />
            </div>
            <FieldError messages={fieldErrors.description} />
          </div>

          <label className="relative flex items-start gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm">
            <Checkbox
              checked={state.is_active}
              onCheckedChange={(c) => setField("is_active", Boolean(c))}
            />
            <span className="flex-1">
              <span className="font-medium">Active</span>
              <span className="block text-xs text-muted-foreground">
                Inactive families stay in history but disappear from the
                item-form picker.
              </span>
            </span>
            <FieldEditingIndicator peer={fieldEditors.is_active} />
          </label>
        </fieldset>

        {actionError && (
          <ErrorBanner
            detail={actionError.detail}
            code={actionError.code}
            debug={actionError.debug}
          />
        )}

        {canEdit && !isCreator && creator && (
          <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Only{" "}
              <span className="font-medium text-foreground">
                {creator.name}
              </span>{" "}
              can {isEdit ? "save" : "create"} from this room. Your edits sync
              to them live.
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {isEdit && canEdit && isCreator ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={pending}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Delete family
            </Button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            {dirty && !pending && isCreator && (
              <Button type="button" variant="ghost" onClick={onReset}>
                Discard
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/settings/product-families")}
            >
              Cancel
            </Button>
            {canEdit && (
              <Button
                type="submit"
                disabled={
                  !dirty ||
                  pending ||
                  !isCreator ||
                  !state.name.trim()
                }
                title={
                  isCreator
                    ? undefined
                    : creator
                      ? `Only ${creator.name} can ${isEdit ? "save" : "create"} from this room.`
                      : undefined
                }
              >
                {pending ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 size-4" />
                )}
                {isEdit ? "Save changes" : "Create family"}
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

function JoinErrorCard({
  error,
  isEdit,
}: {
  error: JoinError;
  isEdit: boolean;
}) {
  const config = {
    form_full: {
      icon: AlertCircle,
      title: "Form is at capacity",
      detail: error.limit
        ? `Up to ${error.limit} people can edit this family at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      title: "You can't edit here",
      detail:
        "Ask an admin for the `product_families.manage` permission to join this form.",
    },
    bad_topic: {
      icon: AlertCircle,
      title: "Unknown form",
      detail: "Couldn't recognise this form's address — try reloading.",
    },
    unknown: {
      icon: AlertCircle,
      title: "Couldn't join",
      detail: "The realtime connection refused this form. Try reloading.",
    },
  }[error.reason] ?? {
    icon: AlertCircle,
    title: "Couldn't join",
    detail: "The realtime connection refused this form. Try reloading.",
  };
  const Icon = config.icon;
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-background p-5">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">{config.title}</p>
          <p className="text-xs text-muted-foreground">{config.detail}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {isEdit
          ? "This family's edit form is shared in real time."
          : "The new-family draft form is shared in real time."}
      </p>
    </div>
  );
}
