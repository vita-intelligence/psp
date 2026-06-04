"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save, Trash2 } from "lucide-react";
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
}

const KIND_OPTIONS: Array<{ value: StorageTag["kind"]; label: string }> = [
  { value: "both", label: "Both — racks and shelves" },
  { value: "location", label: "Racks/zones only" },
  { value: "cell", label: "Shelves/levels only" },
];

/** Single-record form for the storage-tags admin. Used by /new and
 *  /[uuid]. On success navigates back to the list; on failure shows
 *  inline field errors + a banner with the raw detail. */
export function StorageTagForm({ tag, canEdit }: FormProps) {
  const router = useRouter();
  const isEdit = tag !== null;
  const [key, setKey] = useState(tag?.key ?? "");
  const [label, setLabel] = useState(tag?.label ?? "");
  const [description, setDescription] = useState(tag?.description ?? "");
  const [kind, setKind] = useState<StorageTag["kind"]>(tag?.kind ?? "both");
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setFieldErrors({});

    startTransition(async () => {
      const payload = {
        key: key.trim(),
        label: label.trim(),
        description: description.trim() || null,
        kind,
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
      router.push("/settings/storage-tags");
      router.refresh();
    });
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

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-lg border border-border/60 bg-background p-5"
    >
      {isEdit && tag?.code && (
        <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
          <span className="font-medium text-muted-foreground">Code</span>
          <span className="font-mono">{tag.code}</span>
          <span className="text-muted-foreground/70">
            — auto-generated from your Numbering format, cannot be edited
          </span>
        </div>
      )}

      <fieldset disabled={!canEdit || pending} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="t-key" className="text-sm">
              Key (machine identifier)
            </Label>
            <Input
              id="t-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="cold-zone"
              maxLength={60}
              className="font-mono"
              required
              disabled={isEdit /* keys are immutable once assigned */}
            />
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
            <Input
              id="t-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Cold zone"
              maxLength={80}
              required
            />
            <FieldError messages={fieldErrors.label} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Where it applies</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as StorageTag["kind"])}
            >
              <SelectTrigger>
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
            <FieldError messages={fieldErrors.kind} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="t-desc" className="text-sm">
            Description (optional)
          </Label>
          <Textarea
            id="t-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What's this tag for? Helps operators pick the right one."
          />
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        {isEdit && canEdit ? (
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
              disabled={pending || !key.trim() || !label.trim()}
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
  );
}
