"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, GripVertical, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge-mini";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { FormField, FormFieldOption } from "@/lib/forms/types";

interface Props {
  field: FormField;
  allFields: FormField[];
  onChange: (updated: FormField) => void;
  onDelete: () => void;
  disabled?: boolean;
}

const CONDITION_ELIGIBLE_TYPES = ["yes_no", "dropdown", "checkbox"] as const;

function newOptionForType(type: FormField["type"]): FormFieldOption {
  if (type === "task_select") {
    return {
      id: crypto.randomUUID(),
      label: "",
      target_quantity: undefined,
      target_duration: undefined,
    };
  }
  return { id: crypto.randomUUID(), label: "" };
}

export function FieldEditor({
  field,
  allFields,
  onChange,
  onDelete,
  disabled,
}: Props) {
  const [expanded, setExpanded] = useState(true);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  function update(patch: Partial<FormField>) {
    onChange({ ...field, ...patch });
  }

  function addOption() {
    onChange({
      ...field,
      options: [...(field.options ?? []), newOptionForType(field.type)],
    });
  }

  function updateOption(id: string, patch: Partial<FormFieldOption>) {
    onChange({
      ...field,
      options: (field.options ?? []).map((o) =>
        o.id === id ? { ...o, ...patch } : o,
      ),
    });
  }

  function removeOption(id: string) {
    onChange({
      ...field,
      options: (field.options ?? []).filter((o) => o.id !== id),
    });
  }

  const conditionSourceFields = allFields.filter(
    (f) =>
      f.id !== field.id &&
      (CONDITION_ELIGIBLE_TYPES as readonly string[]).includes(f.type),
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-md border border-border/60 bg-background"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <button
          type="button"
          className={cn(
            "cursor-grab text-muted-foreground hover:text-foreground",
            disabled && "cursor-not-allowed opacity-40",
            isDragging && "cursor-grabbing",
          )}
          {...attributes}
          {...listeners}
          disabled={disabled}
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          className="flex flex-1 items-center gap-1.5 truncate text-left text-sm font-medium"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground" />
          )}
          <span className="truncate">
            {field.label || `Untitled ${field.type.replace("_", " ")}`}
          </span>
        </button>
        <Badge tone="muted">{field.type.replace("_", " ")}</Badge>
        {field.required && <Badge tone="amber">Required</Badge>}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onDelete}
          disabled={disabled}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {expanded && (
        <div className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Label</Label>
            <Input
              value={field.label}
              onChange={(e) => update({ label: e.target.value })}
              placeholder="What are you asking?"
              disabled={disabled}
            />
          </div>

          {(field.type === "text" || field.type === "number") && (
            <div className="space-y-1.5">
              <Label className="text-xs">Placeholder (optional)</Label>
              <Input
                value={field.placeholder ?? ""}
                onChange={(e) => update({ placeholder: e.target.value })}
                placeholder="Hint text shown in the empty input"
                disabled={disabled}
              />
            </div>
          )}

          {field.type === "rating" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Max rating</Label>
              <Select
                value={String(field.max_rating ?? 5)}
                onValueChange={(v) => update({ max_rating: Number(v) })}
                disabled={disabled}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} stars
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {(field.type === "checkbox" || field.type === "dropdown") && (
            <div className="space-y-2">
              <Label className="text-xs">Options</Label>
              {(field.options ?? []).map((opt) => (
                <div key={opt.id} className="flex items-center gap-2">
                  <Input
                    value={opt.label}
                    onChange={(e) =>
                      updateOption(opt.id, { label: e.target.value })
                    }
                    placeholder="Option label"
                    disabled={disabled}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeOption(opt.id)}
                    disabled={disabled}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addOption}
                disabled={disabled}
              >
                <Plus className="mr-1.5 size-3.5" />
                Add option
              </Button>
            </div>
          )}

          {field.type === "task_select" && (
            <div className="space-y-2">
              <Label className="text-xs">Tasks</Label>
              <p className="text-xs text-muted-foreground">
                Selecting a task on the kiosk overrides the WorkSession's
                target quantity and duration for performance scoring.
              </p>
              {(field.options ?? []).map((opt) => {
                return (
                  <div
                    key={opt.id}
                    className="space-y-2 rounded-md border border-border/60 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        value={opt.label}
                        onChange={(e) =>
                          updateOption(opt.id, { label: e.target.value })
                        }
                        placeholder="Task name (e.g. V-Blender Room)"
                        disabled={disabled}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeOption(opt.id)}
                        disabled={disabled}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={opt.target_quantity ?? ""}
                        onChange={(e) =>
                          updateOption(opt.id, {
                            target_quantity: e.target.value
                              ? Number(e.target.value)
                              : undefined,
                          })
                        }
                        placeholder="Target qty"
                        disabled={disabled}
                      />
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={opt.target_duration ?? ""}
                        onChange={(e) =>
                          updateOption(opt.id, {
                            target_duration: e.target.value
                              ? Number(e.target.value)
                              : undefined,
                          })
                        }
                        placeholder="Target hours"
                        disabled={disabled}
                      />
                    </div>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addOption}
                disabled={disabled}
              >
                <Plus className="mr-1.5 size-3.5" />
                Add task
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">Required</p>
              <p className="text-xs text-muted-foreground">
                {field.type === "acknowledgement"
                  ? "Always on for acknowledgements — the operator can't submit without ticking the box."
                  : "Worker must answer this field before completing the form."}
              </p>
            </div>
            <Switch
              checked={
                field.type === "acknowledgement" ? true : field.required
              }
              onCheckedChange={(v) => update({ required: v })}
              disabled={disabled || field.type === "acknowledgement"}
            />
          </div>

          <div className="space-y-2 border-t border-border/60 pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <Label className="text-xs">Show only if</Label>
              <p className="text-[11px] text-muted-foreground">
                Hide this field until an earlier answer matches.
              </p>
            </div>

            {conditionSourceFields.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/60 bg-muted/10 p-3 text-xs text-muted-foreground">
                Add a <span className="font-medium">yes / no</span>,{" "}
                <span className="font-medium">dropdown</span>, or{" "}
                <span className="font-medium">checkbox</span> field above
                this one to condition it on the operator's answer.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
                <Select
                  value={field.condition?.field_id ?? "__none__"}
                  onValueChange={(v) => {
                    if (v === "__none__") {
                      update({ condition: null });
                    } else {
                      update({
                        condition: {
                          field_id: v,
                          operator: field.condition?.operator ?? "equals",
                          value: field.condition?.value ?? "",
                        },
                      });
                    }
                  }}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No condition" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">No condition</span>
                    </SelectItem>
                    {conditionSourceFields.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.label || `Untitled ${f.type}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {field.condition?.field_id && (
                  <>
                    <Select
                      value={field.condition.operator}
                      onValueChange={(v) =>
                        update({
                          condition: {
                            ...field.condition!,
                            operator: v as "equals" | "not_equals",
                          },
                        })
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equals">equals</SelectItem>
                        <SelectItem value="not_equals">not equals</SelectItem>
                      </SelectContent>
                    </Select>
                    <ConditionValueInput
                      allFields={allFields}
                      condition={field.condition}
                      onChange={(value) =>
                        update({
                          condition: { ...field.condition!, value },
                        })
                      }
                      disabled={disabled}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConditionValueInput({
  allFields,
  condition,
  onChange,
  disabled,
}: {
  allFields: FormField[];
  condition: NonNullable<FormField["condition"]>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const source = allFields.find((f) => f.id === condition.field_id);
  if (!source) {
    return (
      <Input
        value={condition.value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Value"
        disabled={disabled}
      />
    );
  }

  const options: string[] = [];
  if (source.type === "yes_no") {
    options.push("yes", "no");
  } else if (
    (source.type === "dropdown" || source.type === "checkbox") &&
    source.options
  ) {
    for (const o of source.options) {
      if (o.label) options.push(o.label);
    }
  }

  if (options.length === 0) {
    return (
      <Input
        value={condition.value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Value"
        disabled={disabled}
      />
    );
  }

  return (
    <Select value={condition.value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder="Select value" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">
          <span className="text-muted-foreground">Select value</span>
        </SelectItem>
        {options.map((v) => (
          <SelectItem key={v} value={v}>
            {v}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
