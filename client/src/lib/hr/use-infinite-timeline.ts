"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Envelope every timeline endpoint returns — the FE contract mirrors
 * `Backend.ListQueries.paginate/5`.
 */
export interface TimelinePage<T> {
  items: T[];
  next_cursor: string | null;
}

interface UseInfiniteTimelineOpts<T> {
  /** Initial items rendered by the server component. Kept as-is on
   *  first render so the page never flashes. */
  initialItems: T[];
  /** Server's next_cursor from the same first-page fetch. `null`
   *  means "no more pages" — the sentinel stays disabled. */
  initialCursor: string | null;
  /**
   * Async fetch of a single page. Given a cursor, return the next
   * page envelope. The hook owns retry / de-dup / stopping conditions.
   */
  fetchPage: (cursor: string) => Promise<TimelinePage<T>>;
}

interface UseInfiniteTimelineReturn<T> {
  items: T[];
  /** Attach to a sentinel `<div>` at the bottom of the list — the
   *  IntersectionObserver watches this. */
  sentinelRef: (node: HTMLElement | null) => void;
  loading: boolean;
  /** `null` once the last page has been served — the caller renders
   *  "End of history · N total" when this flips. */
  cursor: string | null;
  /** Non-null when the most recent fetch failed. The list keeps what
   *  it has and shows a retry button. */
  error: string | null;
  retry: () => void;
}

/**
 * Shared infinite-scroll harness for the three HR timelines
 * (reputation events, wages, sessions) — and any future keyset-paginated
 * feed that needs the same shape.
 *
 * Why one hook: the three pages differ only in shape of the row and the
 * URL they hit. Pagination mechanics — IntersectionObserver setup,
 * in-flight guard against double-fetches, cursor stop condition,
 * transient error surface — are identical. A shared hook keeps the
 * three page components thin (mostly presentation) and the pagination
 * behaviour uniform: no drift between "reputation loads at 90% scroll"
 * vs "wages loads at 100%".
 *
 * The sentinel is registered via a callback ref so consumers can render
 * it conditionally (e.g. hide when `cursor === null` — the IO won't
 * fire against a detached node).
 */
export function useInfiniteTimeline<T>({
  initialItems,
  initialCursor,
  fetchPage,
}: UseInfiniteTimelineOpts<T>): UseInfiniteTimelineReturn<T> {
  const [items, setItems] = useState<T[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs so the observer callback never closes over a stale value —
  // IntersectionObserver only mounts once and would otherwise keep the
  // first render's cursor forever.
  const cursorRef = useRef(cursor);
  const loadingRef = useRef(loading);
  const errorRef = useRef(error);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  useEffect(() => {
    errorRef.current = error;
  }, [error]);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelNodeRef = useRef<HTMLElement | null>(null);

  const loadNext = useCallback(async () => {
    // De-dup: sentinel can fire while a fetch is in flight (React
    // batches state, IO fires per frame). One page at a time.
    if (loadingRef.current) return;
    // Stop conditions — no cursor means we've served the tail; a
    // recorded error keeps the button visible instead of hammering.
    if (!cursorRef.current) return;
    if (errorRef.current) return;

    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(cursorRef.current);
      setItems((prev) => prev.concat(page.items));
      setCursor(page.next_cursor);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Couldn't load the next page.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  // Callback ref for the sentinel — lets the parent conditionally
  // render it. Rebuilds the IO whenever the node changes.
  const sentinelRef = useCallback(
    (node: HTMLElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      sentinelNodeRef.current = node;
      if (!node) return;

      const io = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry?.isIntersecting) return;
          void loadNext();
        },
        {
          // Preload a viewport ahead so scrolling feels seamless —
          // when the sentinel is within ~600px of the fold the next
          // page fetch fires.
          rootMargin: "600px 0px",
          threshold: 0,
        },
      );
      io.observe(node);
      observerRef.current = io;
    },
    [loadNext],
  );

  // Clean up on unmount so a route change doesn't leak the observer.
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  const retry = useCallback(() => {
    setError(null);
    void loadNext();
  }, [loadNext]);

  return { items, sentinelRef, loading, cursor, error, retry };
}
