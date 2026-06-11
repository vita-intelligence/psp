"use client";

import { useEffect } from "react";
import { Calculator, PencilLine } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * Derived-date field with an explicit "override" toggle. Default state:
 * read-only, value computed from source inputs. Toggle on → free
 * date input. Toggle off → snap back to the computed value.
 *
 * Use for fields that are deterministic functions of other fields:
 *   - vendor.next_review_at = last_review_at + review_frequency_months
 *   - cert.valid_until = valid_from + default_validity_months
 *   - po.expected_delivery_date = today + vendor.default_lead_time_days
 *
 * Compliance rule (psp/CLAUDE.md point 2): "if it can be computed, don't
 * ask". The override toggle is the legitimate escape valve when a one-off
 * deviation is needed; it logs intent vs. blindly accepting a typed value.
 */

interface Props {
  /** Computed value the field defaults to. Pass empty string when
   *  source inputs are missing — the override toggle gets forced on. */
  computed: string;
  /** Current persisted value (typed or auto). */
  value: string;
  /** Persist a new value. Call with computed value when toggling off. */
  onChange: (next: string) => void;
  id?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Short hint shown next to the read-only display, e.g. "Last review + 12mo". */
  derivationHint: string;
  /** When computed is empty (source inputs missing), force the input
   *  into manual mode and explain why. */
  reasonComputedMissing?: string;
}

export function DerivedDateField({
  computed,
  value,
  onChange,
  id,
  onFocus,
  onBlur,
  derivationHint,
  reasonComputedMissing,
}: Props) {
  const computedAvailable = Boolean(computed);
  const override = !computedAvailable || (value !== computed && value !== "");

  // When source inputs change and override is OFF, keep `value` synced to
  // computed. Otherwise the persisted value drifts away from the
  // "auto-calculated" promise.
  useEffect(() => {
    if (!override && computed && value !== computed) {
      onChange(computed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computed, override]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {override ? (
            <>
              <PencilLine className="size-3" />
              Manually set
            </>
          ) : (
            <>
              <Calculator className="size-3" />
              Auto: {derivationHint}
            </>
          )}
        </span>
        {computedAvailable && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground">
            <span>Override</span>
            <Switch
              checked={override}
              onCheckedChange={(next) => {
                if (next) {
                  // Toggle on: leave the current value editable.
                  return;
                }
                // Toggle off: snap back to the computed value.
                onChange(computed);
              }}
            />
          </label>
        )}
      </div>
      {override ? (
        <Input
          id={id}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      ) : (
        <div
          id={id}
          className={cn(
            "flex h-9 items-center rounded-md border border-border/60 bg-muted/30 px-3 text-sm text-muted-foreground",
          )}
          onFocus={onFocus}
          onBlur={onBlur}
        >
          {computed || (
            <span className="italic text-muted-foreground/70">
              {reasonComputedMissing ?? "Fill in source fields above."}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Add `monthsToAdd` calendar months to an ISO `YYYY-MM-DD` date. Returns
 * an ISO date string or empty when inputs are missing. Handles month-end
 * rollover correctly (Jan 31 + 1 month → Feb 28/29, not Mar 3).
 */
export function addMonths(
  isoDate: string | null | undefined,
  monthsToAdd: number | null | undefined,
): string {
  if (!isoDate || !monthsToAdd || Number.isNaN(monthsToAdd)) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  const date = new Date(Date.UTC(y, m - 1, d));
  const originalDay = date.getUTCDate();
  date.setUTCMonth(date.getUTCMonth() + monthsToAdd);
  // If the day rolled over (e.g. Jan 31 → Mar 3), pull it back to the
  // last day of the target month.
  if (date.getUTCDate() !== originalDay) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

/**
 * Add `daysToAdd` calendar days to a JS Date or "today". Returns
 * `YYYY-MM-DD` for use as an Input value.
 */
export function addDaysFromToday(daysToAdd: number | null | undefined): string {
  if (!daysToAdd || Number.isNaN(daysToAdd)) return "";
  const today = new Date();
  today.setUTCDate(today.getUTCDate() + daysToAdd);
  return today.toISOString().slice(0, 10);
}
