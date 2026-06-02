"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  type DayHours,
  type Weekday,
  type WorkingHours,
} from "@/lib/company/bags";

const EMPTY_DAY: DayHours = { opens_at: null, closes_at: null };

interface WorkingHoursEditorProps {
  /** Raw bag — the same shape stored on the entity's JSONB column. */
  value: WorkingHours | null | undefined;
  onChange: (next: WorkingHours) => void;
  disabled?: boolean;
  /** Optional id prefix for the time inputs so multiple editors on
   *  the same page don't collide. Defaults to `wh`. */
  idPrefix?: string;
}

/**
 * Controlled weekday-grid time picker. One row per day with `time`
 * inputs for opens/closes. Empty days are persisted as `null` so the
 * downstream scheduler can tell "closed" from "not configured".
 *
 * Pure presentational — caller owns the state, this component just
 * renders + forwards changes. Used by both the company settings page
 * (Company-wide hours) and the warehouse override card.
 */
export function WorkingHoursEditor({
  value,
  onChange,
  disabled = false,
  idPrefix = "wh",
}: WorkingHoursEditorProps) {
  const normalized = normalize(value);

  function updateDay(day: Weekday, field: keyof DayHours, raw: string) {
    const next: WorkingHours = { ...normalized };
    const current = next[day] ?? { ...EMPTY_DAY };
    next[day] = { ...current, [field]: raw || null };
    onChange(next);
  }

  return (
    <fieldset disabled={disabled} className="contents">
      <div className="space-y-2">
        {WEEKDAYS.map((day) => {
          const opens = normalized[day]?.opens_at ?? "";
          const closes = normalized[day]?.closes_at ?? "";
          return (
            <div
              key={day}
              className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4"
            >
              <Label
                htmlFor={`${idPrefix}-${day}-opens`}
                className="text-xs font-medium text-muted-foreground sm:text-sm sm:text-foreground"
              >
                {WEEKDAY_LABELS[day]}
              </Label>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <Input
                  id={`${idPrefix}-${day}-opens`}
                  type="time"
                  value={opens}
                  onChange={(e) => updateDay(day, "opens_at", e.target.value)}
                  className="h-9 max-w-[110px]"
                  aria-label={`${WEEKDAY_LABELS[day]} opens at`}
                />
                <span aria-hidden className="text-muted-foreground">
                  –
                </span>
                <Input
                  type="time"
                  value={closes}
                  onChange={(e) => updateDay(day, "closes_at", e.target.value)}
                  className="h-9 max-w-[110px]"
                  aria-label={`${WEEKDAY_LABELS[day]} closes at`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Build a one-line summary of the configured days. Used as the
 *  inherit-preview banner. */
export function summarizeWorkingHours(value: WorkingHours | null | undefined): string {
  const norm = normalize(value);
  const openDays = WEEKDAYS.filter((d) => {
    const v = norm[d];
    return v?.opens_at && v?.closes_at;
  });
  if (openDays.length === 0) return "closed every day";
  if (openDays.length === 7) return "open every day";
  return openDays.map((d) => WEEKDAY_LABELS[d].slice(0, 3)).join(", ");
}

function normalize(input: WorkingHours | null | undefined): WorkingHours {
  const safe = (input ?? {}) as Record<string, unknown>;
  return WEEKDAYS.reduce((acc, day) => {
    const v = safe[day];
    if (v && typeof v === "object") {
      const entry = v as Partial<DayHours>;
      acc[day] = {
        opens_at: entry.opens_at ?? null,
        closes_at: entry.closes_at ?? null,
      };
    } else {
      acc[day] = null;
    }
    return acc;
  }, {} as WorkingHours);
}
