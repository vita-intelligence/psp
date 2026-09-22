"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Search, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Async searchable picker keyed by an opaque string ``key`` (uuid,
 * composite tag, etc.). Sibling of ``SearchPicker`` which is keyed by
 * numeric PK — kept separate so uuid callers don't have to shim their
 * ids into numbers.
 *
 * Behaviour:
 *   * Trigger button shows the current selection or a placeholder.
 *   * Opening fires the first fetch (``fetcher(q="", cursor=null)``).
 *   * Typing debounces 250 ms then re-fetches from cursor=null.
 *   * IntersectionObserver on a sentinel at the bottom of the list
 *     appends the next cursor page while there is one.
 *   * Every fetch runs under an AbortController — a stale response
 *     from a previous query never overwrites a fresher one.
 *
 * The picker doesn't own the ``value``; the parent passes the
 * currently-selected option in (or ``null``) and receives ``onChange``
 * events with the freshly-picked option.
 */

const DEBOUNCE_MS = 250;

export interface KeyPickerOption {
  /** Stable identifier written back to the URL / kept in filter state. */
  key: string;
  /** Primary display label — bolded row header. */
  label: string;
  /** Optional muted metadata line under the label. */
  sublabel?: string | null;
}

export interface KeyPickerPage {
  items: KeyPickerOption[];
  nextCursor: string | null;
}

interface Props {
  /** Paginated fetcher — call site typically debounced through here
   *  already. Every call must respect ``signal`` so we can cancel
   *  when the query changes. */
  fetcher: (
    query: string,
    cursor: string | null,
    signal?: AbortSignal,
  ) => Promise<KeyPickerPage>;
  value: KeyPickerOption | null;
  onChange: (next: KeyPickerOption | null) => void;
  id?: string;
  placeholder?: string;
  emptyHint?: string;
  disabled?: boolean;
  className?: string;
  /** Show a small clear "×" button on the trigger when a value is
   *  set. Wired to ``onChange(null)``. */
  clearable?: boolean;
}

export function AsyncKeyPicker({
  fetcher,
  value,
  onChange,
  id,
  placeholder = "Any",
  emptyHint = "No matches.",
  disabled,
  className,
  clearable = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KeyPickerOption[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const openedOnceRef = useRef(false);

  // Snapshot live state for the stable IntersectionObserver callback
  // (same pattern as SearchPicker — avoids fetch-loop on re-render).
  const latestRef = useRef({ query, nextCursor, loading, loadingMore });
  latestRef.current = { query, nextCursor, loading, loadingMore };

  const runFirstPage = useCallback(
    (q: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const gen = ++generationRef.current;
      setLoading(true);
      setError(null);

      fetcher(q, null, controller.signal)
        .then((page) => {
          if (controller.signal.aborted) return;
          if (gen !== generationRef.current) return;
          setResults(page.items);
          setNextCursor(page.nextCursor);
          setLoading(false);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          if (gen !== generationRef.current) return;
          setError(err instanceof Error ? err.message : "Couldn't load matches.");
          setResults([]);
          setNextCursor(null);
          setLoading(false);
        });
    },
    [fetcher],
  );

  const runNextPage = useCallback(() => {
    const {
      query: q,
      nextCursor: cursor,
      loading: isLoading,
      loadingMore: isLoadingMore,
    } = latestRef.current;
    if (!cursor || isLoading || isLoadingMore) return;

    const controller = new AbortController();
    const gen = generationRef.current;
    setLoadingMore(true);

    fetcher(q, cursor, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        if (gen !== generationRef.current) return;
        setResults((prev) => {
          const seen = new Set(prev.map((o) => o.key));
          const merged = [...prev];
          for (const it of page.items) if (!seen.has(it.key)) merged.push(it);
          return merged;
        });
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        if (gen !== generationRef.current) return;
        setLoadingMore(false);
      });
  }, [fetcher]);

  useEffect(() => {
    if (!open) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (!openedOnceRef.current) {
      openedOnceRef.current = true;
      runFirstPage(query);
      return;
    }

    debounceRef.current = setTimeout(() => runFirstPage(query), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [open, query, runFirstPage]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setResults([]);
      setNextCursor(null);
      setError(null);
      abortRef.current?.abort();
      generationRef.current++;
      openedOnceRef.current = false;
    }
  }

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback(
    (node: HTMLLIElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (!node) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) runNextPage();
        },
        { root: node.parentElement, threshold: 0, rootMargin: "80px 0px" },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [runNextPage],
  );

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
            "h-9 w-full justify-between font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="min-w-0 truncate">
            {value ? value.label : placeholder}
          </span>
          <span className="ml-2 flex shrink-0 items-center gap-1">
            {clearable && value && !disabled ? (
              <span
                role="button"
                aria-label="Clear"
                className="text-muted-foreground hover:text-foreground"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(null);
                }}
              >
                <X className="size-3.5" />
              </span>
            ) : null}
            <ChevronsUpDown className="size-4 opacity-50" />
          </span>
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
          className="max-h-[320px] overflow-y-auto overscroll-contain py-1"
          aria-busy={loading}
        >
          {error && (
            <li className="px-3 py-3 text-center text-xs text-destructive">
              {error}
            </li>
          )}
          {!error && results.length === 0 && !loading && (
            <li className="px-3 py-3 text-center text-xs text-muted-foreground">
              {emptyHint}
            </li>
          )}
          {results.map((o) => {
            const isSelected = value?.key === o.key;
            return (
              <li key={o.key}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o);
                    onOpenChange(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/60 active:bg-muted",
                    isSelected && "bg-muted/40",
                  )}
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.sublabel && (
                    <span className="truncate text-[10px] text-muted-foreground">
                      {o.sublabel}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {nextCursor && !error ? (
            <li ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
          ) : null}
          {loadingMore ? (
            <li className="flex items-center justify-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Loading more…
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
