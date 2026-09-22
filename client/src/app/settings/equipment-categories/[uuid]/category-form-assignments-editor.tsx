"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-mini";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorResult } from "@/lib/errors/server";
import type { CategoryFormAssignment } from "@/lib/equipment/server";
import type { FormTemplate } from "@/lib/forms/types";
import { replaceCategoryFormAssignmentsAction } from "@/lib/equipment/actions";

interface Props {
  categoryUuid: string;
  initial: CategoryFormAssignment[];
  allTemplates: FormTemplate[];
  canEdit: boolean;
}

type Slot =
  | "equipment_cleaning_start"
  | "equipment_cleaning_end"
  | "equipment_maintenance_start"
  | "equipment_maintenance_end";

/** Slim shape the editor row renderer needs — just enough to
 *  identify the template + surface an archived-tag when the
 *  template was retired after being attached. */
interface AttachedTemplate {
  uuid: string;
  name: string;
  is_active: boolean;
}

interface Attached {
  slot: Slot;
  sort_order: number;
  template: AttachedTemplate;
}

const SLOT_LABEL: Record<Slot, string> = {
  equipment_cleaning_start: "Cleaning · start",
  equipment_cleaning_end: "Cleaning · end",
  equipment_maintenance_start: "Maintenance · start",
  equipment_maintenance_end: "Maintenance · end",
};

const SLOT_SUBTITLE: Record<Slot, string> = {
  equipment_cleaning_start:
    "Fires BEFORE the timer opens on a cleaning session against a machine in this category — pre-cleaning verification.",
  equipment_cleaning_end:
    "Fires AFTER the operator taps Stop on a cleaning session against a machine in this category.",
  equipment_maintenance_start:
    "Fires BEFORE the timer opens on a maintenance session against a machine in this category.",
  equipment_maintenance_end:
    "Fires AFTER the operator taps Stop on a maintenance session against a machine in this category.",
};

const SLOT_ORDER: readonly Slot[] = [
  "equipment_cleaning_start",
  "equipment_cleaning_end",
  "equipment_maintenance_start",
  "equipment_maintenance_end",
] as const;

