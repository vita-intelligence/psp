"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Loader2, Search, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Mobile breakpoint — anything narrower than 640 px opens the picker
// as a full-screen sheet instead of the desktop popover. Same
// threshold and posture as the country picker: the popover renders
// inside a cramped column on phones and the soft keyboard pushes
// half the list off-screen. A sheet is much more usable.
const MOBILE_BREAKPOINT_PX = 640;

function useIsSmallViewport(): boolean {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(
      `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`,
    );
    setSmall(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setSmall(e.matches);
    // Safari < 14 only fires the deprecated `addListener` callback.
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);
  return small;
}

/**
 * Generic searchable async picker. Replaces the naive
 * `<Select>{items.map(...)}</Select>` pattern that doesn't scale past a
 * few hundred rows.
 *
 * Strategy:
 *   1. The trigger button shows the currently-selected option (or a
 *      placeholder).
 *   2. Opening the popover loads the first page from the server
 *      (`fetcher("")` / `paginatedFetcher("", null)`).
 *   3. Typing into the search input fires a debounced fetch
 *      (250ms) — server-side filters to the top N matches. New
 *      queries abort in-flight requests and reset the result list.
 *   4. Clicking a row resolves `onChange`.
 *   5. If a `paginatedFetcher` is supplied AND its response carries
 *      a non-null `nextCursor`, an IntersectionObserver sentinel at
 *      the bottom of the list triggers a follow-up fetch and
 *      appends. Scales to catalogs of millions.
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

/** Return shape for the paginated fetcher variant. `nextCursor: null`
 *  means "no more pages" — the scroll sentinel stops firing. */
export interface SearchPickerPage<O> {
  items: O[];
  nextCursor: string | null;
}

