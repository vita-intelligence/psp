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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import { FieldError } from "@/components/forms/field-error";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm, type JoinError } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import {
  createTagAction,
  deleteTagAction,
  updateTagAction,
} from "@/lib/storage-tags/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type { StorageTag } from "@/lib/types";

interface FormProps {
  /** `null` ⇒ new tag; otherwise the row being edited. */
  tag: StorageTag | null;
  canEdit: boolean;
  /** Fired on successful save so the EditModeToggle wrapper flips
   *  the page back to view mode. */
  onSavedSuccess?: () => void;
}

const KIND_OPTIONS: Array<{ value: StorageTag["kind"]; label: string }> = [
  { value: "both", label: "Both — racks and shelves" },
  { value: "location", label: "Racks/zones only" },
  { value: "cell", label: "Shelves/levels only" },
];

interface FormState {
  key: string;
  label: string;
  description: string;
  kind: StorageTag["kind"];
}

function initialFrom(tag: StorageTag | null): FormState {
  return {
    key: tag?.key ?? "",
    label: tag?.label ?? "",
    description: tag?.description ?? "",
    kind: tag?.kind ?? "both",
  };
}

/** Single-record form for the storage-tags admin. Used by /new and
 *  /[uuid]. On success navigates back to the list; on failure shows
 *  inline field errors + a banner with the raw detail. */
export function StorageTagForm({ tag, canEdit, onSavedSuccess }: FormProps) {
  const router = useRouter();
  const isEdit = tag !== null;
  const resource = tag ? `storage-tag:${tag.uuid}` : "storage-tag:new";

  useFormPresenceBeacon(resource);

  type CommitPayload =
    | { kind: "created"; uuid: string; label: string }
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
    initialState: useMemo(() => initialFrom(tag), [tag]),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Tag created", {
          description: `${creator?.name ?? "The host"} just finalised "${msg.label}".`,
        });
        router.push("/settings/storage-tags");
      } else if (msg.kind === "saved") {
        toast.success("Saved", {
          description: `${creator?.name ?? "The host"} just saved the tag.`,
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

  const [original, setOriginal] = useState<FormState>(() => initialFrom(tag));
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
        key: state.key.trim(),
        label: state.label.trim(),
        description: state.description.trim() || null,
        kind: state.kind,
      };

      const res = isEdit
        ? await updateTagAction(tag!.uuid, payload)
        : await createTagAction(payload);

      if (!res.ok) {
        setFieldErrors(res.fields ?? {});
        setActionError(res);
        return;
      }

      toast.success(isEdit ? "Tag updated" : "Tag created");
      setOriginal(state);

      if (isEdit) {
        broadcastCommit({ kind: "saved", state });
        onSavedSuccess?.();
      } else {
        broadcastCommit({
          kind: "created",
          uuid: res.tag.uuid,
          label: res.tag.label,
        });
      }
      router.push("/settings/storage-tags");
      router.refresh();
    });
  }

  function onReset() {
    resetState(original);
    setActionError(null);
    setFieldErrors({});
  }

  function onDelete() {
    if (!tag) return;
    if (
      !window.confirm(
        `Delete "${tag.label}"? Locations and cells already tagged with it will flag the missing reference until cleaned up.`,
      )
    ) {
      return;
    }
    setActionError(null);
    startTransition(async () => {
      const res = await deleteTagAction(tag.uuid);
      if (!res.ok) {
        setActionError(res);
        return;
      }
      toast.success("Tag removed");
      router.push("/settings/storage-tags");
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
          {isEdit && tag?.code ? (
            <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
              <span className="font-medium text-muted-foreground">Code</span>
              <span className="font-mono">{tag.code}</span>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="t-key" className="text-sm">
                Key (machine identifier)
              </Label>
              <div className="relative">
                <Input
                  id="t-key"
                  value={state.key}
                  onChange={(e) => setField("key", e.target.value)}
                  onFocus={() => focusField("key")}
                  onBlur={() => blurField("key")}
                  placeholder="cold-zone"
                  maxLength={60}
                  className="font-mono"
                  required
                  disabled={isEdit}
                />
                <FieldEditingIndicator peer={fieldEditors.key} />
              </div>
              <p className="text-xs text-muted-foreground">
                Lowercase letters / digits / hyphens. Allocation joins
                on this — keep it stable.
              </p>
              <FieldError messages={fieldErrors.key} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="t-label" className="text-sm">
                Label (shown in the picker)
              </Label>
              <div className="relative">
                <Input
                  id="t-label"
                  value={state.label}
                  onChange={(e) => setField("label", e.target.value)}
                  onFocus={() => focusField("label")}
                  onBlur={() => blurField("label")}
                  placeholder="Cold zone"
                  maxLength={80}
                  required
                />
                <FieldEditingIndicator peer={fieldEditors.label} />
              </div>
              <FieldError messages={fieldErrors.label} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Where it applies</Label>
              <div className="relative">
                <Select
                  value={state.kind}
                  onValueChange={(v) =>
                    setField("kind", v as StorageTag["kind"])
                  }
                >
                  <SelectTrigger
                    id="kind"
                    onFocus={() => focusField("kind")}
                    onBlur={() => blurField("kind")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KIND_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldEditingIndicator peer={fieldEditors.kind} />
              </div>
              <FieldError messages={fieldErrors.kind} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-desc" className="text-sm">
              Description (optional)
            </Label>
            <div className="relative">
              <Textarea
                id="t-desc"
                value={state.description}
                onChange={(e) => setField("description", e.target.value)}
                onFocus={() => focusField("description")}
                onBlur={() => blurField("description")}
                rows={3}
                placeholder="What's this tag for? Helps operators pick the right one."
              />
              <FieldEditingIndicator peer={fieldEditors.description} />
            </div>
            <FieldError messages={fieldErrors.description} />
          </div>
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
              Delete tag
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
              onClick={() => router.push("/settings/storage-tags")}
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
                  !state.key.trim() ||
                  !state.label.trim()
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
                {isEdit ? "Save changes" : "Create tag"}
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
        ? `Up to ${error.limit} people can edit this tag at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      title: "You can't edit here",
      detail:
        "Ask an admin for the `storage_tags.manage` permission to join this form.",
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
          ? "This tag's edit form is shared in real time."
          : "The new-tag draft form is shared in real time."}
      </p>
    </div>
  );
}
