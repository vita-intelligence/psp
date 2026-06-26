"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COUNTRIES, findCountry, type Country } from "@/lib/iso/countries";

// Mobile breakpoint — anything narrower than 640 px opens the picker as
// a full-screen dialog instead of the desktop popover. The popover
// renders inside a 220-px column on phones and the search input drives
// the soft keyboard over the list — a sheet is much more usable.
const MOBILE_BREAKPOINT_PX = 640;

function useIsSmallViewport(): boolean {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    setSmall(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setSmall(e.matches);
    // Safari < 14 only fires the deprecated `addListener` callback.
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);
  return small;
}

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
  const isMobile = useIsSmallViewport();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q),
    );
  }, [search]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) onFocus?.();
    else {
      setSearch("");
      onBlur?.();
    }
  }

  function select(code: string | null) {
    onChange(code);
    handleOpenChange(false);
  }

  const trigger = (
    <Button
      id={id}
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      disabled={disabled}
      onClick={isMobile ? () => handleOpenChange(true) : undefined}
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
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <MobileCountrySheet
          open={open}
          onOpenChange={handleOpenChange}
          countries={filtered}
          selectedCode={selected?.code ?? null}
          search={search}
          onSearch={setSearch}
          allowClear={allowClear && !!selected}
          onSelect={select}
        />
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
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
                onClick={() => select(null)}
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
                    onClick={() => select(c.code)}
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

/**
 * Full-screen-ish sheet for phones. Headless on purpose — uses a raw
 * fixed div instead of the Dialog component so we can control sizing
 * (full viewport, sticky search header, scrollable list) without
 * fighting the desktop dialog max-width / centred-card defaults.
 */
function MobileCountrySheet({
  open,
  onOpenChange,
  countries,
  selectedCode,
  search,
  onSearch,
  allowClear,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  countries: ReadonlyArray<Country>;
  selectedCode: string | null;
  search: string;
  onSearch: (next: string) => void;
  allowClear: boolean;
  onSelect: (code: string | null) => void;
}) {
  const selectedItemRef = useRef<HTMLLIElement | null>(null);

  // Lock body scroll while open so the sheet doesn't fight the page
  // underneath; restore on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Jump the selected row into view on first paint so the operator
  // doesn't have to hunt for it after re-opening.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      selectedItemRef.current?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Hardware-keyboard Esc + Android back-button safety net.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  // Render at document.body so the sheet is OUTSIDE any wrapping
  // <label> from the caller. Without this, clicks on Close / Done
  // were bubbling to the label, which then re-fired the click on the
  // labelled trigger button — so the sheet immediately re-opened.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pick a country"
      // pt-/pb-safe respect the iOS notch + home-indicator. inset-0
      // makes the sheet truly full-screen so the operator can't tap
      // a phantom area underneath.
      className="fixed inset-0 z-50 flex flex-col bg-background"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <header className="flex items-center gap-2 border-b border-border/60 bg-background px-3 py-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search country or code…"
            className="h-11 pl-9 text-base"
            // No autoFocus — operator usually wants to scroll the
            // list first; popping the keyboard immediately covers
            // half the rows. They tap the input when ready to type.
          />
        </div>
        {/* Explicit labelled Close button — the icon-only version
            was easy to miss on a tall screen with the keyboard up. */}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close country picker"
          className="flex h-11 shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background px-3 text-sm font-medium text-foreground active:bg-muted"
        >
          <X className="size-4" />
          <span>Close</span>
        </button>
      </header>
      <ul className="flex-1 overflow-y-auto overscroll-contain">
        {allowClear && (
          <li>
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-muted-foreground active:bg-muted/60"
            >
              <span className="size-5" aria-hidden />
              Clear selection
            </button>
          </li>
        )}
        {countries.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            No matching country.
          </li>
        ) : (
          countries.map((c) => {
            const isSelected = selectedCode === c.code;
            return (
              <li
                key={c.code}
                ref={isSelected ? selectedItemRef : undefined}
              >
                <button
                  type="button"
                  onClick={() => onSelect(c.code)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-border/40 px-4 py-3 text-left text-base active:bg-muted/60",
                    isSelected && "bg-muted/40 font-semibold",
                  )}
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0 text-brand",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="text-xl leading-none" aria-hidden>
                    {c.flag}
                  </span>
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
      {/* Sticky Done bar so the operator always has a thumb-reachable
          way out, even when the keyboard pushed the X off-screen. */}
      <footer className="border-t border-border/60 bg-background p-3">
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="w-full"
          onClick={() => onOpenChange(false)}
        >
          Done
        </Button>
      </footer>
    </div>,
    document.body,
  );
}