export function CategoryFormAssignmentsEditor({
  categoryUuid,
  initial,
  allTemplates,
  canEdit,
}: Props) {
  // Local edit state — dirtied by attach / detach / reorder. Save
  // pushes the whole set as a bulk PUT (matches the workstation
  // form-attachments UX).
  const [attached, setAttached] = useState<Attached[]>(() =>
    initial
      .filter((a) => a.form_template)
      .map((a) => {
        const t = allTemplates.find((x) => x.uuid === a.form_template!.uuid);
        return {
          slot: a.slot,
          sort_order: a.sort_order,
          template: t
            ? { uuid: t.uuid, name: t.name, is_active: t.is_active }
            : {
                uuid: a.form_template!.uuid,
                name: a.form_template!.name,
                is_active: a.form_template!.is_active,
              },
        };
      }),
  );
  const [error, setError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);

  const bySlot = useMemo(() => {
    const empty = {
      equipment_cleaning_start: [] as Attached[],
      equipment_cleaning_end: [] as Attached[],
      equipment_maintenance_start: [] as Attached[],
      equipment_maintenance_end: [] as Attached[],
    };
    for (const a of attached) {
      empty[a.slot].push(a);
    }
    for (const key of SLOT_ORDER) {
      empty[key].sort((a, b) => a.sort_order - b.sort_order);
    }
    return empty;
  }, [attached]);

  const attachedUuids = useMemo(
    () => new Set(attached.map((a) => a.template.uuid)),
    [attached],
  );

  const availableFor = (slot: Slot) =>
    allTemplates.filter(
      (t) => t.trigger === slot && !attachedUuids.has(t.uuid),
    );

  function attach(slot: Slot, templateUuid: string) {
    const template = allTemplates.find((t) => t.uuid === templateUuid);
    if (!template) return;
    const nextSort = bySlot[slot].length;
    setAttached((prev) => [
      ...prev,
      {
        slot,
        sort_order: nextSort,
        template: {
          uuid: template.uuid,
          name: template.name,
          is_active: template.is_active,
        },
      },
    ]);
    setDirty(true);
  }

  function detach(templateUuid: string) {
    setAttached((prev) => prev.filter((a) => a.template.uuid !== templateUuid));
    setDirty(true);
  }

  function move(slot: Slot, templateUuid: string, delta: number) {
    const list = bySlot[slot];
    const idx = list.findIndex((a) => a.template.uuid === templateUuid);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= list.length) return;
    const reordered = [...list];
    [reordered[idx], reordered[to]] = [reordered[to], reordered[idx]];
    // Rewrite sort_order across the slot; leave the other slot alone.
    setAttached((prev) => {
      const others = prev.filter((a) => a.slot !== slot);
      const withOrder = reordered.map((a, i) => ({ ...a, sort_order: i }));
      return [...others, ...withOrder];
    });
    setDirty(true);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const payload = attached
        .filter((a) => a.template.is_active)
        .map((a) => ({
          form_template_uuid: a.template.uuid,
          slot: a.slot,
          sort_order: a.sort_order,
        }));
      const res = await replaceCategoryFormAssignmentsAction(
        categoryUuid,
        payload,
      );
      if (!res.ok) {
        setError(res);
        return;
      }
      setDirty(false);
      toast.success("Form assignments saved.");
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <ErrorBanner
          detail={error.detail}
          code={error.code}
          debug={error.debug}
        />
      )}

      {SLOT_ORDER.map((slot) => (
        <SlotSection
          key={slot}
          title={SLOT_LABEL[slot]}
          subtitle={SLOT_SUBTITLE[slot]}
          slot={slot}
          rows={bySlot[slot]}
          available={availableFor(slot)}
          onAttach={(uuid) => attach(slot, uuid)}
          onDetach={detach}
          onMove={(uuid, d) => move(slot, uuid, d)}
          canEdit={canEdit}
        />
      ))}

      {canEdit && (
        <div className="flex items-center gap-3 border-t border-border/60 pt-4">
          <Button
            type="button"
            onClick={handleSave}
            disabled={!dirty || pending}
          >
            {pending ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Saving…
              </span>
            ) : (
              "Save changes"
            )}
          </Button>
          {dirty && (
            <span className="text-xs text-muted-foreground">
              Unsaved changes — every kiosk with a machine in this category
              will refresh its forms on save.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SlotSection({
  title,
  subtitle,
  slot: _slot,
  rows,
  available,
  onAttach,
  onDetach,
  onMove,
  canEdit,
}: {
  title: string;
  subtitle: string;
  slot: Slot;
  rows: Attached[];
  available: FormTemplate[];
  onAttach: (uuid: string) => void;
  onDetach: (uuid: string) => void;
  onMove: (uuid: string, delta: number) => void;
  canEdit: boolean;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-background/60 p-3">
      <div>
        <Label className="text-sm">{title}</Label>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>

      {rows.length > 0 ? (
        <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-background">
          {rows.map((row, idx) => (
            <li
              key={row.template.uuid}
              className="flex items-center gap-2 px-3 py-2"
            >
              <span className="w-6 shrink-0 text-center font-mono text-xs text-muted-foreground">
                {idx + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {row.template.name}
              </span>
              {!row.template.is_active && (
                <Badge tone="muted">archived</Badge>
              )}
              {canEdit && (
                <div className="flex items-center gap-0.5 text-muted-foreground">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={idx === 0}
                    onClick={() => onMove(row.template.uuid, -1)}
                    aria-label="Move up"
                  >
                    <ArrowUp className="size-3.5" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={idx === rows.length - 1}
                    onClick={() => onMove(row.template.uuid, 1)}
                    aria-label="Move down"
                  >
                    <ArrowDown className="size-3.5" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => onDetach(row.template.uuid)}
                    aria-label="Detach"
                  >
                    <X className="size-3.5" aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-4 text-xs text-muted-foreground">
          No forms attached to this slot yet.
        </p>
      )}

      {canEdit && (
        <div className="flex items-center gap-2 pt-1">
          <Select
            value=""
            onValueChange={(v) => v && onAttach(v)}
            disabled={available.length === 0}
          >
            <SelectTrigger className="w-64">
              <SelectValue
                placeholder={
                  available.length === 0
                    ? "No unattached templates for this slot"
                    : "Attach a form template…"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {available.map((t) => (
                <SelectItem key={t.uuid} value={t.uuid}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Plus className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="text-[11px] text-muted-foreground">
            Only templates with the matching trigger show up.
          </span>
        </div>
      )}
    </div>
  );
}
