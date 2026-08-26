"use client";

/**
 * Millimetre-typed numeric input with a per-field mm/cm toggle.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every lot packaging dim (length / width / height) is stored on the
 * server in millimetres — matches vendor pack labels, GS1 barcode
 * payloads, and the BRCGS / FSSC packaging documentation the industry
 * runs on. But the operator's ruler / tape measure isn't always in
 * mm — on the floor, cm is often what's marked. Forcing them to
 * translate "30 cm = 300 mm" mid-flow is friction that leads to typos
 * (typing 30 into an mm field, then wondering why cell-fit says the
 * tote is thumb-sized).
 *
 * The toggle solves it: value is always mm under the hood (`value`
 * prop + `onChange` callback both mm), but the display + input UI
 * flips between mm and cm when the operator taps the small unit
 * badge. Zero DB or payload change; strictly a display layer.
 *
 * USAGE
 * -----
 *   const [lengthMm, setLengthMm] = useState("");   // stored in mm
 *   <DimensionMmInput
 *     label="Length"
 *     value={lengthMm}
 *     onChange={setLengthMm}
 *   />
 *
 * The `value` you get back is always the mm string, ready to submit
 * to the BE. The toggle only affects rendering.
 */

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import type { CollabPeer } from "@/lib/realtime/use-live-form";
import { cn } from "@/lib/utils";

type Unit = "mm" | "cm";

interface Props {
  /** Field label, e.g. "Length". The unit suffix is rendered by the
   *  component; do NOT include it in the label yourself. */
  label: string;
  /** Current value in MILLIMETRES (as a string). Empty string = the
   *  field hasn't been filled yet. */
  value: string;
  /** Fires with the new value in MILLIMETRES (as a string). Callers
   *  don't need to worry about unit conversion. */
  onChange: (mm: string) => void;
  /** Optional inline placeholder shown in the display unit's scale. */
  placeholder?: string;
  /** Optional id — helpful when a caller wants to `<Label htmlFor>`
   *  externally. Auto-derived from the label otherwise. */
  id?: string;
  className?: string;
  /** Collab hook — the STABLE field key (e.g. "package_length_mm").
   *  Passed to `focusField` / `blurField` so peers see the presence
   *  indicator light up on the right row. Same key across mm and cm
   *  because the underlying stored field doesn't change. */
  collabKey?: string;
  focusField?: (key: string) => void;
  blurField?: (key: string) => void;
  editor?: CollabPeer | null;
  /** Field-level validation error — rendered as a small red note
   *  under the input. Same convention as `<FieldError>` elsewhere. */
  error?: string;
}

/** Auto-detect the friendlier display unit for a given mm value. A
 *  bare 300 reads better as "300 mm" but a 5000 reads better as
 *  "500 cm" (mm makes the field feel like it's storing an odometer
 *  reading). Only applies on initial mount — the operator can flip
 *  the toggle any time and we respect their choice. */
function pickInitialUnit(value: string): Unit {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "mm";
  // Threshold picked to keep pack-scale dims in mm (matching pack
  // labels) but flip to cm when the value is clearly room-scale. 100
  // mm (10 cm) is a good cut-off — smaller than that reads better in
  // mm, bigger in cm.
  return n >= 100 ? "cm" : "mm";
}

function mmToDisplay(mmValue: string, unit: Unit): string {
  if (mmValue === "") return "";
  if (unit === "mm") return mmValue;
  const n = Number(mmValue);
  if (!Number.isFinite(n)) return mmValue;
  // Trim trailing zero on the decimal so 300 mm → "30" not "30.0".
  const cm = n / 10;
  const s = cm.toFixed(2);
  return s.replace(/\.?0+$/, "") || "0";
}

function displayToMm(displayValue: string, unit: Unit): string {
  if (displayValue.trim() === "") return "";
  if (unit === "mm") return displayValue.trim();
  const n = Number(displayValue.replace(",", "."));
  if (!Number.isFinite(n)) return displayValue;
  const mm = n * 10;
  // Preserve integer-ness when the cm value is a clean whole number
  // — "30 cm" → "300" (not "300.00") for tidier storage.
  return Number.isInteger(mm) ? String(mm) : String(mm);
}

export function DimensionMmInput({
  label,
  value,
  onChange,
  placeholder,
  id,
  className,
  collabKey,
  focusField,
  blurField,
  editor,
  error,
}: Props) {
  const [unit, setUnit] = useState<Unit>(() => pickInitialUnit(value));

  const displayValue = useMemo(() => mmToDisplay(value, unit), [value, unit]);
  const inputId =
    id ??
    `dim-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div className={cn("space-y-0.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label
          htmlFor={inputId}
          className="text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          {label}
        </Label>
        <button
          type="button"
          onClick={() => setUnit((u) => (u === "mm" ? "cm" : "mm"))}
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase text-muted-foreground hover:text-foreground"
          aria-label={`Toggle unit — currently ${unit}, tap for ${unit === "mm" ? "cm" : "mm"}`}
          title={`Currently ${unit} — tap to switch to ${unit === "mm" ? "cm" : "mm"}`}
        >
          {unit}
          <span aria-hidden className="text-muted-foreground/50">
            ⇄
          </span>
        </button>
      </div>
      <div className="relative">
        <Input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={displayValue}
          onChange={(e) => onChange(displayToMm(e.target.value, unit))}
          onFocus={collabKey && focusField ? () => focusField(collabKey) : undefined}
          onBlur={collabKey && blurField ? () => blurField(collabKey) : undefined}
          placeholder={placeholder}
          className={cn(
            "h-10 font-mono text-sm",
            error && "border-destructive focus-visible:ring-destructive/20",
          )}
          aria-invalid={Boolean(error)}
        />
        {editor && <FieldEditingIndicator peer={editor} />}
      </div>
      {error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}
    </div>
  );
}
