"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Coins,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge-mini";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  createRunningCostComponentAction,
  deleteRunningCostComponentAction,
  updateRunningCostComponentAction,
} from "@/lib/equipment/actions";
import type { EquipmentRunningCostComponent } from "@/lib/equipment/types";
import type { CompanyDefaults } from "@/lib/types";
import { formatCompanyMoney } from "@/lib/format/company";

interface Props {
  equipmentUuid: string;
  components: EquipmentRunningCostComponent[];
  hourlyRunningCost: string | null;
  hourlyRunningCostCurrency: string | null;
  workstation: {
    id: number;
    name: string;
    uuid: string;
  } | null;
  canEdit: boolean;
  prefs: CompanyDefaults;
  defaultCurrency: string;
}

/**
 * Running-cost stack for one equipment unit — one row per cost
 * driver (electricity, compressed air, consumables, maintenance
 * reserve, licence fee, …). The sum of active components lands on
 * the unit's `hourly_running_cost` and flows into the workstation
 * cost roll-up when the unit is attached to a station.
 *
 * Deliberately generic — no fixed "electricity" or "amortisation"
 * columns. Operators can add whatever line items the cost model
 * needs and label them however makes sense per unit.
 */
export function EquipmentRunningCostCard({
  equipmentUuid,
  components,
  hourlyRunningCost,
  hourlyRunningCostCurrency,
  workstation,
  canEdit,
  prefs,
  defaultCurrency,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);

  const [form, setForm] = useState({
    label: "",
    amount_per_hour: "",
    currency: defaultCurrency || "GBP",
    notes: "",
  });

  function resetAddForm() {
    setForm({
      label: "",
      amount_per_hour: "",
      currency: defaultCurrency || "GBP",
      notes: "",
    });
    setShowAdd(false);
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const label = form.label.trim();
    if (!label) {
      toast.error("Label is required");
      return;
    }
    if (!form.amount_per_hour || Number(form.amount_per_hour) < 0) {
      toast.error("Amount per hour must be a non-negative number");
      return;
    }
    startTransition(async () => {
      const res = await createRunningCostComponentAction(equipmentUuid, {
        label,
        amount_per_hour: form.amount_per_hour,
        currency: form.currency.trim().toUpperCase() || null,
        notes: form.notes.trim() || null,
      });
      if (res.ok) {
        toast.success("Cost line added");
        resetAddForm();
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  function onDelete(uuid: string, label: string) {
    if (!confirm(`Archive "${label}"?`)) return;
    startTransition(async () => {
      const res = await deleteRunningCostComponentAction(equipmentUuid, uuid);
      if (res.ok) {
        toast.success("Archived");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  function onSubmitEdit(
    uuid: string,
    input: {
      label: string;
      amount_per_hour: string;
      currency: string;
      notes: string;
      is_active: boolean;
    },
  ) {
    if (!input.label.trim()) {
      toast.error("Label is required");
      return;
    }
    startTransition(async () => {
      const res = await updateRunningCostComponentAction(equipmentUuid, uuid, {
        label: input.label.trim(),
        amount_per_hour: input.amount_per_hour,
        currency: input.currency.trim().toUpperCase() || null,
        notes: input.notes.trim() || null,
        is_active: input.is_active,
      });
      if (res.ok) {
        toast.success("Saved");
        setEditingUuid(null);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  const activeCount = components.filter((c) => c.is_active).length;
  const totalDisplay =
    hourlyRunningCost && Number(hourlyRunningCost) > 0
      ? `${formatCompanyMoney(hourlyRunningCost, prefs)} / h`
      : "—";

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-muted-foreground" />
              Running cost while operating
              <span className="text-[11px] font-normal text-muted-foreground">
                · {activeCount} active
              </span>
            </CardTitle>
            <CardDescription>
              {workstation ? (
                <>
                  Attached to workstation{" "}
                  <span className="font-medium text-foreground">
                    {workstation.name}
                  </span>{" "}
                  — the total below flows into that station's cost
                  roll-up when this unit is in service.
                </>
              ) : (
                <>
                  Not attached to a workstation. Cost is tracked here
                  for reporting but doesn't flow into any MO cost
                  breakdown yet — set a workstation to wire it up.
                </>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Total per hour
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {totalDisplay}
                {hourlyRunningCostCurrency &&
                hourlyRunningCostCurrency !== prefs.currency_code ? (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    ({hourlyRunningCostCurrency})
                  </span>
                ) : null}
              </p>
            </div>
            {canEdit ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAdd((s) => !s)}
                disabled={pending}
                type="button"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add line
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">

      {showAdd && canEdit ? (
        <form
          onSubmit={onCreate}
          className="mb-3 space-y-3 rounded-md border border-border/60 bg-muted/30 p-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Label htmlFor="rc-label" className="text-xs">
                Label
              </Label>
              <Input
                id="rc-label"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Electricity, Compressed air, Maintenance reserve…"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="rc-amt" className="text-xs">
                Amount / h
              </Label>
              <Input
                id="rc-amt"
                value={form.amount_per_hour}
                onChange={(e) =>
                  setForm({ ...form, amount_per_hour: e.target.value })
                }
                placeholder="0.00000"
                inputMode="decimal"
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="rc-ccy" className="text-xs">
                Currency
              </Label>
              <Input
                id="rc-ccy"
                value={form.currency}
                onChange={(e) =>
                  setForm({ ...form, currency: e.target.value.toUpperCase() })
                }
                maxLength={3}
                className="mt-1 font-mono uppercase"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="rc-notes" className="text-xs">
              Notes (optional) — assumptions, rate source, formula
            </Label>
            <Textarea
              id="rc-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g. 3.5 kW × £0.32/kWh @ 100% duty"
              className="mt-1"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetAddForm}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="mr-1 h-3.5 w-3.5" />
              )}
              Add line
            </Button>
          </div>
        </form>
      ) : null}

      {components.length === 0 ? (
        <p className="rounded-md bg-muted/40 p-4 text-center text-sm text-muted-foreground">
          No running-cost lines yet. Add one for each cost driver
          (electricity, air, consumables, maintenance reserve, …) and the
          system sums them into the hourly rate for cost roll-ups.
        </p>
      ) : (
        <ul className="space-y-2">
          {components.map((c) => (
            <ComponentRow
              key={c.uuid}
              component={c}
              canEdit={canEdit}
              pending={pending}
              prefs={prefs}
              isEditing={editingUuid === c.uuid}
              onStartEdit={() => setEditingUuid(c.uuid)}
              onCancelEdit={() => setEditingUuid(null)}
              onSubmitEdit={(input) => onSubmitEdit(c.uuid, input)}
              onDelete={() => onDelete(c.uuid, c.label)}
            />
          ))}
        </ul>
      )}
      </CardContent>
    </Card>
  );
}

interface ComponentRowProps {
  component: EquipmentRunningCostComponent;
  canEdit: boolean;
  pending: boolean;
  prefs: CompanyDefaults;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: (input: {
    label: string;
    amount_per_hour: string;
    currency: string;
    notes: string;
    is_active: boolean;
  }) => void;
  onDelete: () => void;
}

function ComponentRow(props: ComponentRowProps) {
  const {
    component,
    canEdit,
    pending,
    prefs,
    isEditing,
    onStartEdit,
    onCancelEdit,
    onSubmitEdit,
    onDelete,
  } = props;

  if (isEditing) {
    return (
      <li className="rounded-md border border-border/60 bg-muted/20">
        <EditForm
          component={component}
          pending={pending}
          onCancel={onCancelEdit}
          onSubmit={onSubmitEdit}
        />
      </li>
    );
  }

  const inactive = !component.is_active;

  return (
    <li
      className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm ${
        inactive
          ? "border-border/40 bg-muted/20 opacity-60"
          : "border-border/60 bg-background"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{component.label}</span>
          {inactive ? <Badge tone="muted">Archived</Badge> : null}
        </div>
        {component.notes ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {component.notes}
          </p>
        ) : null}
      </div>
      <div className="whitespace-nowrap text-right tabular-nums">
        <span className="text-sm font-semibold">
          {formatCompanyMoney(component.amount_per_hour, prefs)} / h
        </span>
        {component.currency && component.currency !== prefs.currency_code ? (
          <span className="ml-1 text-[10px] text-muted-foreground">
            ({component.currency})
          </span>
        ) : null}
      </div>
      {canEdit ? (
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={onStartEdit}
            disabled={pending}
            title="Edit line"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {!inactive ? (
            <Button
              size="icon"
              variant="ghost"
              onClick={onDelete}
              disabled={pending}
              title="Archive line"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function EditForm({
  component,
  pending,
  onCancel,
  onSubmit,
}: {
  component: EquipmentRunningCostComponent;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    label: string;
    amount_per_hour: string;
    currency: string;
    notes: string;
    is_active: boolean;
  }) => void;
}) {
  const [label, setLabel] = useState(component.label);
  const [amount, setAmount] = useState(component.amount_per_hour);
  const [currency, setCurrency] = useState(component.currency ?? "");
  const [notes, setNotes] = useState(component.notes ?? "");
  const [isActive, setIsActive] = useState(component.is_active);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          label,
          amount_per_hour: amount,
          currency,
          notes,
          is_active: isActive,
        });
      }}
      className="space-y-3 p-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Label htmlFor={`rc-edit-label-${component.uuid}`} className="text-xs">
            Label
          </Label>
          <Input
            id={`rc-edit-label-${component.uuid}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor={`rc-edit-amt-${component.uuid}`} className="text-xs">
            Amount / h
          </Label>
          <Input
            id={`rc-edit-amt-${component.uuid}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="mt-1 font-mono"
          />
        </div>
        <div>
          <Label htmlFor={`rc-edit-ccy-${component.uuid}`} className="text-xs">
            Currency
          </Label>
          <Input
            id={`rc-edit-ccy-${component.uuid}`}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            className="mt-1 font-mono uppercase"
          />
        </div>
      </div>
      <div>
        <Label htmlFor={`rc-edit-notes-${component.uuid}`} className="text-xs">
          Notes
        </Label>
        <Textarea
          id={`rc-edit-notes-${component.uuid}`}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        Active (contributes to hourly total)
      </label>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={pending}
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : null}
          Save changes
        </Button>
      </div>
    </form>
  );
}
