"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorBanner } from "@/components/forms/error-banner";
import { FieldError } from "@/components/forms/field-error";
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

/** Single-record form for the product-families admin. Mirrors the
 *  storage-tag form pattern. Code is auto-rendered from numbering
 *  format; only name / description / active are editable. */
export function ProductFamilyForm({ family, canEdit }: FormProps) {
  const router = useRouter();
  const isEdit = family !== null;
  const [name, setName] = useState(family?.name ?? "");
  const [description, setDescription] = useState(family?.description ?? "");
  const [isActive, setIsActive] = useState(family?.is_active ?? true);
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setFieldErrors({});

    startTransition(async () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        is_active: isActive,
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
      router.push("/settings/product-families");
      router.refresh();
    });
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

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-lg border border-border/60 bg-background p-5"
    >
      {isEdit && family?.code && (
        <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
          <span className="font-medium text-muted-foreground">Code</span>
          <span className="font-mono">{family.code}</span>
          <span className="text-muted-foreground/70">
            — auto-generated from your Numbering format, cannot be edited
          </span>
        </div>
      )}

      <fieldset disabled={!canEdit || pending} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pf-name" className="text-sm">
            Name
          </Label>
          <Input
            id="pf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Vitamin C"
            maxLength={120}
            required
          />
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
          <Textarea
            id="pf-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What's in this family? Used in pickers and reports."
          />
          <FieldError messages={fieldErrors.description} />
        </div>

        <label className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm">
          <Checkbox
            checked={isActive}
            onCheckedChange={(c) => setIsActive(Boolean(c))}
          />
          <span className="flex-1">
            <span className="font-medium">Active</span>
            <span className="block text-xs text-muted-foreground">
              Inactive families stay in history but disappear from the
              item-form picker.
            </span>
          </span>
        </label>
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
            Delete family
          </Button>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/settings/product-families")}
          >
            Cancel
          </Button>
          {canEdit && (
            <Button type="submit" disabled={pending || !name.trim()}>
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
  );
}
