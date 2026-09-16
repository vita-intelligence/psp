"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner } from "@/components/forms/error-banner";
import { SearchPicker } from "@/components/forms/search-picker";
import { createEquipmentAction } from "@/lib/equipment/actions";
import type { EquipmentCategory } from "@/lib/equipment/types";
import {
  itemPickerFetcher,
  type ItemPickerOption,
} from "@/lib/items/picker-client";
import type { ErrorDebug } from "@/lib/errors/types";

interface WorkstationOption {
  id: number;
  uuid: string;
  name: string;
  workstation_group: { name: string } | null;
}

interface NewEquipmentFormProps {
  categories: EquipmentCategory[];
  workstations: WorkstationOption[];
}

export function NewEquipmentForm({
  categories,
  workstations,
}: NewEquipmentFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  const [item, setItem] = useState<ItemPickerOption | null>(null);
  const [categoryId, setCategoryId] = useState<string>("");
  const [workstationId, setWorkstationId] = useState<string>("");
  const [serialNumber, setSerialNumber] = useState<string>("");
  const [manufacturer, setManufacturer] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [manufacturerSerial, setManufacturerSerial] = useState<string>("");
  const [acquiredAt, setAcquiredAt] = useState<string>(
    // Default to today so a common case is one click.
    new Date().toISOString().slice(0, 10),
  );
  const [warrantyEndAt, setWarrantyEndAt] = useState<string>("");
  const [unitCost, setUnitCost] = useState<string>("");
  const [currency, setCurrency] = useState<string>("GBP");
  const [calibrationMonths, setCalibrationMonths] = useState<string>("");
  const [maintenanceMonths, setMaintenanceMonths] = useState<string>("");
  const [usefulLifeYears, setUsefulLifeYears] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // Stable identity per render — the picker uses it as an effect
  // dependency, so recreating the closure on every keystroke would
  // thrash the debounce timer.
  const fetchItems = useMemo(
    () => itemPickerFetcher({ itemType: "equipment", limit: 25 }),
    [],
  );

  const selectedCategory = categoryId
    ? categories.find((c) => String(c.id) === categoryId) ?? null
    : null;

  function handleCategoryChange(next: string) {
    setCategoryId(next);
    const picked =
      next === "" ? null : categories.find((c) => String(c.id) === next);
    if (!picked) return;

    // Only auto-fill the cadence + life fields the operator hasn't
    // already typed — the category is a starting-point, not an
    // override. Empty string means "operator hasn't touched it yet".
    if (
      !calibrationMonths &&
      picked.default_calibration_frequency_months != null
    ) {
      setCalibrationMonths(String(picked.default_calibration_frequency_months));
    }
    if (
      !maintenanceMonths &&
      picked.default_maintenance_frequency_months != null
    ) {
      setMaintenanceMonths(String(picked.default_maintenance_frequency_months));
    }
    if (!usefulLifeYears && picked.default_useful_life_years != null) {
      setUsefulLifeYears(String(picked.default_useful_life_years));
    }
  }

  const canSubmit = !!item && !!serialNumber.trim() && !pending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !item) return;
    setError(null);

    startTransition(async () => {
      const res = await createEquipmentAction({
        item_id: item.id,
        category_id: categoryId ? Number(categoryId) : null,
        workstation_id: workstationId ? Number(workstationId) : null,
        serial_number: serialNumber.trim(),
        manufacturer: manufacturer.trim() || null,
        model: model.trim() || null,
        manufacturer_serial: manufacturerSerial.trim() || null,
        // Send acquired_at as an ISO timestamp — the backend accepts
        // the yyyy-mm-dd string via Ecto's utc_datetime cast (rounds
        // to midnight UTC). Empty string → null so the backend seeds
        // from `now()`.
        acquired_at: acquiredAt
          ? new Date(`${acquiredAt}T00:00:00Z`).toISOString()
          : null,
        warranty_end_at: warrantyEndAt || null,
        unit_cost: unitCost.trim() || null,
        currency: currency.trim() || null,
        calibration_frequency_months: calibrationMonths
          ? Number(calibrationMonths)
          : null,
        maintenance_frequency_months: maintenanceMonths
          ? Number(maintenanceMonths)
          : null,
        useful_life_years: usefulLifeYears ? Number(usefulLifeYears) : null,
        notes: notes.trim() || null,
      });

      if (res.ok) {
        toast.success(`Created ${res.equipment.code ?? "equipment"}`);
        router.push(`/equipment/${res.equipment.uuid}`);
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-border/60 bg-card p-5 shadow-sm"
    >
      <FieldRow label="Item" required>
        <SearchPicker<ItemPickerOption>
          paginatedFetcher={fetchItems}
          value={item}
          onChange={setItem}
          placeholder="Search equipment SKUs — name, code, or SKU…"
          emptyHint="No equipment items match. Type to refine, or add one in Items."
          disabled={pending}
        />
      </FieldRow>

      <FieldRow label="Category">
        {categories.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No categories yet — leave blank, or add some at{" "}
            <span className="font-medium">
              Settings → Equipment categories
            </span>
            .
          </p>
        ) : (
          <>
            <Select value={categoryId} onValueChange={handleCategoryChange}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Group this equipment (optional)" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCategory && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Defaults from category: useful life{" "}
                {selectedCategory.default_useful_life_years
                  ? `${selectedCategory.default_useful_life_years} yr`
                  : "—"}
                {" · "}
                calibration{" "}
                {selectedCategory.default_calibration_frequency_months
                  ? `${selectedCategory.default_calibration_frequency_months} mo`
                  : "—"}
                {" · "}
                maintenance{" "}
                {selectedCategory.default_maintenance_frequency_months
                  ? `${selectedCategory.default_maintenance_frequency_months} mo`
                  : "—"}
                . You can still override any of them below.
              </p>
            )}
          </>
        )}
      </FieldRow>

      <FieldRow label="Workstation (attach to production line)">
        {workstations.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No workstations available. Attach later once one is created
            under Production → Workstations.
          </p>
        ) : (
          <>
            <Select
              value={workstationId === "" ? "__none__" : workstationId}
              onValueChange={(v) =>
                setWorkstationId(v === "__none__" ? "" : v)
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Not attached — track cost independently" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— None —</SelectItem>
                {workstations.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                    {w.workstation_group
                      ? ` · ${w.workstation_group.name}`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              When attached, this unit's hourly running cost feeds the
              workstation's cost roll-up on MO cost breakdowns.
            </p>
          </>
        )}
      </FieldRow>

      <FieldRow label="Serial number" required>
        <Input
          value={serialNumber}
          onChange={(e) => setSerialNumber(e.target.value)}
          placeholder="SN-2026-0042"
          className="font-mono"
        />
      </FieldRow>

      <div className="grid grid-cols-2 gap-4">
        <FieldRow label="Manufacturer">
          <Input
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
            placeholder="Kenwood"
          />
        </FieldRow>
        <FieldRow label="Model">
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="KM520"
          />
        </FieldRow>
      </div>

      <FieldRow label="Manufacturer serial (if different)">
        <Input
          value={manufacturerSerial}
          onChange={(e) => setManufacturerSerial(e.target.value)}
          placeholder="OEM SN"
          className="font-mono"
        />
      </FieldRow>

      <div className="grid grid-cols-2 gap-4">
        <FieldRow label="Received / acquired on" required>
          <Input
            type="date"
            value={acquiredAt}
            onChange={(e) => setAcquiredAt(e.target.value)}
            className="font-mono"
          />
        </FieldRow>
        <FieldRow label="Warranty ends">
          <Input
            type="date"
            value={warrantyEndAt}
            onChange={(e) => setWarrantyEndAt(e.target.value)}
            className="font-mono"
          />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FieldRow label="Unit cost">
          <Input
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            placeholder="0.00"
            className="font-mono"
            inputMode="decimal"
          />
        </FieldRow>
        <FieldRow label="Currency">
          <Input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            placeholder="GBP"
            maxLength={3}
            className="font-mono uppercase"
          />
        </FieldRow>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <FieldRow label="Calibration every (months)">
          <Input
            value={calibrationMonths}
            onChange={(e) => setCalibrationMonths(e.target.value)}
            placeholder="12"
            inputMode="numeric"
          />
        </FieldRow>
        <FieldRow label="Maintenance every (months)">
          <Input
            value={maintenanceMonths}
            onChange={(e) => setMaintenanceMonths(e.target.value)}
            placeholder="6"
            inputMode="numeric"
          />
        </FieldRow>
        <FieldRow label="Useful life (years)">
          <Input
            value={usefulLifeYears}
            onChange={(e) => setUsefulLifeYears(e.target.value)}
            placeholder="10"
            inputMode="numeric"
          />
        </FieldRow>
      </div>

      <FieldRow label="Notes">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything the next operator should know…"
          rows={2}
        />
      </FieldRow>

      {error && (
        <ErrorBanner
          detail={error.detail}
          code={error.code}
          debug={error.debug}
        />
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/equipment")}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {pending ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 size-4" />
          )}
          Create equipment
        </Button>
      </div>
    </form>
  );
}

function FieldRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}
