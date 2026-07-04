"use client";

// Per-column filter editor rendered inside the header dropdown.
// Six kinds, one component — dispatches to the right input based on
// the column's `filterKind` and emits a ColumnFilterValue shaped for
// Backend.Query.apply_filters/3.

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ColumnFilterKind, ColumnFilterValue } from "./types";

interface Props {
  kind: ColumnFilterKind;
  value: ColumnFilterValue | null;
  onChange: (value: ColumnFilterValue | null) => void;
  options?: Array<{ label: string; value: string | number | boolean }>;
  placeholder?: string;
}

export function ColumnFilterEditor({
  kind,
  value,
  onChange,
  options,
  placeholder,
}: Props) {
  switch (kind) {
    case "text":
      return (
        <TextFilter
          value={value}
          onChange={onChange}
          placeholder={placeholder}
        />
      );
    case "number-range":
      return <NumberRangeFilter value={value} onChange={onChange} />;
    case "date-range":
      return <DateRangeFilter value={value} onChange={onChange} />;
    case "select":
      return (
        <SelectFilter
          value={value}
          onChange={onChange}
          options={options ?? []}
        />
      );
    case "multi-select":
      return (
        <MultiSelectFilter
          value={value}
          onChange={onChange}
          options={options ?? []}
        />
      );
    case "boolean":
      return <BooleanFilter value={value} onChange={onChange} />;
  }
}

// ── Text (contains) ───────────────────────────────────────────────

function TextFilter({
  value,
  onChange,
  placeholder,
}: {
  value: ColumnFilterValue | null;
  onChange: (v: ColumnFilterValue | null) => void;
  placeholder?: string;
}) {
  const initial =
    value && "value" in value && typeof value.value === "string"
      ? value.value
      : "";
  const [local, setLocal] = useState(initial);
  // Sync outside changes (e.g. Clear button) into the input.
  useEffect(() => setLocal(initial), [initial]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = local.trim();
        onChange(trimmed ? { op: "contains", value: trimmed } : null);
      }}
      className="space-y-1"
    >
      <Input
        autoFocus
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder ? `Contains "${placeholder}"…` : "Contains…"}
        className="h-8 text-xs"
      />
      <p className="text-[10px] text-muted-foreground">
        Enter to apply · empty to clear
      </p>
    </form>
  );
}

// ── Number range ──────────────────────────────────────────────────

function NumberRangeFilter({
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
    // Only re-sync when the outside value identity flips (Clear).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const min = minStr.trim() === "" ? undefined : Number(minStr);
        const max = maxStr.trim() === "" ? undefined : Number(maxStr);
        if (
          (min !== undefined && Number.isNaN(min)) ||
          (max !== undefined && Number.isNaN(max))
        ) {
          return; // ignore invalid submit
        }
        if (min === undefined && max === undefined) {
          onChange(null);
        } else {
          onChange({ op: "range", ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
        }
      }}
      className="space-y-1"
    >
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          type="number"
          inputMode="decimal"
          value={minStr}
          onChange={(e) => setMinStr(e.target.value)}
          placeholder="Min"
          className="h-8 text-xs"
        />
        <span className="text-[10px] text-muted-foreground">→</span>
        <Input
          type="number"
          inputMode="decimal"
          value={maxStr}
          onChange={(e) => setMaxStr(e.target.value)}
          placeholder="Max"
          className="h-8 text-xs"
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Enter to apply · leave blank for open-ended
      </p>
    </form>
  );
}

// ── Date range ────────────────────────────────────────────────────

function DateRangeFilter({
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

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!from && !to) {
          onChange(null);
        } else {
          onChange({
            op: "range",
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
          });
        }
      }}
      className="space-y-1"
    >
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-8 text-xs"
        />
        <span className="text-[10px] text-muted-foreground">→</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-8 text-xs"
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Enter to apply · leave blank for open-ended
      </p>
    </form>
  );
}

// ── Select (single) ──────────────────────────────────────────────

function SelectFilter({
  value,
  onChange,
  options,
}: {
  value: ColumnFilterValue | null;
  onChange: (v: ColumnFilterValue | null) => void;
  options: Array<{ label: string; value: string | number | boolean }>;
}) {
  const active =
    value && value.op === "eq" ? (value.value as string | number | boolean) : null;

  return (
    <div className="max-h-56 space-y-0.5 overflow-y-auto">
      {options.map((opt) => {
        const isActive = active !== null && String(active) === String(opt.value);
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() =>
              isActive
                ? onChange(null)
                : onChange({ op: "eq", value: opt.value })
            }
            className={cn(
              "flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-xs hover:bg-muted",
              isActive && "bg-muted font-medium",
            )}
          >
            <span className="truncate">{opt.label}</span>
            {isActive && (
              <span className="ml-2 text-[10px] text-brand">Selected</span>
            )}
          </button>
        );
      })}
      {options.length === 0 && (
        <p className="px-2 py-1 text-[11px] text-muted-foreground">
          No options
        </p>
      )}
    </div>
  );
}

// ── Multi-select ─────────────────────────────────────────────────

function MultiSelectFilter({
  value,
  onChange,
  options,
}: {
  value: ColumnFilterValue | null;
  onChange: (v: ColumnFilterValue | null) => void;
  options: Array<{ label: string; value: string | number | boolean }>;
}) {
  const active =
    value && value.op === "in" ? new Set(value.value.map(String)) : new Set<string>();

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
              {isActive && <span className="text-[10px] leading-none">✓</span>}
            </span>
            <span className="truncate">{opt.label}</span>
          </button>
        );
      })}
      {options.length === 0 && (
        <p className="px-2 py-1 text-[11px] text-muted-foreground">
          No options
        </p>
      )}
    </div>
  );
}

// ── Boolean ──────────────────────────────────────────────────────

function BooleanFilter({
  value,
  onChange,
}: {
  value: ColumnFilterValue | null;
  onChange: (v: ColumnFilterValue | null) => void;
}) {
  const active =
    value && value.op === "eq" ? (value.value as boolean) : null;

  const opts: Array<{ label: string; v: boolean }> = [
    { label: "Yes", v: true },
    { label: "No", v: false },
  ];

  return (
    <div className="flex gap-1">
      {opts.map((opt) => {
        const isActive = active === opt.v;
        return (
          <button
            key={String(opt.v)}
            type="button"
            onClick={() =>
              isActive ? onChange(null) : onChange({ op: "eq", value: opt.v })
            }
            className={cn(
              "flex-1 rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted",
              isActive && "border-brand bg-brand/10 font-medium text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
