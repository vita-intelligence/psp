"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertOctagon,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Package,
  Plus,
  Trash2,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SearchPicker } from "@/components/forms/search-picker";
import {
  addRepairPartAction,
  completeRepairAction,
  removeRepairPartAction,
  reportRepairAction,
} from "@/lib/equipment/actions";
import type {
  EquipmentRepair,
  RepairStatus,
} from "@/lib/equipment/types";
import {
  itemPickerFetcher,
  type ItemPickerOption,
} from "@/lib/items/picker-client";
import type { CompanyDefaults } from "@/lib/types";
import { formatCompanyDate } from "@/lib/format/company";

const STATUS_CHIP: Record<RepairStatus, { label: string; className: string }> = {
  reported: {
    label: "Reported",
    className: "bg-amber-100 text-amber-800",
  },
  in_progress: {
    label: "In progress",
    className: "bg-blue-100 text-blue-800",
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-100 text-emerald-800",
  },
  canceled: {
    label: "Canceled",
    className: "bg-muted text-muted-foreground",
  },
};

interface Props {
  equipmentUuid: string;
  repairs: EquipmentRepair[];
  canEdit: boolean;
  prefs: CompanyDefaults;
}

/**
 * Reactive-breakdown / repair record card. Report → in-progress →
 * complete. Downtime is auto-computed from failure_date →
 * completion_date on complete. Each repair expands to show its
 * spare-parts sub-list with an inline add-part form (item picker +
 * qty + unit cost + currency + notes) and remove-part button.
 */
