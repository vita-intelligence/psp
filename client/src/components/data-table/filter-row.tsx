"use client";

// Persistent filter row that renders under the header row of the
// desktop table. One cell per column; each cell shows a compact input
// keyed to the column's `filterKind`. Always visible, matches the
// MRPEasy / Airtable "every column has a search box" convention.
//
// Commit UX matches the toolbar's ``FiltersMenu`` (toolbar.tsx L390+)
// exactly: a local draft state, plus a footer row with ``[Reset]
// [Apply]`` — Apply disabled until the drafts differ from what the
// server is filtered by. Text cells also apply on Enter. No debounce
// — the parent DataTable docstring explicitly rules out per-keystroke
// refetches (data-table.tsx L54: "Search + filters never fire on
// every keystroke. They commit on Enter / explicit Apply only").
//
// Range / date / select / boolean inputs also stage drafts and only
// commit through the row-level Apply — one shared button = one click
// = one refetch, regardless of how many columns the user has staged.

import { useCallback, useEffect, useMemo, useState } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDown, RotateCcw, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ColumnFilterValue, DataTableColumn } from "./types";

interface Props<T> {
  columns: DataTableColumn<T>[];
  values: Record<string, ColumnFilterValue>;
  onChange: (field: string, value: ColumnFilterValue | null) => void;
}

// Draft map — one entry per field the user has staged a change for.
// A `null` slot means "clear this field on Apply"; a value means
// "replace the applied value with this on Apply". Missing key means
// no draft for that field (input shows the applied value).
type Drafts = Record<string, ColumnFilterValue | null>;

