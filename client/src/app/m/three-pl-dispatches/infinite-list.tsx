"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2, Search, X } from "lucide-react";

import type { ThreePLListPage } from "@/lib/three-pl/types";

interface Props<T> {
  /** First page rendered by the server component. Rehydrates the
   *  browser without a client-side fetch on initial paint. */
  initialItems: T[];
  initialNextCursor: string | null;
  /** Called for every subsequent fetch — new search, next page. */
  fetchPage: (params: {
    q: string;
    cursor: string | null;
  }) => Promise<ThreePLListPage<T>>;
  /** Row renderer. `key` handling is up to this callback so it can
   *  use the item's stable uuid. */
  renderItem: (item: T) => React.ReactNode;
  emptyState: React.ReactNode;
  searchPlaceholder: string;
  /** Whitespace-preserving key for the searchbar's stored value so
   *  the input reopens with the same text after a route change back
   *  to this tab. */
  storageKey: string;
}

const DEBOUNCE_MS = 250;
const SENTINEL_ROOT_MARGIN_PX = 400;

/**
 * Generic search + infinite-scroll list shared by all mobile 3PL
 * hub tabs. Owns:
 *
 *   * a sticky search input (case-insensitive substring — server
 *     matches item name / lot code / customer / reference)
 *   * a debounced re-fetch when the query changes
 *   * an IntersectionObserver sentinel that pulls the next page
 *     when the user is ~400 px from the bottom
 *   * silent-degrade for network hiccups so a dropped fetch never
 *     wipes what's already rendered
 *
 * State is per-instance: switching tabs unmounts + remounts, which
 * intentionally resets scroll + search so each tab feels fresh.
 * The initial search text is persisted in sessionStorage so a quick
 * detour to a row's detail page and back keeps context.
 */
export function InfiniteList<T extends { uuid: string }>({
  initialItems,
  initialNextCursor,
  fetchPage,
  renderItem,
  emptyState,
  searchPlaceholder,
  storageKey,
}: Props<T>) {
  const [q, setQ] = useState<string>(() => readStoredQuery(storageKey));
  const [items, setItems] = useState<T[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialNextCursor);
  const [phase, setPhase] = useState<"idle" | "loading" | "error">("idle");
  const [initialised, setInitialised] = useState<boolean>(q === "");
  const requestSeqRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Persist the search string across route changes so a tap into a
  // row + back button doesn't wipe the operator's query.
  useEffect(() => {
    writeStoredQuery(storageKey, q);
  }, [q, storageKey]);

  // Debounced re-fetch on query change. Skipped on the very first
  // paint when q is empty AND initialItems already covers what SSR
  // returned — the seed page is fine as-is.
  useEffect(() => {
    if (!initialised) {
      // Seed page already covers q="" render — mark initialised and
      // wait for real user input before firing a fetch.
      setInitialised(true);
      if (q === "") return;
    }

    const trimmed = q.trim();
    const seq = ++requestSeqRef.current;
    setPhase("loading");

    const timer = window.setTimeout(async () => {
      try {
        const page = await fetchPage({ q: trimmed, cursor: null });
        // Discard if a newer request kicked off while we were waiting
        // (fast typing = many overlapping fetches, only the last one
        // matters).
        if (seq !== requestSeqRef.current) return;
        setItems(page.items);
        setCursor(page.next_cursor);
        setPhase("idle");
      } catch {
        if (seq !== requestSeqRef.current) return;
        setPhase("error");
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
    // fetchPage identity is stable per tab (parent memoises); no need
    // to include it explicitly — its inclusion here would just churn
    // the effect. Same story for storageKey / initialised.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // IntersectionObserver — fire the next-page fetch when the sentinel
  // slides into view (or within ~400 px of the viewport bottom, so
  // there's headroom for the request to land before the operator
  // reaches the actual bottom).
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || cursor === null || phase === "loading") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) return;
        void loadMore();
      },
      { rootMargin: `${SENTINEL_ROOT_MARGIN_PX}px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, phase]);

  const loadMore = useCallback(async () => {
    if (cursor === null || phase === "loading") return;
    const seq = ++requestSeqRef.current;
    setPhase("loading");
    try {
      const page = await fetchPage({ q: q.trim(), cursor });
      if (seq !== requestSeqRef.current) return;
      setItems((prev) => appendUnique(prev, page.items));
      setCursor(page.next_cursor);
      setPhase("idle");
    } catch {
      if (seq !== requestSeqRef.current) return;
      setPhase("error");
    }
  }, [cursor, phase, q, fetchPage]);

  const clearSearch = useCallback(() => setQ(""), []);

  const showEmpty = useMemo(
    () => items.length === 0 && phase !== "loading",
    [items.length, phase],
  );

  return (
    <div className="space-y-3">
      <div className="sticky top-[calc(env(safe-area-inset-top)+7.75rem)] z-10 -mx-3 border-b border-border/60 bg-background/95 px-3 py-2 backdrop-blur">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-label={searchPlaceholder}
            className="block h-10 w-full rounded-md border border-border/60 bg-background pl-8 pr-9 text-base outline-none focus:border-brand"
          />
          {q ? (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      {showEmpty ? emptyState : items.map((item) => renderItem(item))}

      {/* Sentinel — sits at the bottom of the list. When it enters
          the viewport the observer above fires loadMore(). Only
          rendered when we still know there's a next page. */}
      {cursor !== null && (
        <div
          ref={sentinelRef}
          className="flex items-center justify-center py-4 text-xs text-muted-foreground"
        >
          {phase === "loading" ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" />
              Loading…
            </span>
          ) : phase === "error" ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              className="rounded-full border border-border/60 px-3 py-1 text-xs font-medium active:bg-muted"
            >
              Tap to retry
            </button>
          ) : (
            <span>Scroll for more</span>
          )}
        </div>
      )}
      {cursor === null && items.length > 0 && phase !== "loading" && (
        <p className="pt-2 text-center text-[11px] text-muted-foreground">
          End of list
        </p>
      )}
      {phase === "error" && cursor === null && (
        <p className="pt-2 text-center text-[11px] text-destructive">
          Couldn&rsquo;t update — check connection and try again.
        </p>
      )}
    </div>
  );
}

// Append incoming items to the tail, dropping anything already in
// the list. The server keyset cursor shouldn't repeat rows in
// practice, but a fast operator flipping between search terms can
// briefly stitch two overlapping windows together — dedupe by uuid
// so React's key warnings don't fire.
function appendUnique<T extends { uuid: string }>(prev: T[], next: T[]): T[] {
  if (next.length === 0) return prev;
  const seen = new Set(prev.map((x) => x.uuid));
  const merged = [...prev];
  for (const item of next) {
    if (!seen.has(item.uuid)) merged.push(item);
  }
  return merged;
}

function readStoredQuery(storageKey: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

function writeStoredQuery(storageKey: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(storageKey, value);
    else window.sessionStorage.removeItem(storageKey);
  } catch {
    // Storage blocked (private mode etc) — no big deal.
  }
}
