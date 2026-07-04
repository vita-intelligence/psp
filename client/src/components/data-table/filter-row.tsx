"use client";

// Persistent filter row that renders under the header row of the
// desktop table. One cell per column; each cell shows a compact input
// keyed to the column's `filterKind`. Always visible, matches the
// MRPEasy / Airtable "every column has a search box" convention.
//
// Debounces text inputs at 300ms so typing doesn't fire a query per
// keystroke. Range / date inputs commit on blur so partial values
// aren't misread. Selects commit immediately.

import { useEffect, useRef, useState } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChevronDown, X } from "lucide-react";
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

export function FilterRow<T>({ columns, values, onChange }: Props<T>) {
  return (
    <TableRow className="border-b-2 border-border/60 bg-muted/30 hover:bg-muted/30">
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
              value={values[col.filterField] ?? null}
              onChange={(v) => onChange(col.filterField!, v)}
            />
          ) : null}
        </TableCell>
      ))}
    </TableRow>
  );
}

function FilterCell<T>({
  column,
  value,
  onChange,
}: {
  column: DataTableColumn<T>;
  value: ColumnFilterValue | null;
  onChange: (v: ColumnFilterValue | null) => void;
}) {
  switch (column.filterKind) {
    case "text":
      return (
        <TextFilterInput
          value={value}
          onChange={onChange}
          placeholder={column.filterPlaceholder ?? column.header.toLowerCase()}
        />
      );
    case "number-range":
      return <NumberRangeInput value={value} onChange={onChange} />;
    case "date-range":
      return <DateRangeInput value={value} onChange={onChange} />;
    case "select":
      return (
        <SelectInput
          value={value}
          onChange={onChange}
          options={column.filterOptions ?? []}
          placeholder={column.header}
        />
      );
    case "multi-select":
      return (
        <MultiSelectInput
          value={value}
          onChange={onChange}
          options={column.filterOptions ?? []}
          placeholder={column.header}
        />
      );
    case "boolean":
      return (
        <BooleanInput
          value={value}
          onChange={onChange}
          placeholder={column.header}
        />
      );
    default:
      return null;
  }
}

// ── Text — 300ms debounce ─────────────────────────────────────────

function TextFilterInput({
  value,
  onChange,
  placeholder,
}: {
  value: ColumnFilterValue | null;
  onChange: (v: ColumnFilterValue | null) => void;
  placeholder: string;
}) {
  const initial =
    value && "value" in value && typeof value.value === "string" ? value.value : "";
  const [local, setLocal] = useState(initial);
  useEffect(() => setLocal(initial), [initial]);

  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (local === initial) return;
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const trimmed = local.trim();
      onChange(trimmed ? { op: "contains", value: trimmed } : null);
    }, 300);
    return () => {
      if (debounceRef.current !== null)
        window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <div className="relative">
      <Input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className="h-7 pr-6 text-xs"
      />
      {local && (
        <button
          type="button"
          onClick={() => {
            setLocal("");
            onChange(null);
          }}
          aria-label="Clear"
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

// ── Number range — commit on blur ─────────────────────────────────

function NumberRangeInput({
  value,
  onChange,
}: {
  value: ColumnFilterValue | null;
  onChange: (v: ColumnFilterValue | null) => void;
}) {
  const range =
    value && value.op === "range" && ("min" in value || "max" in value)
      ? (value as { op: "range"; min?: number; max?: number })
      : { op: "range" as const, min: undefined, max: undefined };
  const [minStr, setMinStr] = useState(
    range.min !== undefined ? String(range.min) : "",
  );
  const [maxStr, setMaxStr] = useState(
    range.max !== undefined ? String(range.max) : "",
  );

  useEffect(() => {
    setMinStr(range.min !== undefined ? String(range.min) : "");
    setMaxStr(range.max !== undefined ? String(range.max) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit() {
    const min = minStr.trim() === "" ? undefined : Number(minStr);
    const max = maxStr.trim() === "" ? undefined : Number(maxStr);
    if (
      (min !== undefined && Number.isNaN(min)) ||
      (max !== undefined && Number.isNaN(max))
    ) {
      return;
    }
    if (min === undefined && max === undefined) {
      onChange(null);
    } else {
      onChange({
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
        onChange={(e) => setMinStr(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        placeholder="min"
        className="h-7 min-w-0 flex-1 text-xs"
      />
      <span className="text-[10px] text-muted-foreground">–</span>
      <Input
        type="number"
        inputMode="decimal"
        value={maxStr}
        onChange={(e) => setMaxStr(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        placeholder="max"
        className="h-7 min-w-0 flex-1 text-xs"
      />
    </div>
  );
}

// ── Date range — native date inputs, commit on change ─────────────

function DateRangeInput({
  value,
  onChange,
}: {
  value: ColumnFilterValue | null;
  onChange: (v: ColumnFilterValue | null) => void;
}) {
  const range =
    value && value.op === "range" && ("from" in value || "to" in value)
      ? (value as { op: "range"; from?: string; to?: string })
      : { op: "range" as const, from: undefined, to: undefined };
  const [from, setFrom] = useState(range.from ?? "");
  const [to, setTo] = useState(range.to ?? "");

  useEffect(() => {
    setFrom(range.from ?? "");
    setTo(range.to ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function emit(nextFrom: string, nextTo: string) {
    if (!nextFrom && !nextTo) {
      onChange(null);
    } else {
      onChange({
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
        onChange={(e) => {
          setFrom(e.target.value);
          emit(e.target.value, to);
        }}
        className="h-7 min-w-0 flex-1 text-xs"
      />
      <span className="text-[10px] text-muted-foreground">–</span>
      <Input
        type="date"
        value={to}
        onChange={(e) => {
          setTo(e.target.value);
          emit(from, e.target.value);
        }}
        className="h-7 min-w-0 flex-1 text-xs"
      />
    </div>
  );
}

// ── Select — popover with option list ─────────────────────────────

function SelectInput({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: ColumnFilterValue | null;
  onChange: (v: ColumnFilterValue | null) => void;
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
          // Sibling — sitting outside the trigger button so we don't
          // nest <button> in <button>. Absolute-positioned over the
          // right edge of the trigger.
          <button
            type="button"
            onClick={() => onChange(null)}
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
                    onChange(isActive ? null : { op: "eq", value: opt.value });
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
  onChange,
  options,
  placeholder,
}: {
  value: ColumnFilterValue | null;
  onChange: (v: ColumnFilterValue | null) => void;
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
      onChange(null);
    } else {
      onChange({ op: "in", value: Array.from(next) });
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
            onClick={() => onChange(null)}
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
  onChange,
  placeholder,
}: {
  value: ColumnFilterValue | null;
  onChange: (v: ColumnFilterValue | null) => void;
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
        if (active === null) onChange({ op: "eq", value: true });
        else if (active === true) onChange({ op: "eq", value: false });
        else onChange(null);
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
