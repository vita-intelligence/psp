"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Generic searchable async picker. Replaces the naive
 * `<Select>{items.map(...)}</Select>` pattern that doesn't scale past a
 * few hundred rows.
 *
 * Strategy:
 *   1. The trigger button shows the currently-selected option (or a
 *      placeholder).
 *   2. Opening the popover loads the first page from the server
 *      (`fetcher("")`).
 *   3. Typing into the search input fires a debounced fetch
 *      (250ms) — server-side filters to the top N matches.
 *   4. Clicking a row resolves `onChange`.
 *
 * Why a popover + custom list rather than `cmdk` / Radix Combobox: the
 * project ships its own picker components for ISO codes; reusing the
 * same Popover + Input pattern keeps the visual + a11y story
 * consistent across forms.
 */

const DEBOUNCE_MS = 250;

export interface SearchPickerOption {
  id: number;
  /** Primary label rendered on the trigger and in the list. */
  label: string;
  /** Short prefix shown left of the label (item code, cert code, etc.) */
  code?: string | null;
  /** Optional sublabel rendered under the primary label. */
  sublabel?: string | null;
}

interface Props<O extends SearchPickerOption> {
  /** Server-side search. Should return up to N matches (~50). Empty
   *  query returns the first page so the dropdown isn't empty on open. */
  fetcher: (query: string, signal?: AbortSignal) => Promise<O[]>;
  /** Currently-selected option (`null` ⇒ nothing picked yet). The
   *  picker stays stateful for the search query + result list but
   *  delegates the selected value to the parent. */
  value: O | null;
  onChange: (next: O | null) => void;
  /** Optional id on the trigger button for `Label htmlFor` wiring. */
  id?: string;
  /** Surfaces field-collab focus when the popover opens/closes — wire
   *  through to `useLiveForm.focusField` on collab forms. */
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  /** Text shown when no matches come back. */
  emptyHint?: string;
  /** Set true on form layouts where the trigger fills a tight cell. */
  compact?: boolean;
  /** Disable interaction (read-only / no edit perm). */
  disabled?: boolean;
  className?: string;
  /** Render-prop hook for the row body. Defaults to code + label +
   *  sublabel. Override when a custom layout is needed (badges, etc). */
  renderRow?: (option: O, isSelected: boolean) => React.ReactNode;
  /** ids to exclude from the result list — used to hide already-picked
   *  options in many-to-many pickers. Applied client-side after the
   *  fetcher returns. */
  excludeIds?: ReadonlySet<number>;
}

export function SearchPicker<O extends SearchPickerOption>({
  fetcher,
  value,
  onChange,
  id,
  onFocus,
  onBlur,
  placeholder = "Pick…",
  emptyHint = "No matches.",
  compact,
  disabled,
  className,
  renderRow,
  excludeIds,
}: Props<O>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<O[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each new fetch cancels the previous one so a slow first query
  // doesn't overwrite the latest result with stale data.
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runFetch = useCallback(
    (q: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      fetcher(q, controller.signal)
        .then((rows) => {
          if (controller.signal.aborted) return;
          setResults(rows);
          setLoading(false);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError(
            err instanceof Error ? err.message : "Couldn't load matches.",
          );
          setResults([]);
          setLoading(false);
        });
    },
    [fetcher],
  );

  // Re-fetch on query change (debounced) only while the popover is open.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runFetch(query), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, query, runFetch]);

  // Initial load on open — fires immediately (no debounce) so the
  // dropdown feels responsive the first time the user clicks the
  // trigger.
  useEffect(() => {
    if (open && results.length === 0 && !loading) {
      runFetch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Clean up on close — wipe transient state but keep the value.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      onFocus?.();
    } else {
      setQuery("");
      setResults([]);
      setError(null);
      abortRef.current?.abort();
      onBlur?.();
    }
  }

  const filteredResults = excludeIds
    ? results.filter((o) => !excludeIds.has(o.id))
    : results;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-between font-normal",
            compact && "h-8 text-xs",
            !value && "text-muted-foreground",
            className,
          )}
        >
          {value ? (
            <span className="flex min-w-0 items-center gap-2 truncate">
              {value.code && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {value.code}
                </span>
              )}
              <span className="truncate">{value.label}</span>
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
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to search…"
              className="h-8 pl-8 text-xs"
            />
            {loading && (
              <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
        <ul
          className="max-h-[320px] overflow-y-auto py-1"
          aria-busy={loading}
        >
          {error && (
            <li className="px-3 py-3 text-center text-xs text-destructive">
              {error}
            </li>
          )}
          {!error && filteredResults.length === 0 && !loading && (
            <li className="px-3 py-3 text-center text-xs text-muted-foreground">
              {emptyHint}
            </li>
          )}
          {filteredResults.map((o) => {
            const isSelected = value?.id === o.id;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o);
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
                  {renderRow ? (
                    renderRow(o, isSelected)
                  ) : (
                    <>
                      {o.code && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {o.code}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {o.label}
                      </span>
                      {o.sublabel && (
                        <span className="truncate text-[10px] text-muted-foreground">
                          {o.sublabel}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
