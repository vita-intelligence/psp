"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Clock,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  Search,
  Truck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import type {
  DispatchPickupPage,
  DispatchPickupRow,
} from "@/lib/shipments/mobile-server";

interface Props {
  initialPage: DispatchPickupPage;
  company: FormatPrefs | null;
}

// Debounce delay for search-box changes. Long enough that the user
// stops typing before we fire a fresh keyset scan, short enough that
// the list feels live. Matches the desktop shipments list.
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Keyset-paginated pickup queue. The SSR helper drops the first page
 * into ``initialPage``; every subsequent page fetches via the same
 * ``/api/m/dispatch-pickups`` endpoint with the previous page's
 * ``next_cursor`` threaded through.
 *
 * Scroll-based auto-loading via ``IntersectionObserver`` on a sentinel
 * ``<li />`` after the last row — no infinite-scroll library, no
 * scroll-position math. When the sentinel enters the viewport we fire
 * one page fetch; loading state gates concurrent triggers so a fast
 * scroll doesn't spawn duplicate requests.
 *
 * Search resets the cursor + list — a fresh keyset scan against a
 * different filter. Debounced so keystrokes don't burn requests.
 */
export function MobileDispatchPickupList({ initialPage, company }: Props) {
  const [items, setItems] = useState<DispatchPickupRow[]>(initialPage.items);
  const [cursor, setCursor] = useState<string | null>(initialPage.next_cursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Track the search string the current items reflect. When a new
  // debounced value diverges we reset the list + refetch page 1.
  const activeSearchRef = useRef<string>("");
  const inFlightRef = useRef<AbortController | null>(null);

  // Debounce search into a stable value; the search-effect below
  // watches this, not the raw keystroke state.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const fetchPage = useCallback(
    async (opts: { cursor: string | null; search: string; reset: boolean }) => {
      // Cancel any in-flight page (from a rapid scroll → new search) so
      // the older response can't overwrite the newer one.
      inFlightRef.current?.abort();
      const ctl = new AbortController();
      inFlightRef.current = ctl;

      setLoading(true);
      setError(null);
      const qs = new URLSearchParams();
      if (opts.cursor) qs.set("cursor", opts.cursor);
      if (opts.search) qs.set("search", opts.search);
      try {
        const res = await fetch(`/api/m/dispatch-pickups?${qs.toString()}`, {
          cache: "no-store",
          signal: ctl.signal,
        });
        if (!res.ok) {
          setError(`Couldn't load the queue (${res.status}).`);
          return;
        }
        const body = (await res.json()) as DispatchPickupPage;
        setItems((prev) => (opts.reset ? body.items : [...prev, ...body.items]));
        setCursor(body.next_cursor);
        activeSearchRef.current = opts.search;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Network blip.");
      } finally {
        if (inFlightRef.current === ctl) inFlightRef.current = null;
        setLoading(false);
      }
    },
    [],
  );

  // Search changed → reset + refetch page 1. Skip the very first run
  // (initialPage came from SSR against no search) to avoid a
  // redundant client-side fetch on mount.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (debouncedSearch === activeSearchRef.current) return;
    void fetchPage({ cursor: null, search: debouncedSearch, reset: true });
  }, [debouncedSearch, fetchPage]);

  // Manual refresh — pulls fresh page 1 against the active search.
  const refresh = useCallback(() => {
    void fetchPage({ cursor: null, search: activeSearchRef.current, reset: true });
  }, [fetchPage]);

  // Infinite-scroll sentinel. Fires the next page fetch when the
  // sentinel scrolls into view. ``rootMargin`` starts loading a bit
  // before the actual bottom so the user doesn't see a blank frame.
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!cursor) return; // No more pages.
    if (loading) return;

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        void fetchPage({ cursor, search: activeSearchRef.current, reset: false });
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [cursor, loading, fetchPage]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 border-b border-border/60 bg-background px-3 py-3">
        <Link
          href="/m"
          className="rounded-md p-1.5 text-muted-foreground active:bg-muted"
          aria-label="Back to home"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs uppercase tracking-wider text-muted-foreground">
            Dispatch pickup
          </p>
          <p className="truncate text-sm font-semibold">
            {items.length > 0
              ? `${items.length}${cursor ? "+" : ""} waiting`
              : loading
                ? "Loading…"
                : "Nothing to load"}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh"
          className="rounded-md p-2 text-muted-foreground active:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </button>
      </header>

      <div className="border-b border-border/60 bg-background px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Recipient, waybill, plate, lot batch…"
            className="h-10 w-full rounded-md border border-border/60 bg-background pl-8 pr-8 text-sm outline-none focus:ring-2 focus:ring-brand/30"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground active:bg-muted"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      <main className="flex-1 space-y-3 px-3 py-4">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        {items.length === 0 && !loading ? (
          <div className="rounded-lg border border-dashed border-border/60 px-4 py-12 text-center">
            <Truck className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">Nothing ready right now</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Shipments show up here once the coordinator hits Mark
              ready on the shipment paperwork.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((row) => (
              <PickupRow key={row.uuid} row={row} company={company} />
            ))}
            {/* Sentinel — invisible; the IntersectionObserver above
             *  fires the next page fetch when this scrolls into view.
             *  Rendered only when there is a next page to load. */}
            {cursor && (
              <li
                ref={sentinelRef}
                aria-hidden="true"
                className="flex items-center justify-center py-4 text-muted-foreground"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                    <span className="text-xs">Loading more…</span>
                  </>
                ) : (
                  <span className="text-xs">Scroll to load more</span>
                )}
              </li>
            )}
          </ul>
        )}
      </main>
    </div>
  );
}

function PickupRow({
  row,
  company,
}: {
  row: DispatchPickupRow;
  company: FormatPrefs | null;
}) {
  const cityCountry = [row.ship_to_city, row.ship_to_country]
    .filter(Boolean)
    .join(" · ");

  // Same-file datetime formatting: company-aware date + explicit
  // ``HH:mm``. Matches the shipment detail card so the operator sees
  // consistent formatting everywhere.
  const planned = formatPlannedShipAt(row.planned_ship_at, company);

  const qtyLabel = row.qty
    ? `${row.qty}${row.unit_symbol ? ` ${row.unit_symbol}` : ""}`
    : null;

  return (
    <li>
      <Link
        href={`/m/shipments/${encodeURIComponent(row.uuid)}/dispatch`}
        className="block rounded-lg border border-border/60 bg-card p-3 active:bg-muted"
      >
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-brand/10 text-brand">
            <Truck className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {row.recipient_name?.trim() || row.customer_name || "—"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              <span className="font-mono">{row.code}</span>
              {row.item_name ? ` · ${row.item_name}` : ""}
            </p>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="size-3 shrink-0" />
            <span className="truncate">{planned ?? "No planned time"}</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <MapPin className="size-3 shrink-0" />
            <span className="truncate">{cityCountry || "—"}</span>
          </div>
          {qtyLabel && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Package className="size-3 shrink-0" />
              <span className="truncate">
                {qtyLabel}
                {row.lot_code ? (
                  <>
                    {" · "}
                    <span className="font-mono">{row.lot_code}</span>
                  </>
                ) : null}
              </span>
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

function formatPlannedShipAt(
  iso: string | null,
  company: FormatPrefs | null,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = formatCompanyDate(iso, company);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
  return `${date} · ${time}`;
}
