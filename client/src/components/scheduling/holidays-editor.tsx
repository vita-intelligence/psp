"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Holiday } from "@/lib/company/bags";
import { CalendarOff, Plus, Trash2 } from "lucide-react";

interface HolidaysEditorProps {
  /** Sorted, deduped holiday rows. */
  value: Holiday[];
  onChange: (next: Holiday[]) => void;
  disabled?: boolean;
}

/**
 * Controlled holiday list editor. Date + optional label per row, with
 * add/remove affordances. Caller is responsible for persisting under
 * the `{items: [...]}` wrapper if the storage layer uses one — this
 * component just talks raw arrays.
 */
export function HolidaysEditor({
  value,
  onChange,
  disabled = false,
}: HolidaysEditorProps) {
  function add() {
    onChange([...value, { date: "", label: "" }]);
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function update(index: number, patch: Partial<Holiday>) {
    onChange(
      value.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  return (
    <fieldset disabled={disabled} className="contents">
      <div className="space-y-3">
        {value.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-border/60 py-6 text-center">
            <CalendarOff className="size-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              No holiday overrides — add a date the warehouse is closed.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 rounded-md border border-border/60">
            <li className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>Date</span>
              <span>Label (optional)</span>
              <span className="sr-only">Actions</span>
            </li>
            {value.map((item, i) => (
              <li
                key={i}
                className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 px-3 py-1.5"
              >
                <Input
                  type="date"
                  value={item.date}
                  onChange={(e) => update(i, { date: e.target.value })}
                  className="h-9"
                  aria-label="Date"
                />
                <Input
                  type="text"
                  placeholder="e.g. Christmas Day"
                  value={item.label ?? ""}
                  onChange={(e) => update(i, { label: e.target.value })}
                  maxLength={120}
                  className="h-9"
                  aria-label="Label"
                />
                {!disabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(i)}
                    className="size-8 text-muted-foreground hover:text-destructive"
                    aria-label="Remove holiday"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!disabled && (
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus className="mr-1.5 size-3.5" />
            Add holiday
          </Button>
        )}
      </div>
    </fieldset>
  );
}

/** Normalise the JSONB bag → plain array. The company side stores
 *  `{items: [...]}`; older rows or warehouses with no override might
 *  pass `null` or a malformed map. */
export function holidaysFromBag(
  bag: { items?: unknown } | null | undefined,
): Holiday[] {
  const items = bag && Array.isArray((bag as { items?: unknown }).items)
    ? (bag as { items: unknown[] }).items
    : [];
  return items
    .filter(
      (i): i is Holiday =>
        typeof i === "object" &&
        i !== null &&
        typeof (i as Holiday).date === "string",
    )
    .map((i) => ({ date: i.date, label: i.label ?? "" }));
}

/** Inverse: form state → JSONB bag shape. Drops blank rows + sorts
 *  by date so audit diffs stay tidy. */
export function holidaysToBag(items: Holiday[]): { items: Holiday[] } {
  const cleaned = items
    .filter((i) => i.date.trim().length > 0)
    .map((i) => ({
      date: i.date,
      ...(i.label && i.label.trim().length > 0
        ? { label: i.label.trim() }
        : {}),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { items: cleaned };
}

/** "5 holidays" or "Easter Monday, Christmas Day" for short lists. */
export function summarizeHolidays(items: Holiday[]): string {
  if (items.length === 0) return "no holidays configured";
  if (items.length <= 2) {
    return items.map((h) => h.label || h.date).join(", ");
  }
  return `${items.length} holidays configured`;
}