interface Props<O extends SearchPickerOption> {
  /** Single-page fetcher — returns up to N matches for the query.
   *  Empty query returns the first page so the dropdown isn't
   *  empty on open. Mutually exclusive with `paginatedFetcher`. */
  fetcher?: (query: string, signal?: AbortSignal) => Promise<O[]>;
  /** Paginated fetcher — enables infinite-scroll mode. Called with
   *  `(query, cursor, signal)`; `cursor` is `null` on the first
   *  page and the server's `next_cursor` on subsequent pages. */
  paginatedFetcher?: (
    query: string,
    cursor: string | null,
    signal?: AbortSignal,
  ) => Promise<SearchPickerPage<O>>;
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
  paginatedFetcher,
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
  const isMobile = useIsSmallViewport();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<O[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each new fetch cancels the previous one so a slow first query
  // doesn't overwrite the latest result with stale data.
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bump on every "reset" (new query, popover open, first fetch). Used
  // by the sentinel effect to avoid racing next-page fetches against
  // a stale first-page response that arrived late.
  const generationRef = useRef(0);

  // First-open marker — the initial fetch should fire immediately,
  // but subsequent query typing gets the debounce treatment.
  const openedOnceRef = useRef(false);

  // Latest state snapshot readable from inside a stable observer
  // callback. Without this, `runNextPage`'s useCallback deps flip on
  // every state change, which recreates the IntersectionObserver on
  // every render — and `observer.observe()` fires the callback once
  // with the current intersection state, causing a load loop.
  const latestRef = useRef({
    query,
    nextCursor,
    loading,
    loadingMore,
    paginatedFetcher,
  });
  latestRef.current = {
    query,
    nextCursor,
    loading,
    loadingMore,
    paginatedFetcher,
  };

  const isPaginated = !!paginatedFetcher;

  // Fetch page 1 for the given query — wipes the accumulated list.
  const runFirstPage = useCallback(
    (q: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const gen = ++generationRef.current;
      setLoading(true);
      setError(null);

      const promise: Promise<SearchPickerPage<O>> = paginatedFetcher
        ? paginatedFetcher(q, null, controller.signal)
        : fetcher
          ? fetcher(q, controller.signal).then((items) => ({
              items,
              nextCursor: null,
            }))
          : Promise.reject(
              new Error(
                "SearchPicker: pass either `fetcher` or `paginatedFetcher`.",
              ),
            );

      promise
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
          setError(
            err instanceof Error ? err.message : "Couldn't load matches.",
          );
          setResults([]);
          setNextCursor(null);
          setLoading(false);
        });
    },
    [fetcher, paginatedFetcher],
  );

  // Fetch the next page and append. Stable identity — reads live
  // state from `latestRef` so the observer that owns it doesn't get
  // torn down and recreated on every state change.
  const runNextPage = useCallback(() => {
    const {
      query: q,
      nextCursor: cursor,
      loading: isLoading,
      loadingMore: isLoadingMore,
      paginatedFetcher: fetch,
    } = latestRef.current;
    if (!fetch || !cursor || isLoading || isLoadingMore) return;

    // Separate controller — cancelling a first-page fetch shouldn't
    // interrupt a scroll-driven append that started later.
    const controller = new AbortController();
    const gen = generationRef.current;
    setLoadingMore(true);

    fetch(q, cursor, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        if (gen !== generationRef.current) return;
        setResults((prev) => {
          // Dedupe by id — a rapid re-open shouldn't duplicate rows if
          // the same page comes back twice.
          const seen = new Set(prev.map((o) => o.id));
          const merged = [...prev];
          for (const it of page.items) {
            if (!seen.has(it.id)) merged.push(it);
          }
          return merged;
        });
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        if (gen !== generationRef.current) return;
        setLoadingMore(false);
        // Silent failure on the next-page path — the first page is
        // still on screen, so the user can retry by scrolling out and
        // back in. A hard error here would be more noise than signal.
      });
  }, []);

  // Single effect handles open + query changes. First open of a
  // session fires immediately (snappy); subsequent query typing is
  // debounced to 250 ms. The debounce timeout is cleared on unmount /
  // effect re-run so keystrokes don't stack.
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

  // Clean up on close — wipe transient state but keep the value.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      onFocus?.();
    } else {
      setQuery("");
      setResults([]);
      setNextCursor(null);
      setError(null);
      abortRef.current?.abort();
      generationRef.current++;
      openedOnceRef.current = false;
      onBlur?.();
    }
  }

  // One observer per sentinel-mount. `runNextPage` is stable (reads
  // live state via `latestRef`) so React only tears the callback down
  // when the sentinel itself unmounts — i.e. when `nextCursor`
  // becomes null and rendering stops. That keeps us clear of the
  // React-18 pitfall where a ref-callback identity change creates a
  // fresh IntersectionObserver on every render, and each fresh
  // observer fires `observe()` once immediately — causing a
  // fetch-loop.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback(
    (node: HTMLLIElement | null) => {
      // Detach any previous observer whenever the ref-callback runs
      // (mount / unmount). Belt-and-braces: the return-cleanup form
      // is only supported in React 19+, so we can't rely on it.
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (!node || !isPaginated) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            runNextPage();
          }
        },
        // Ancestor is the scrolling `<ul>`; use its clip bounds. A
        // small root-margin arms the trigger slightly before the row
        // is actually on screen so the next page is ready by the
        // time the user reaches it.
        {
          root: node.parentElement,
          threshold: 0,
          rootMargin: "80px 0px",
        },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [isPaginated, runNextPage],
  );

  const filteredResults = excludeIds
    ? results.filter((o) => !excludeIds.has(o.id))
    : results;

  // Shared trigger button — the on-screen field the operator taps.
  // On desktop it lives inside <PopoverTrigger asChild>, which
  // injects its own onClick. On mobile the popover is bypassed
  // entirely, so we manage the click ourselves to open the sheet.
  const trigger = (
    <Button
      id={id}
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      disabled={disabled}
      onClick={isMobile && !disabled ? () => onOpenChange(true) : undefined}
      className={cn(
        // 44px on mobile (Apple HIG touch target), 40px desktop.
        "h-11 w-full justify-between font-normal sm:h-10",
        compact && "h-8 text-xs sm:h-8",
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
  );

  // Shared list body — the search input + results list + sentinels.
  // Rendered inside either the desktop <PopoverContent> or the
  // mobile portal sheet. Layout tokens are surface-specific but the
  // internals (row shape, sentinel wiring, loading footer) are
  // shared verbatim.
  const listBody = (variant: "popover" | "sheet") => (
    <>
      <div
        className={cn(
          "border-b border-border/60",
          variant === "popover" ? "p-2" : "px-3 py-3",
        )}
      >
        <div className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className={cn(
                "absolute top-1/2 -translate-y-1/2 text-muted-foreground",
                variant === "popover"
                  ? "left-2.5 size-3.5"
                  : "left-3 size-4",
              )}
            />
            <Input
              autoFocus={variant === "popover"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to search…"
              // 16px text on the mobile sheet prevents iOS Safari's
              // auto-zoom-on-focus. Popover stays compact.
              className={cn(
                variant === "popover"
                  ? "h-8 pl-8 text-xs"
                  : "h-11 pl-10 text-base",
              )}
            />
            {loading && (
              <Loader2
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 animate-spin text-muted-foreground",
                  variant === "popover"
                    ? "right-2.5 size-3.5"
                    : "right-3 size-4",
                )}
              />
            )}
          </div>
          {variant === "sheet" ? (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close picker"
              className="flex h-11 shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background px-3 text-sm font-medium text-foreground active:bg-muted"
            >
              <X className="size-4" />
              <span>Close</span>
            </button>
          ) : null}
        </div>
      </div>
      <ul
        className={cn(
          "overflow-y-auto overscroll-contain",
          variant === "popover"
            ? "max-h-[320px] py-1"
            : "flex-1",
        )}
        aria-busy={loading}
      >
        {error && (
          <li
            className={cn(
              "px-3 text-center text-destructive",
              variant === "popover"
                ? "py-3 text-xs"
                : "py-6 text-sm",
            )}
          >
            {error}
          </li>
        )}
        {!error && filteredResults.length === 0 && !loading && (
          <li
            className={cn(
              "px-3 text-center text-muted-foreground",
              variant === "popover"
                ? "py-3 text-xs"
                : "py-6 text-sm",
            )}
          >
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
                  onOpenChange(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2 text-left hover:bg-muted/60 active:bg-muted",
                  variant === "popover"
                    ? "items-center gap-2 px-3 py-1.5 text-sm"
                    : "gap-3 border-b border-border/40 px-4 py-3 text-base",
                  isSelected && "bg-muted/40",
                )}
              >
                <Check
                  className={cn(
                    "shrink-0",
                    variant === "popover"
                      ? "size-3.5"
                      : "mt-1 size-4 text-brand",
                    isSelected ? "opacity-100" : "opacity-0",
                  )}
                />
                {renderRow ? (
                  renderRow(o, isSelected)
                ) : variant === "popover" ? (
                  <>
                    {o.code && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {o.code}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.sublabel && (
                      <span className="truncate text-[10px] text-muted-foreground">
                        {o.sublabel}
                      </span>
                    )}
                  </>
                ) : (
                  // Mobile sheet: label on top (bold), code + sublabel
                  // below as muted metadata. Wraps naturally so long
                  // "Cell A3 · Storage Location 42 · Vita Manufacture"
                  // names read without truncation.
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      className={cn(
                        "truncate",
                        isSelected ? "font-semibold" : "font-medium",
                      )}
                    >
                      {o.label}
                    </span>
                    {(o.code || o.sublabel) && (
                      <span className="truncate text-xs text-muted-foreground">
                        {[o.code, o.sublabel].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                )}
              </button>
            </li>
          );
        })}
        {/* Infinite-scroll sentinel — invisible row that the
            IntersectionObserver watches. Only rendered while there's
            a next page. */}
        {isPaginated && nextCursor && !error ? (
          <li ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
        ) : null}
        {loadingMore ? (
          <li
            className={cn(
              "flex items-center justify-center gap-2 text-muted-foreground",
              variant === "popover"
                ? "px-3 py-2 text-[11px]"
                : "px-4 py-4 text-sm",
            )}
          >
            <Loader2
              className={cn(
                "animate-spin",
                variant === "popover" ? "size-3" : "size-4",
              )}
            />
            Loading more…
          </li>
        ) : null}
        {isPaginated &&
        !loading &&
        !loadingMore &&
        !nextCursor &&
        filteredResults.length > 0 ? (
          <li
            className={cn(
              "text-center uppercase tracking-wider text-muted-foreground",
              variant === "popover"
                ? "px-3 py-1.5 text-[10px]"
                : "px-4 py-3 text-[11px]",
            )}
          >
            End of results
          </li>
        ) : null}
      </ul>
    </>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <MobileSearchPickerSheet
          open={open}
          onOpenChange={onOpenChange}
        >
          {listBody("sheet")}
        </MobileSearchPickerSheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        {listBody("popover")}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Full-screen sheet host for the mobile picker variant. Same posture
 * as the country picker's `MobileCountrySheet` — a raw fixed div
 * rendered via createPortal(document.body) so it escapes any wrapping
 * <label>/<form> and covers the whole viewport including the notch
 * inset. Locks body scroll while open; wires an Esc listener for the
 * hardware-keyboard case. The list body + sticky search header +
 * Done bar are supplied by the caller via `children`.
 */
function MobileSearchPickerSheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

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

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-background"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {children}
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
