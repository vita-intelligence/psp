"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format as formatDateFns,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";

interface Props {
  /** ISO ``yyyy-mm-dd`` string, or null when the field is empty. */
  value: string | null;
  onChange: (iso: string | null) => void;
  id?: string;
  disabled?: boolean;
  /** Company format prefs for the trigger display — falls through to
   *  ``dd/MM/yyyy`` when omitted. */
  prefs?: FormatPrefs | null;
  placeholder?: string;
  className?: string;
  /** Allow clearing the value. Default false — most date fields on
   *  the mobile flow are required. */
  allowClear?: boolean;
  /** Optional min / max ISO dates to constrain the calendar. */
  min?: string;
  max?: string;
}

/**
 * Custom date picker — bottom-sheet calendar. Replaces native
 * ``<input type="date">`` because iOS Safari refuses to shrink its
 * intrinsic ``mm/dd/yyyy`` content width, which was pushing narrow
 * phones into horizontal scroll. Mirrors the shared ``CountryPicker``
 * pattern: trigger button + fullscreen sheet portalled to
 * ``document.body`` so it always escapes any wrapping label /
 * overflow-hidden ancestor.
 *
 * The trigger uses ``formatCompanyDate`` for display so the label
 * respects ``/settings/company``'s ``date_format`` — the ISO value
 * we round-trip is always ``yyyy-mm-dd`` so callers can send it
 * straight to the backend.
 */
export function DateField({
  value,
  onChange,
  id,
  disabled,
  prefs,
  placeholder = "Pick a date…",
  className,
  allowClear = false,
  min,
  max,
}: Props) {
  const [open, setOpen] = useState(false);

  const displayValue = value ? formatCompanyDate(value, prefs) : null;

  function handleSelect(iso: string | null) {
    onChange(iso);
    setOpen(false);
  }

  return (
    <>
      <Button
        id={id}
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "h-9 w-full justify-between font-normal",
          !displayValue && "text-muted-foreground",
          className,
        )}
      >
        <span className="flex items-center gap-2 truncate">
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{displayValue ?? placeholder}</span>
        </span>
      </Button>
      {open ? (
        <DateSheet
          value={value}
          onSelect={handleSelect}
          onClose={() => setOpen(false)}
          allowClear={allowClear}
          min={min}
          max={max}
          prefs={prefs}
        />
      ) : null}
    </>
  );
}

// --------------------------------------------------------------------
// Bottom sheet
// --------------------------------------------------------------------

interface SheetProps {
  value: string | null;
  onSelect: (iso: string | null) => void;
  onClose: () => void;
  allowClear: boolean;
  min?: string;
  max?: string;
  prefs?: FormatPrefs | null;
}

function DateSheet({
  value,
  onSelect,
  onClose,
  allowClear,
  min,
  max,
  prefs,
}: SheetProps) {
  const today = useMemo(() => stripTime(new Date()), []);
  const selectedDate = useMemo(() => parseIso(value) ?? today, [value, today]);
  const [cursor, setCursor] = useState<Date>(startOfMonth(selectedDate));

  const minDate = useMemo(() => (min ? parseIso(min) : null), [min]);
  const maxDate = useMemo(() => (max ? parseIso(max) : null), [max]);

  // Body scroll lock + Esc close. Same pattern as CountryPicker's
  // MobileCountrySheet — belt-and-braces on Android's hardware back
  // button which fires an Escape keydown in most browsers.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const days = buildMonthGrid(cursor);
  const tomorrow = addDays(today, 1);
  const monthLabel = formatDateFns(cursor, "MMMM yyyy");

  const canPickToday = withinBounds(today, minDate, maxDate);
  const canPickTomorrow = withinBounds(tomorrow, minDate, maxDate);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pick a date"
      className="fixed inset-0 z-50 flex flex-col bg-background"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Pick a date
          </p>
          <p className="truncate text-sm font-semibold">
            {value
              ? formatCompanyDate(value, prefs)
              : "No date selected"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close date picker"
          className="flex h-10 shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background px-3 text-sm font-medium text-foreground active:bg-muted"
        >
          <X className="size-4" />
          <span>Close</span>
        </button>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-border/40 px-4 py-3">
        <QuickChip
          disabled={!canPickToday}
          active={value === isoOf(today)}
          onClick={() => onSelect(isoOf(today))}
        >
          Today
        </QuickChip>
        <QuickChip
          disabled={!canPickTomorrow}
          active={value === isoOf(tomorrow)}
          onClick={() => onSelect(isoOf(tomorrow))}
        >
          Tomorrow
        </QuickChip>
        {allowClear && value ? (
          <QuickChip onClick={() => onSelect(null)}>Clear</QuickChip>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setCursor((c) => subMonths(c, 1))}
            aria-label="Previous month"
            className="flex size-10 items-center justify-center rounded-md border border-border/60 bg-background active:bg-muted"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <p className="text-base font-semibold" aria-live="polite">
            {monthLabel}
          </p>
          <button
            type="button"
            onClick={() => setCursor((c) => addMonths(c, 1))}
            aria-label="Next month"
            className="flex size-10 items-center justify-center rounded-md border border-border/60 bg-background active:bg-muted"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>

        <div className="mt-1 grid grid-cols-7 gap-1">
          {days.map((day) => {
            const iso = isoOf(day);
            const isCurrentMonth = isSameMonth(day, cursor);
            const isToday = isSameDay(day, today);
            const isSelected = value === iso;
            const outOfBounds = !withinBounds(day, minDate, maxDate);
            return (
              <button
                key={iso}
                type="button"
                disabled={outOfBounds}
                onClick={() => onSelect(iso)}
                aria-pressed={isSelected}
                aria-label={formatDateFns(day, "EEEE d MMMM yyyy")}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                  "active:bg-muted",
                  !isCurrentMonth && "text-muted-foreground/40",
                  isCurrentMonth && !isSelected && "text-foreground hover:bg-muted/60",
                  isToday && !isSelected && "ring-1 ring-brand/40",
                  isSelected && "bg-brand text-brand-foreground font-semibold",
                  outOfBounds && "cursor-not-allowed opacity-30",
                )}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      <footer className="border-t border-border/60 bg-background p-3">
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="w-full"
          onClick={onClose}
        >
          Done
        </Button>
      </footer>
    </div>,
    document.body,
  );
}

function QuickChip({
  children,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "border-brand bg-brand text-brand-foreground"
          : "border-border/60 bg-background text-foreground active:bg-muted",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {children}
    </button>
  );
}

// --------------------------------------------------------------------
// Date helpers — kept local so this component stays self-contained.
// --------------------------------------------------------------------

const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

/** Local-timezone Date → ``yyyy-mm-dd``. Using the ISO ``toISOString``
 *  would silently shift the day for anyone west of UTC. */
function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ``yyyy-mm-dd`` → local-noon Date. Parsing with ``new Date("yyyy-mm-dd")``
 *  yields midnight UTC, which becomes the previous day in west-of-UTC
 *  zones — anchor at noon so the local calendar day matches. */
function parseIso(iso: string | null): Date | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mm, d] = m;
  return new Date(Number(y), Number(mm) - 1, Number(d), 12, 0, 0);
}

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
}

function withinBounds(d: Date, min: Date | null, max: Date | null): boolean {
  if (min && d < stripTime(min)) return false;
  if (max && d > stripTime(max)) return false;
  return true;
}

function buildMonthGrid(cursor: Date): Date[] {
  // Whole weeks that touch this month — the grid always shows 5–6
  // rows so the layout doesn't jump between months.
  const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end });
}
