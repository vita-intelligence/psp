"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  createAttributeDefinitionAction,
  deleteAttributeDefinitionAction,
  updateAttributeDefinitionAction,
} from "@/lib/attribute-definitions/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type {
  AttributeDefinition,
  AttributeEnumChoice,
  AttributeScope,
  AttributeType,
} from "@/lib/types";

interface FormProps {
  attribute: AttributeDefinition | null;
  canEdit: boolean;
}

const SCOPES: Array<{ value: AttributeScope; label: string }> = [
  { value: "raw_material", label: "Raw material" },
  { value: "semi_finished", label: "Semi-finished" },
  { value: "finished_product", label: "Finished product" },
  { value: "packaging", label: "Packaging" },
  { value: "item_any", label: "Any item type" },
];

const TYPES: Array<{ value: AttributeType; label: string; hint: string }> = [
  { value: "text", label: "Text", hint: "Free text input." },
  { value: "number", label: "Number", hint: "Numeric input. Add a unit if relevant." },
  { value: "boolean", label: "Boolean", hint: "Yes / No checkbox." },
  { value: "date", label: "Date", hint: "ISO date picker." },
  { value: "enum", label: "Enum", hint: "One of a set of configured choices." },
  { value: "url", label: "URL", hint: "Must start with http:// or https://." },
];

