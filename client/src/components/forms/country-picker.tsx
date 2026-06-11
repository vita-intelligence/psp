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
import { COUNTRIES, findCountry } from "@/lib/iso/countries";

interface Props {
  value: string | null;
  onChange: (code: string | null) => void;
  /** id on the trigger button — wire to Label htmlFor + collab focusField. */
  id?: string;
  /** Surface field-collab focus when the popover opens / closes. */
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  /** Disable the trigger entirely (read-only / no edit perm). */
  disabled?: boolean;
  className?: string;
  /** Set true on form layouts where 280px is wider than the column. */
  compact?: boolean;
  /** Allow null clear — defaults true. Pass false for required fields. */
  allowClear?: boolean;
}

/**
 * Controlled-vocabulary picker for ISO 3166-1 alpha-2 country codes.
 * Replaces free-text 2-char inputs everywhere a country lives in the
 * schema (vendor address, lot.country_of_origin, ship-to addresses).
 * Searchable by code + name; "popular" codes (UK, IE, EU big ones, US/CA,
 * key trading partners) sit at the top so the daily case is one click.
 */
export function CountryPicker({
  value,
  onChange,
  id,
  onFocus,
  onBlur,
  placeholder = "Pick a country…",
  disabled,
  className,
  compact,
  allowClear = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = findCountry(value);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
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
              <span aria-hidden>{selected.flag}</span>
              <span className="font-mono text-xs">{selected.code}</span>
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
              placeholder="Search country or code…"
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
              No matching country.
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
                    <span aria-hidden>{c.flag}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.code}
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