export function FilterRow<T>({ columns, values, onChange }: Props<T>) {
  const [drafts, setDrafts] = useState<Drafts>({});

  // Whenever the applied `values` catch up with a draft (round-trip
  // completed), drop that draft so the dirty ring / Apply button
  // reset without the user seeing a phantom "still unapplied" state.
  useEffect(() => {
    setDrafts((prev) => {
      let changed = false;
      const next: Drafts = {};
      for (const [k, draft] of Object.entries(prev)) {
        const applied = values[k] ?? null;
        if (equalFilterValue(draft, applied)) {
          changed = true; // drop key
        } else {
          next[k] = draft;
        }
      }
      return changed ? next : prev;
    });
  }, [values]);

  const setDraft = useCallback(
    (field: string, next: ColumnFilterValue | null) => {
      setDrafts((prev) => ({ ...prev, [field]: next }));
    },
    [],
  );

  const dirtyKeys = useMemo(() => Object.keys(drafts), [drafts]);
  const isDirty = dirtyKeys.length > 0;
  const hasApplied = Object.values(values).some((v) => v != null);

  const apply = useCallback(() => {
    // Read the current draft map, THEN fire parent updates. Doing
    // this in a plain function (not inside a setState updater) is
    // what avoids the "setState during render" warning — commit
    // fan-out happens synchronously against a stable snapshot.
    const snapshot = drafts;
    for (const [field, next] of Object.entries(snapshot)) {
      onChange(field, next);
    }
    setDrafts({});
  }, [drafts, onChange]);

  const reset = useCallback(() => {
    // Clear every currently-applied filter across the row. Matches
    // the FiltersMenu Reset copy — one click, everything back to
    // "no filters". Drafts also cleared so the input reverts.
    for (const field of Object.keys(values)) {
      onChange(field, null);
    }
    setDrafts({});
  }, [values, onChange]);

  const filterableColumnCount = columns.filter(
    (c) => c.filterKind && c.filterField,
  ).length;

  return (
    <>
      <TableRow className="border-b border-border/60 bg-muted/30 hover:bg-muted/30">
        {columns.map((col) => (
          <TableCell
            key={col.id}
            className={cn(
              "px-2 py-1.5",
              col.align === "right" && "text-right",
              col.align === "center" && "text-center",
            )}
          >
            {col.filterKind && col.filterField ? (
              <FilterCell
                column={col}
                applied={values[col.filterField] ?? null}
                draft={drafts[col.filterField]}
                onDraft={(next) => setDraft(col.filterField!, next)}
                onEnterCommit={apply}
              />
            ) : null}
          </TableCell>
        ))}
      </TableRow>
      {filterableColumnCount > 0 && (isDirty || hasApplied) && (
        // Footer row matches ``FiltersMenu`` (toolbar.tsx L518-541):
        // Reset on the left when there's anything to reset; Apply on
        // the right, disabled until there's a staged change. Same
        // visual weight so the muscle memory carries between the
        // toolbar popover and the column filter row.
        <TableRow className="border-b-2 border-border/60 bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={columns.length} className="px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              {hasApplied ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={reset}
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="mr-1.5 size-3" />
                  Reset
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="button"
                size="sm"
                onClick={apply}
                disabled={!isDirty}
                className="h-7 text-xs"
              >
                Apply
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// True when two ColumnFilterValue-shaped objects (or nulls) encode
// the same filter. Used to detect "draft caught up with applied"
// after a round-trip so the dirty state resets cleanly.
function equalFilterValue(
  a: ColumnFilterValue | null,
  b: ColumnFilterValue | null,
): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (a.op !== b.op) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function FilterCell<T>({
  column,
  applied,
  draft,
  onDraft,
  onEnterCommit,
}: {
  column: DataTableColumn<T>;
  applied: ColumnFilterValue | null;
  draft: ColumnFilterValue | null | undefined;
  onDraft: (next: ColumnFilterValue | null) => void;
  onEnterCommit: () => void;
}) {
  // `undefined` draft means "user hasn't staged anything for this
  // cell yet — show the applied value". Any other draft value (incl.
  // explicit null for "will clear on apply") wins over applied.
  const shown = draft === undefined ? applied : draft;
  const placeholder = column.filterPlaceholder ?? column.header.toLowerCase();

  switch (column.filterKind) {
    case "text":
      return (
        <TextFilterInput
          value={shown}
          onDraft={onDraft}
          placeholder={placeholder}
          onEnterCommit={onEnterCommit}
        />
      );
    case "number-range":
      return <NumberRangeInput value={shown} onDraft={onDraft} />;
    case "date-range":
      return <DateRangeInput value={shown} onDraft={onDraft} />;
    case "select":
      return (
        <SelectInput
          value={shown}
          onDraft={onDraft}
          options={column.filterOptions ?? []}
          placeholder={column.header}
        />
      );
    case "multi-select":
      return (
        <MultiSelectInput
          value={shown}
          onDraft={onDraft}
          options={column.filterOptions ?? []}
          placeholder={column.header}
        />
      );
    case "boolean":
      return (
        <BooleanInput
          value={shown}
          onDraft={onDraft}
          placeholder={column.header}
        />
      );
    default:
      return null;
  }
}

// ── Text — draft on every keystroke, commit on Enter / Apply ──────

function TextFilterInput({
  value,
  onDraft,
  placeholder,
  onEnterCommit,
}: {
  value: ColumnFilterValue | null;
  onDraft: (next: ColumnFilterValue | null) => void;
  placeholder: string;
  onEnterCommit: () => void;
}) {
  const text =
    value && "value" in value && typeof value.value === "string"
      ? value.value
      : "";

  return (
    <div className="relative">
      <Input
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          onDraft(v.trim() ? { op: "contains", value: v } : null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnterCommit();
          }
        }}
        placeholder={placeholder}
        className="h-7 pr-6 text-xs"
      />
      {text && (
        <button
          type="button"
          onClick={() => onDraft(null)}
          aria-label="Clear"
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

// ── Number range — draft on every keystroke ───────────────────────

function NumberRangeInput({
  value,
  onDraft,
}: {
  value: ColumnFilterValue | null;
  onDraft: (next: ColumnFilterValue | null) => void;
}) {
  const range =
    value && value.op === "range" && ("min" in value || "max" in value)
      ? (value as { op: "range"; min?: number; max?: number })
      : { op: "range" as const, min: undefined, max: undefined };
  const minStr = range.min !== undefined ? String(range.min) : "";
  const maxStr = range.max !== undefined ? String(range.max) : "";

  function emit(nextMinStr: string, nextMaxStr: string) {
    const min = nextMinStr.trim() === "" ? undefined : Number(nextMinStr);
    const max = nextMaxStr.trim() === "" ? undefined : Number(nextMaxStr);
    if (
      (min !== undefined && Number.isNaN(min)) ||
      (max !== undefined && Number.isNaN(max))
    ) {
      return;
    }
    if (min === undefined && max === undefined) {
      onDraft(null);
    } else {
      onDraft({
        op: "range",
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      });
    }
  }

  return (
    <div className="flex items-center gap-0.5">
      <Input
        type="number"
        inputMode="decimal"
        value={minStr}
        onChange={(e) => emit(e.target.value, maxStr)}
        placeholder="min"
        className="h-7 min-w-0 flex-1 text-xs"
      />
      <span className="text-[10px] text-muted-foreground">–</span>
      <Input
        type="number"
        inputMode="decimal"
        value={maxStr}
        onChange={(e) => emit(minStr, e.target.value)}
        placeholder="max"
        className="h-7 min-w-0 flex-1 text-xs"
      />
    </div>
  );
}

// ── Date range — draft on every change ────────────────────────────

function DateRangeInput({
  value,
  onDraft,
}: {
  value: ColumnFilterValue | null;
  onDraft: (next: ColumnFilterValue | null) => void;
}) {
  const range =
    value && value.op === "range" && ("from" in value || "to" in value)
      ? (value as { op: "range"; from?: string; to?: string })
      : { op: "range" as const, from: undefined, to: undefined };
  const from = range.from ?? "";
  const to = range.to ?? "";

  function emit(nextFrom: string, nextTo: string) {
    if (!nextFrom && !nextTo) {
      onDraft(null);
    } else {
      onDraft({
        op: "range",
        ...(nextFrom ? { from: nextFrom } : {}),
        ...(nextTo ? { to: nextTo } : {}),
      });
    }
  }

  return (
    <div className="flex items-center gap-0.5">
      <Input
        type="date"
        value={from}
        onChange={(e) => emit(e.target.value, to)}
        className="h-7 min-w-0 flex-1 text-xs"
      />
      <span className="text-[10px] text-muted-foreground">–</span>
      <Input
        type="date"
        value={to}
        onChange={(e) => emit(from, e.target.value)}
        className="h-7 min-w-0 flex-1 text-xs"
      />
    </div>
  );
}

// ── Select — popover with option list ─────────────────────────────

function SelectInput({
  value,
  onDraft,
  options,
  placeholder,
}: {
  value: ColumnFilterValue | null;
  onDraft: (next: ColumnFilterValue | null) => void;
  options: Array<{ label: string; value: string | number | boolean }>;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const active =
    value && value.op === "eq" ? (value.value as string | number | boolean) : null;
  const activeLabel =
    active !== null
      ? (options.find((o) => String(o.value) === String(active))?.label ?? String(active))
      : null;

  return (
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-7 w-full items-center justify-between gap-1 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground hover:bg-muted",
              activeLabel && "pr-6 text-foreground",
            )}
          >
            <span className="truncate">
              {activeLabel ?? `${placeholder.toLowerCase()}…`}
            </span>
            {!activeLabel && (
              <ChevronDown className="size-3 shrink-0 opacity-50" />
            )}
          </button>
        </PopoverTrigger>
        {activeLabel && (
          <button
            type="button"
            onClick={() => onDraft(null)}
            aria-label="Clear"
            className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
        <PopoverContent align="start" className="w-56 p-1">
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {options.map((opt) => {
              const isActive = active !== null && String(active) === String(opt.value);
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => {
                    onDraft(isActive ? null : { op: "eq", value: opt.value });
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full rounded-sm px-2 py-1 text-left text-xs hover:bg-muted",
                    isActive && "bg-muted font-medium",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
            {options.length === 0 && (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                No options
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ── Multi-select — popover with checkboxes ────────────────────────

function MultiSelectInput({
  value,
  onDraft,
  options,
  placeholder,
}: {
  value: ColumnFilterValue | null;
  onDraft: (next: ColumnFilterValue | null) => void;
  options: Array<{ label: string; value: string | number | boolean }>;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const active =
    value && value.op === "in" ? new Set(value.value.map(String)) : new Set<string>();
  const activeCount = active.size;

  function toggle(v: string | number | boolean) {
    const next = new Set(active);
    const k = String(v);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    if (next.size === 0) {
      onDraft(null);
    } else {
      onDraft({ op: "in", value: Array.from(next) });
    }
  }

  return (
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-7 w-full items-center justify-between gap-1 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground hover:bg-muted",
              activeCount > 0 && "pr-6 text-foreground",
            )}
          >
            <span className="truncate">
              {activeCount === 0
                ? `${placeholder.toLowerCase()}…`
                : `${activeCount} selected`}
            </span>
            {activeCount === 0 && (
              <ChevronDown className="size-3 shrink-0 opacity-50" />
            )}
          </button>
        </PopoverTrigger>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => onDraft(null)}
            aria-label="Clear"
            className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
        <PopoverContent align="start" className="w-56 p-1">
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {options.map((opt) => {
              const isActive = active.has(String(opt.value));
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => toggle(opt.value)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-muted",
                    isActive && "bg-muted font-medium",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-3.5 shrink-0 items-center justify-center rounded border border-border",
                      isActive && "border-brand bg-brand text-brand-foreground",
                    )}
                  >
                    {isActive && (
                      <span className="text-[10px] leading-none">✓</span>
                    )}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ── Boolean — three-way toggle (any / yes / no) ───────────────────

function BooleanInput({
  value,
  onDraft,
  placeholder,
}: {
  value: ColumnFilterValue | null;
  onDraft: (next: ColumnFilterValue | null) => void;
  placeholder: string;
}) {
  const active = value && value.op === "eq" ? (value.value as boolean) : null;
  const label =
    active === true ? "Yes" : active === false ? "No" : placeholder.toLowerCase();

  return (
    <button
      type="button"
      onClick={() => {
        // Cycle: null → true → false → null
        if (active === null) onDraft({ op: "eq", value: true });
        else if (active === true) onDraft({ op: "eq", value: false });
        else onDraft(null);
      }}
      className={cn(
        "flex h-7 w-full items-center justify-center rounded-md border border-input bg-background px-2 text-xs hover:bg-muted",
        active !== null ? "font-medium text-foreground" : "text-muted-foreground",
        active === true && "border-brand/40 bg-brand/10",
        active === false && "border-destructive/40 bg-destructive/[0.06]",
      )}
    >
      {label}
    </button>
  );
}
