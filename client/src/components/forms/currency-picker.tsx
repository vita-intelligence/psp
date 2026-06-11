"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CURRENCIES, findCurrency } from "@/lib/iso/currencies";

interface Props {
  value: string | null;
  onChange: (code: string | null) => void;
  id?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  allowClear?: boolean;
}

/**
 * Controlled-vocabulary picker for ISO 4217 currency codes. Replaces
 * free-text 3-char inputs on vendor / PO / lot forms. Searchable by code
 * or name; the UK manufacturer's daily codes (GBP / EUR / USD / CAD /
 * AUD / etc.) sit at the top.
 */
export function CurrencyPicker({
  value,
  onChange,
  id,
  onFocus,
  onBlur,
  placeholder = "Pick a currency…",
  disabled,
  className,
  compact,
  allowClear = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = findCurrency(value);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return CURRENCIES;
    return CURRENCIES.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q),
    );
  }, [search]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onFocus?.();
        else {
          setSearch("");
          onBlur?.();
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-between font-normal",
            compact && "h-8 text-xs",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          {selected ? (
            <span className="flex items-center gap-2 truncate">
              <span className="font-mono text-xs">{selected.code}</span>
              <span className="text-muted-foreground">{selected.symbol}</span>
              <span className="truncate text-foreground/80">
                {selected.name}
              </span>
            </span>
          ) : (
            <span>{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <div className="border-b border-border/60 p-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search currency or code…"
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
        <ul className="max-h-[280px] overflow-y-auto py-1">
          {allowClear && selected && (
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/60"
              >
                <span className="size-4" aria-hidden />
                Clear selection
              </button>
            </li>
          )}
          {filtered.length === 0 ? (
            <li className="px-3 py-3 text-center text-xs text-muted-foreground">
              No matching currency.
            </li>
          ) : (
            filtered.map((c) => {
              const isSelected = selected?.code === c.code;
              return (
                <li key={c.code}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(c.code);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/60",
                      isSelected && "bg-muted/40",
                    )}
                  >
                    <Check
                      className={cn(
                        "size-3.5 shrink-0",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.code}
                    </span>
                    <span className="w-6 text-center text-muted-foreground">
                      {c.symbol}
                    </span>
                    <span className="truncate">{c.name}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