export function AttributeDefinitionForm({ attribute, canEdit }: FormProps) {
  const router = useRouter();
  const isEdit = attribute !== null;

  const [scope, setScope] = useState<AttributeScope>(
    attribute?.scope ?? "raw_material",
  );
  const [key, setKey] = useState(attribute?.key ?? "");
  const [label, setLabel] = useState(attribute?.label ?? "");
  const [type, setType] = useState<AttributeType>(
    attribute?.attribute_type ?? "text",
  );
  const [enumChoices, setEnumChoices] = useState<AttributeEnumChoice[]>(
    attribute?.enum_choices ?? [],
  );
  const [required, setRequired] = useState(attribute?.required ?? false);
  const [unitSymbol, setUnitSymbol] = useState(attribute?.unit_symbol ?? "");
  const [helpText, setHelpText] = useState(attribute?.help_text ?? "");
  const [sortOrder, setSortOrder] = useState(
    attribute?.sort_order?.toString() ?? "0",
  );
  const [isActive, setIsActive] = useState(attribute?.is_active ?? true);
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function addChoice() {
    setEnumChoices((c) => [...c, { value: "", label: "" }]);
  }

  function removeChoice(i: number) {
    setEnumChoices((c) => c.filter((_, idx) => idx !== i));
  }

  function setChoice(i: number, patch: Partial<AttributeEnumChoice>) {
    setEnumChoices((c) =>
      c.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setFieldErrors({});

    startTransition(async () => {
      const payload = {
        scope,
        key: key.trim(),
        label: label.trim(),
        attribute_type: type,
        enum_choices: type === "enum" ? enumChoices : [],
        required,
        unit_symbol: unitSymbol.trim() || null,
        help_text: helpText.trim() || null,
        sort_order: Number(sortOrder) || 0,
        is_active: isActive,
      };

      const res = isEdit
        ? await updateAttributeDefinitionAction(attribute!.uuid, payload)
        : await createAttributeDefinitionAction(payload);

      if (!res.ok) {
        setFieldErrors(res.fields ?? {});
        setActionError(res);
        return;
      }

      toast.success(isEdit ? "Attribute updated" : "Attribute created");
      router.push("/settings/attribute-definitions");
      router.refresh();
    });
  }

  function onDelete() {
    if (!attribute) return;
    if (
      !window.confirm(
        `Delete "${attribute.label}"? Items currently storing values for this attribute will keep them on items.attributes but they will no longer render in the form.`,
      )
    ) {
      return;
    }
    setActionError(null);
    startTransition(async () => {
      const res = await deleteAttributeDefinitionAction(attribute.uuid);
      if (!res.ok) {
        setActionError(res);
        return;
      }
      toast.success("Attribute removed");
      router.push("/settings/attribute-definitions");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-lg border border-border/60 bg-background p-5"
    >
      {isEdit && attribute?.code && (
        <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
          <span className="font-medium text-muted-foreground">Code</span>
          <span className="font-mono">{attribute.code}</span>
        </div>
      )}

      <fieldset disabled={!canEdit || pending} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-sm">Scope</Label>
            <Select
              value={scope}
              onValueChange={(v) => setScope(v as AttributeScope)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Determines which item type the field renders on.
            </p>
            <FieldError messages={fieldErrors.scope} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Type</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as AttributeType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <div className="flex flex-col">
                      <span>{t.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {t.hint}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError messages={fieldErrors.attribute_type} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ad-key" className="text-sm">
              Key (machine identifier)
            </Label>
            <Input
              id="ad-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="cas_number, country_of_origin…"
              maxLength={60}
              className="font-mono"
              required
              disabled={isEdit}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters / digits / underscores. Immutable once set.
            </p>
            <FieldError messages={fieldErrors.key} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ad-label" className="text-sm">
              Label
            </Label>
            <Input
              id="ad-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="CAS number"
              maxLength={80}
              required
            />
            <FieldError messages={fieldErrors.label} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ad-unit" className="text-sm">
              Unit symbol (optional)
            </Label>
            <Input
              id="ad-unit"
              value={unitSymbol}
              onChange={(e) => setUnitSymbol(e.target.value)}
              placeholder="kg, mL, %, …"
              maxLength={12}
              className="font-mono"
            />
            <FieldError messages={fieldErrors.unit_symbol} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ad-order" className="text-sm">
              Sort order
            </Label>
            <Input
              id="ad-order"
              type="number"
              inputMode="numeric"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Lower numbers appear higher in the item form.
            </p>
            <FieldError messages={fieldErrors.sort_order} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ad-help" className="text-sm">
            Help text (optional)
          </Label>
          <Textarea
            id="ad-help"
            value={helpText}
            onChange={(e) => setHelpText(e.target.value)}
            rows={2}
            placeholder="One-line hint shown under the field on the item form."
          />
          <FieldError messages={fieldErrors.help_text} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm">
            <Checkbox
              checked={required}
              onCheckedChange={(c) => setRequired(Boolean(c))}
            />
            <span className="flex-1">
              <span className="font-medium">Required</span>
              <span className="block text-xs text-muted-foreground">
                Items in this scope can&apos;t save without a value.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm">
            <Checkbox
              checked={isActive}
              onCheckedChange={(c) => setIsActive(Boolean(c))}
            />
            <span className="flex-1">
              <span className="font-medium">Active</span>
              <span className="block text-xs text-muted-foreground">
                Inactive attributes vanish from the item form but values
                already saved on items are preserved.
              </span>
            </span>
          </label>
        </div>

        {type === "enum" && (
          <div className="space-y-3 rounded-md border border-border/40 bg-muted/10 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Enum choices</h3>
                <p className="text-xs text-muted-foreground">
                  Each choice has a stored value + display label.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addChoice}
              >
                <Plus className="mr-1 size-3.5" />
                Add choice
              </Button>
            </div>
            {enumChoices.length === 0 && (
              <p className="rounded-md border border-dashed border-border/60 py-4 text-center text-xs text-muted-foreground">
                No choices yet — add at least one.
              </p>
            )}
            {enumChoices.map((c, i) => (
              <div
                key={i}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"
              >
                <Input
                  value={c.value}
                  onChange={(e) => setChoice(i, { value: e.target.value })}
                  placeholder="stored-value"
                  className="font-mono"
                />
                <Input
                  value={c.label}
                  onChange={(e) => setChoice(i, { label: e.target.value })}
                  placeholder="Display label"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeChoice(i)}
                  className="text-destructive hover:text-destructive"
                  aria-label="Remove choice"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
            <FieldError messages={fieldErrors.enum_choices} />
          </div>
        )}
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
            Delete attribute
          </Button>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/settings/attribute-definitions")}
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
              {isEdit ? "Save changes" : "Create attribute"}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