export function EquipmentRepairsCard({
  equipmentUuid,
  repairs,
  canEdit,
  prefs,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [expandedUuid, setExpandedUuid] = useState<string | null>(null);
  // Repair currently open in the "Complete repair" dialog.
  const [completingRepair, setCompletingRepair] =
    useState<EquipmentRepair | null>(null);

  // Stable identity so SearchPicker's debounce isn't reset on each
  // render. Parts are drawn from the stockable items — the same set
  // that would be booked to an MO, plus equipment items in case a
  // whole sub-unit is swapped in.
  const fetchParts = useMemo(
    () =>
      itemPickerFetcher({
        itemType: [
          "consumable",
          "packaging",
          "raw_material",
          "semi_finished",
          "equipment",
        ],
        limit: 25,
      }),
    [],
  );
  const [form, setForm] = useState<{
    failure_date: string;
    description: string;
    external_vendor_name: string;
  }>({
    failure_date: new Date().toISOString().slice(0, 16),
    description: "",
    external_vendor_name: "",
  });

  function resetForm() {
    setForm({
      failure_date: new Date().toISOString().slice(0, 16),
      description: "",
      external_vendor_name: "",
    });
    setShowForm(false);
  }

  function onReport(e: React.FormEvent) {
    e.preventDefault();
    if (!form.failure_date) {
      toast.error("Failure date is required");
      return;
    }
    startTransition(async () => {
      const iso = new Date(form.failure_date).toISOString();
      const res = await reportRepairAction(equipmentUuid, {
        failure_date: iso,
        description: form.description || null,
        external_vendor_name: form.external_vendor_name || null,
      });
      if (res.ok) {
        toast.success("Breakdown reported — timeline updated");
        resetForm();
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  function onConfirmComplete(input: {
    repair: EquipmentRepair;
    completion_date: string;
    actions_performed: string;
    repair_cost: string | null;
    currency: string | null;
  }) {
    const { repair, completion_date, actions_performed, repair_cost, currency } =
      input;
    startTransition(async () => {
      const res = await completeRepairAction(equipmentUuid, repair.uuid, {
        completion_date,
        actions_performed: actions_performed || "Repair completed",
        repair_cost,
        currency,
      });
      if (res.ok) {
        toast.success("Repair closed");
        setCompletingRepair(null);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  function onAddPart(
    repairUuid: string,
    input: {
      item_id: number;
      quantity: string;
      unit_cost: string;
      currency: string;
      notes: string;
    },
  ) {
    if (!input.item_id) {
      toast.error("Pick an item");
      return;
    }
    if (!input.quantity || Number(input.quantity) <= 0) {
      toast.error("Quantity must be greater than 0");
      return;
    }
    startTransition(async () => {
      const res = await addRepairPartAction(equipmentUuid, repairUuid, {
        item_id: input.item_id,
        quantity: input.quantity,
        unit_cost: input.unit_cost.trim() || null,
        currency: input.currency.trim() || null,
        notes: input.notes.trim() || null,
      });
      if (res.ok) {
        toast.success("Part added to repair");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  function onRemovePart(repairUuid: string, partUuid: string, label: string) {
    if (!confirm(`Remove "${label}" from this repair?`)) return;
    startTransition(async () => {
      const res = await removeRepairPartAction(
        equipmentUuid,
        repairUuid,
        partUuid,
      );
      if (res.ok) {
        toast.success("Part removed");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  const openCount = repairs.filter(
    (r) => r.status === "reported" || r.status === "in_progress",
  ).length;

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              Repair history
              <span className="text-[11px] font-normal text-muted-foreground">
                · {repairs.length} total
                {openCount > 0 ? ` · ${openCount} open` : ""}
              </span>
            </CardTitle>
            <CardDescription>
              Reactive breakdowns and how they were fixed. Downtime is
              computed from failure-time to completion; parts consumed
              on a repair roll up into its cost total.
            </CardDescription>
          </div>
          {canEdit ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowForm((s) => !s)}
              disabled={pending}
              type="button"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Report breakdown
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">

      {showForm && canEdit ? (
        <form
          onSubmit={onReport}
          className="mb-4 space-y-3 rounded-md border border-red-200 bg-red-50/40 p-3"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-red-800">
            <AlertOctagon className="h-3.5 w-3.5" />
            Report a breakdown — the asset stays in service until you mark it
            out for repair via the lifecycle actions.
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="failure_date" className="text-xs">
                Failure detected at
              </Label>
              <Input
                id="failure_date"
                type="datetime-local"
                value={form.failure_date}
                onChange={(e) => setForm({ ...form, failure_date: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="external_vendor_name" className="text-xs">
                External vendor (optional)
              </Label>
              <Input
                id="external_vendor_name"
                value={form.external_vendor_name}
                onChange={(e) =>
                  setForm({ ...form, external_vendor_name: e.target.value })
                }
                placeholder="e.g. Kern Service"
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="description" className="text-xs">
              Symptom / description
            </Label>
            <Textarea
              id="description"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What went wrong?"
              className="mt-1"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetForm}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Report breakdown
            </Button>
          </div>
        </form>
      ) : null}

      {repairs.length === 0 ? (
        <p className="rounded-md bg-muted/40 p-4 text-center text-sm text-muted-foreground">
          No repairs on record.
        </p>
      ) : (
        <ul className="space-y-2">
          {repairs.map((r) => {
            const partCount = r.parts?.length ?? 0;
            const expanded = expandedUuid === r.uuid;
            return (
              <li
                key={r.uuid}
                className="rounded-md border border-border/60 bg-background p-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedUuid((prev) => (prev === r.uuid ? null : r.uuid))
                    }
                    className="inline-flex items-center gap-1 rounded p-0.5 text-muted-foreground hover:bg-muted"
                    title={expanded ? "Collapse" : "Expand"}
                  >
                    {expanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CHIP[r.status].className}`}
                  >
                    {STATUS_CHIP[r.status].label}
                  </span>
                  <span className="font-medium">
                    {formatCompanyDate(r.failure_date, prefs)}
                  </span>
                  {r.external_vendor_name ? (
                    <span className="text-[11px] text-muted-foreground">
                      · {r.external_vendor_name}
                    </span>
                  ) : null}
                  {r.downtime_minutes != null ? (
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDowntime(r.downtime_minutes)}
                    </span>
                  ) : null}
                  {r.repair_cost ? (
                    <span className="text-[11px] text-muted-foreground">
                      · {r.repair_cost} {r.currency ?? ""}
                    </span>
                  ) : null}
                  {partCount > 0 ? (
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                      <Package className="h-3 w-3" />
                      {partCount} part{partCount === 1 ? "" : "s"}
                      {r.parts_total ? ` · ${r.parts_total}` : ""}
                    </span>
                  ) : null}
                  {canEdit &&
                  (r.status === "reported" || r.status === "in_progress") ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      onClick={() => setCompletingRepair(r)}
                      disabled={pending}
                    >
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                      Complete
                    </Button>
                  ) : null}
                </div>
                {r.description ? (
                  <p className="mt-1.5 text-[13px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Reported:{" "}
                    </span>
                    {r.description}
                  </p>
                ) : null}
                {r.actions_performed ? (
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Actions:{" "}
                    </span>
                    {r.actions_performed}
                  </p>
                ) : null}
                {expanded ? (
                  <div className="mt-3 rounded-md border border-border/40 bg-muted/20 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Package className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-semibold">Parts</span>
                      {partCount === 0 ? (
                        <span className="text-[11px] text-muted-foreground">
                          None yet
                        </span>
                      ) : null}
                    </div>
                    {partCount > 0 ? (
                      <ul className="space-y-1.5">
                        {r.parts!.map((p) => {
                          const label = p.item?.name ?? "?";
                          return (
                            <li
                              key={p.uuid}
                              className="flex items-center gap-3 rounded border border-border/40 bg-background px-2 py-1.5 text-[13px]"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                <span className="font-medium">{label}</span>
                                {p.item?.external_sku ? (
                                  <span className="ml-1 text-[11px] text-muted-foreground">
                                    · {p.item.external_sku}
                                  </span>
                                ) : null}
                              </span>
                              <span className="tabular-nums text-muted-foreground">
                                × {p.quantity}
                              </span>
                              {p.unit_cost ? (
                                <span className="tabular-nums text-muted-foreground">
                                  @ {p.unit_cost} {p.currency ?? ""}
                                </span>
                              ) : null}
                              {p.line_total ? (
                                <span className="tabular-nums font-medium">
                                  = {p.line_total} {p.currency ?? ""}
                                </span>
                              ) : null}
                              {canEdit ? (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() =>
                                    onRemovePart(r.uuid, p.uuid, label)
                                  }
                                  disabled={pending}
                                  title="Remove part"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                    {canEdit ? (
                      <AddPartForm
                        repairUuid={r.uuid}
                        fetchParts={fetchParts}
                        pending={pending}
                        onSubmit={(input) => onAddPart(r.uuid, input)}
                        defaultCurrency={r.currency ?? ""}
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <CompleteRepairDialog
        repair={completingRepair}
        pending={pending}
        prefs={prefs}
        defaultCurrency={
          completingRepair?.currency ?? prefs.currency_code
        }
        onCancel={() => setCompletingRepair(null)}
        onConfirm={onConfirmComplete}
      />
      </CardContent>
    </Card>
  );
}

/**
 * Complete-repair dialog — replaces the old `window.prompt` so the
 * operator can review + tweak completion date, actions performed,
 * repair cost, and currency in one place. Backend auto-fills
 * repair_cost from parts SUM if left blank; leaving it explicitly
 * empty is fine.
 */
function CompleteRepairDialog({
  repair,
  pending,
  prefs,
  defaultCurrency,
  onCancel,
  onConfirm,
}: {
  repair: EquipmentRepair | null;
  pending: boolean;
  prefs: CompanyDefaults;
  defaultCurrency: string;
  onCancel: () => void;
  onConfirm: (input: {
    repair: EquipmentRepair;
    completion_date: string;
    actions_performed: string;
    repair_cost: string | null;
    currency: string | null;
  }) => void;
}) {
  const [completedAt, setCompletedAt] = useState("");
  const [actions, setActions] = useState("");
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency || "GBP");

  useEffect(() => {
    if (repair) {
      // datetime-local wants YYYY-MM-DDTHH:MM — trim any seconds off.
      setCompletedAt(new Date().toISOString().slice(0, 16));
      setActions(repair.actions_performed ?? "");
      setCost(repair.repair_cost ?? "");
      setCurrency(repair.currency ?? defaultCurrency ?? "GBP");
    }
  }, [repair?.uuid, defaultCurrency]);

  if (!repair) return null;

  const partsTotalHint =
    repair.parts && repair.parts.length > 0 && repair.parts_total
      ? `Parts total on record: ${repair.parts_total} ${repair.currency ?? currency}. Leave cost blank to accept that as the total.`
      : null;

  return (
    <Dialog
      open={!!repair}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Close repair · {formatCompanyDate(repair.failure_date, prefs)}
          </DialogTitle>
          <DialogDescription>
            {repair.description
              ? `Reported: ${repair.description}`
              : "No breakdown description on record."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="repair-completed-at" className="text-xs">
              Completed at
            </Label>
            <Input
              id="repair-completed-at"
              type="datetime-local"
              value={completedAt}
              onChange={(e) => setCompletedAt(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="repair-actions" className="text-xs">
              Actions performed
            </Label>
            <Textarea
              id="repair-actions"
              rows={3}
              value={actions}
              onChange={(e) => setActions(e.target.value)}
              placeholder="e.g. Replaced worn drive belt and lubricated bearings."
              className="mt-1"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-3">
              <Label htmlFor="repair-cost" className="text-xs">
                Repair cost (optional)
              </Label>
              <Input
                id="repair-cost"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="repair-currency" className="text-xs">
                Currency
              </Label>
              <Input
                id="repair-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                className="mt-1 font-mono uppercase"
              />
            </div>
          </div>
          {partsTotalHint ? (
            <p className="text-[11px] text-muted-foreground">
              {partsTotalHint}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              const iso = completedAt
                ? new Date(completedAt).toISOString()
                : new Date().toISOString();
              onConfirm({
                repair,
                completion_date: iso,
                actions_performed: actions.trim(),
                repair_cost: cost.trim() || null,
                currency: currency.trim() ? currency.trim() : null,
              });
            }}
            disabled={pending || !completedAt}
          >
            {pending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            )}
            Close repair
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddPartForm({
  repairUuid,
  fetchParts,
  pending,
  onSubmit,
  defaultCurrency,
}: {
  repairUuid: string;
  fetchParts: (
    q: string,
    cursor: string | null,
    signal?: AbortSignal,
  ) => Promise<import("@/components/forms/search-picker").SearchPickerPage<ItemPickerOption>>;
  pending: boolean;
  onSubmit: (input: {
    item_id: number;
    quantity: string;
    unit_cost: string;
    currency: string;
    notes: string;
  }) => void;
  defaultCurrency: string;
}) {
  const [item, setItem] = useState<ItemPickerOption | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency || "GBP");
  const [notes, setNotes] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!item) return;
        onSubmit({
          item_id: item.id,
          quantity,
          unit_cost: unitCost,
          currency,
          notes,
        });
        // Reset qty/cost/notes — keep the picker's current item so a
        // repeat-add of the same spare is a one-click affair.
        setQuantity("1");
        setUnitCost("");
        setNotes("");
      }}
      className="mt-3 rounded-md border border-dashed border-border/60 bg-background p-3"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Plus className="h-3.5 w-3.5" />
        Add a part used in this repair
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
        <div className="sm:col-span-3">
          <Label htmlFor={`part_item_${repairUuid}`} className="text-xs">
            Item
          </Label>
          <div className="mt-1">
            <SearchPicker<ItemPickerOption>
              id={`part_item_${repairUuid}`}
              paginatedFetcher={fetchParts}
              value={item}
              onChange={setItem}
              placeholder="Search spare / consumable…"
              emptyHint="No matching stockable items."
              disabled={pending}
              compact
            />
          </div>
        </div>
        <div>
          <Label htmlFor={`part_qty_${repairUuid}`} className="text-xs">
            Qty
          </Label>
          <Input
            id={`part_qty_${repairUuid}`}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 font-mono"
            inputMode="decimal"
          />
        </div>
        <div>
          <Label htmlFor={`part_cost_${repairUuid}`} className="text-xs">
            Unit cost
          </Label>
          <Input
            id={`part_cost_${repairUuid}`}
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            className="mt-1 font-mono"
            inputMode="decimal"
            placeholder="optional"
          />
        </div>
        <div>
          <Label htmlFor={`part_ccy_${repairUuid}`} className="text-xs">
            Currency
          </Label>
          <Input
            id={`part_ccy_${repairUuid}`}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            className="mt-1 font-mono uppercase"
            maxLength={3}
          />
        </div>
      </div>
      <div className="mt-2">
        <Label htmlFor={`part_notes_${repairUuid}`} className="text-xs">
          Notes (optional)
        </Label>
        <Input
          id={`part_notes_${repairUuid}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1"
        />
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={pending || !item || !quantity}
        >
          {pending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="mr-1 h-3.5 w-3.5" />
          )}
          Add part
        </Button>
      </div>
    </form>
  );
}

function formatDowntime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}
