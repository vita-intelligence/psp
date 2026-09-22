"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  FormSubmissionRow,
  SubmissionFilters,
} from "@/lib/sessions/types";
import type { FormTrigger } from "@/lib/forms/types";
import { fetchFormSubmissions } from "@/lib/sessions/client";
import { SubmissionRow } from "./submission-row";

interface Props {
  /** Server-fetched first slice — the RSC preloads page 1 so the
   *  operator never sees an empty state on first paint. */
  initialItems: FormSubmissionRow[];
  initialNextCursor: string | null;
  pageSize: number;
}

/**
 * Cursor-paginated feed. IntersectionObserver on a sentinel at the
 * bottom of the list appends the next page while there is one; a
 * "Load more" button is rendered as an accessible fallback for
 * keyboard users and for cases where the sentinel misses (e.g. a
 * short viewport that never scrolls).
 *
 * URL search params (workstation_uuid, from, to, …) are read fresh on
 * every fetch so a filter change in the parent FilterBar
 * automatically resets the feed to page 1.
 */
export function SubmissionsFeed({
  initialItems,
  initialNextCursor,
  pageSize,
}: Props) {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<FormSubmissionRow[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the feed whenever the URL query changes (filter update).
  // `searchParams.toString()` is deterministic and stable so this
  // effect only re-runs on real filter changes.
  const filtersKey = searchParams.toString();
  useEffect(() => {
    setItems(initialItems);
    setCursor(initialNextCursor);
    setError(null);
    // Depend on the RSC-provided slice so a server refetch (via
    // router.replace) surfaces the new first page here without an
    // extra client roundtrip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, initialItems, initialNextCursor]);

  const filtersFromUrl: SubmissionFilters = {
    workstation_uuid: searchParams.get("workstation_uuid") ?? undefined,
    equipment_uuid: searchParams.get("equipment_uuid") ?? undefined,
    form_template_uuid: searchParams.get("form_template_uuid") ?? undefined,
    workstation_session_uuid:
      searchParams.get("workstation_session_uuid") ?? undefined,
    submitted_by_id: searchParams.get("submitted_by_id") ?? undefined,
    submitted_by_uuid: searchParams.get("submitted_by_uuid") ?? undefined,
    trigger: (searchParams.get("trigger") ?? undefined) as
      | FormTrigger
      | undefined,
    activity_kind: (searchParams.get("activity_kind") ?? undefined) as
      | SubmissionFilters["activity_kind"]
      | undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    limit: pageSize,
  };

  const abortRef = useRef<AbortController | null>(null);
  const loadMore = useCallback(() => {
    if (!cursor || loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    fetchFormSubmissions(filtersFromUrl, cursor, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems((prev) => {
          const seen = new Set(prev.map((r) => r.uuid));
          const merged = [...prev];
          for (const r of page.items) if (!seen.has(r.uuid)) merged.push(r);
          return merged;
        });
        setCursor(page.next_cursor);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Couldn't load more.");
        setLoading(false);
      });
  }, [cursor, loading, filtersFromUrl]);

  // Sentinel-driven auto-load. Stable identity so the observer isn't
  // rebuilt on every render (which would cause a fetch-loop).
  const latestRef = useRef({ cursor, loading });
  latestRef.current = { cursor, loading };

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (!node) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            const { cursor: c, loading: l } = latestRef.current;
            if (c && !l) loadMore();
          }
        },
        { rootMargin: "400px 0px" },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [loadMore],
  );

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        No submissions match the current filters. Once workers fill forms on
        the kiosk they will land here automatically.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2">
        {items.map((row) => (
          <SubmissionRow key={row.uuid} row={row} />
        ))}
      </div>

      {cursor ? (
        <>
          <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadMore}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  Loading…
                </>
              ) : (
                "Load more"
              )}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-center text-[11px] uppercase tracking-wider text-muted-foreground">
          End of history
        </p>
      )}

      {error ? (
        <p className="text-center text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
