"use client";

import { useEffect, useState, useTransition } from "react";
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
import { createEquipmentAction } from "@/lib/equipment/actions";
import type { ErrorDebug } from "@/lib/errors/types";

interface EquipmentItemOption {
  id: number;
  code: string | null;
  name: string;
}

export function NewEquipmentForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  const [items, setItems] = useState<EquipmentItemOption[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);

  const [itemId, setItemId] = useState<string>("");
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

  // Lazy-load only equipment-type items into the picker so the
  // dropdown doesn't drown in raw materials.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          "/api/items?picker=true&limit=200&item_type=equipment",
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          items: Array<{ id: number; code: string | null; name: string }>;
        };
        if (!cancelled) {
          setItems(
            body.items.map((i) => ({
              id: i.id,
              code: i.code,
              name: i.name,
            })),
          );
        }
      } finally {
        if (!cancelled) setItemsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const canSubmit =
    !!itemId && !!serialNumber.trim() && !pending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);

    startTransition(async () => {
      const res = await createEquipmentAction({
        item_id: Number(itemId),
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
        {itemsLoading ? (
          <p className="text-xs text-muted-foreground">Loading items…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-destructive">
            No items with type = Equipment yet. Create one first at
            Settings → Items.
          </p>
        ) : (
          <Select value={itemId} onValueChange={setItemId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Pick the equipment SKU" />
            </SelectTrigger>
            <SelectContent>
              {items.map((i) => (
                <SelectItem key={i.id} value={String(i.id)}>
                  {i.name}
                  {i.code ? ` · ${i.code}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
