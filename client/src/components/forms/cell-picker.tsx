"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { StockCellPickerRow } from "@/lib/types";

interface CellPickerProps {
  /** Currently selected cell id (string for select-style ergonomics).
   *  Empty string = nothing selected. */
  value: string;
  /** Optional pre-resolved breadcrumb for the selected cell so the
   *  trigger button can render straight away on edit views without
   *  waiting for a fetch. */
  selected?: StockCellPickerRow | null;
  /** Warehouse filter — server narrows results to this site. */
  warehouseId?: number | null;
  /** When set, server filters to cells whose effective tags ⊇
   *  this item's storage_tags (combined with `matchTags`). */
  itemId?: number | null;
  matchTags?: boolean;
  disabled?: boolean;
  placeholder?: string;
  onChange: (id: string, row: StockCellPickerRow | null) => void;
}

interface PickerResponse {
  items: StockCellPickerRow[];
  next_cursor: string | null;
}

/**
 * Searchable, lazy-loaded cell picker. The list of cells in a real
 * warehouse can run to hundreds of thousands — we never hold more
 * than one page (≤50 rows) in memory. Type-to-filter debounces on
 * 200 ms then hits /api/stock/cells with site + item-tag filters
 * applied server-side.
 *
 * The selected cell's breadcrumb persists in the trigger button
 * even after the search clears so the user can always see what
 * they've picked.
 */
export function CellPicker({
  value,
  selected,
  warehouseId,
  itemId,
  matchTags = true,
  disabled,
  placeholder = "Pick a cell…",
  onChange,
}: CellPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<StockCellPickerRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stash the most recent selection inside the picker so the trigger
  // button keeps its breadcrumb across search clears. Parent can
  // still seed via `selected` prop on first render.
  const [latestSelected, setLatestSelected] = useState<StockCellPickerRow | null>(
    selected ?? null,
  );
  useEffect(() => {
    if (selected) setLatestSelected(selected);
  }, [selected]);

  // Debounce the search input.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Fetch when the popover opens or the search / filters change.
  // We refetch on warehouse/item/match changes regardless of open
  // because they're sticky filters above the picker.
  const fetchKey = useMemo(
    () =>
      JSON.stringify({
        q: debounced,
        w: warehouseId ?? null,
        i: itemId ?? null,
        m: matchTags,
      }),
    [debounced, warehouseId, itemId, matchTags],
  );

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams();
    qs.set("limit", "50");
    if (debounced.trim()) qs.set("search", debounced.trim());
    if (warehouseId) qs.set("warehouse_id", String(warehouseId));
    if (itemId) {
      qs.set("item_id", String(itemId));
      qs.set("match_tags", matchTags ? "true" : "false");
    }

    fetch(`/api/stock/cells?${qs.toString()}`, {
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { detail?: string }
            | null;
          throw new Error(body?.detail ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as PickerResponse;
      })
      .then((data) => {
        if (ctrl.signal.aborted) return;
        setResults(data.items);
        setHasMore(!!data.next_cursor);
        setLoading(false);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Couldn't load cells.");
        setLoading(false);
      });

    return () => ctrl.abort();
    // fetchKey intentionally excluded from deps — `open` triggers an
    // initial fetch and the other deps invalidate it. JSON.stringify
    // tied to fetchKey keeps the comparison cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fetchKey]);

  function pick(row: StockCellPickerRow) {
    onChange(String(row.id), row);
    setLatestSelected(row);
    setOpen(false);
    setQuery("");
  }

  function clear(e: React.SyntheticEvent) {
    e.stopPropagation();
    e.preventDefault();
    onChange("", null);
    setLatestSelected(null);
  }

  const triggerLabel = latestSelected ? (
    <span className="flex flex-col text-left">
      <span className="truncate text-xs">
        {latestSelected.warehouse.name} ·{" "}
        {latestSelected.storage_location.code ??
          latestSelected.storage_location.name}
      </span>
      <span className="truncate text-[11px] text-muted-foreground">
        {latestSelected.floor.name} · Level {latestSelected.ordinal + 1}
        {latestSelected.name ? ` — ${latestSelected.name}` : ""}
      </span>
    </span>
  ) : (
    <span className="text-muted-foreground">{placeholder}</span>
  );

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-sm transition-colors",
            "hover:bg-muted/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <span className="min-w-0 flex-1 overflow-hidden">{triggerLabel}</span>
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
            {value && !disabled && (
              <span
                role="button"
                tabIndex={0}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={clear}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") clear(e);
                }}
                className="cursor-pointer rounded p-0.5 hover:text-foreground"
                aria-label="Clear selection"
              >
                <X className="size-3.5" />
              </span>
            )}
            <ChevronDown className="size-3.5" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          <Search className="size-3.5 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by code, name, warehouse…"
            className="h-7 border-0 bg-transparent px-0 text-xs focus-visible:ring-0"
          />
          {loading && (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="max-h-[280px] overflow-y-auto py-1">
          {error ? (
            <p className="px-3 py-3 text-xs text-destructive">{error}</p>
          ) : results.length === 0 && !loading ? (
            <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
              {debounced.trim().length > 0
                ? "No cells match. Try a different search or widen the Site filter."
                : "Start typing — or browse with no search to see the first 50 cells."}
            </p>
          ) : (
            <ul>
              {results.map((row) => {
                const active = String(row.id) === value;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => pick(row)}
                      className={cn(
                        "flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors",
                        "hover:bg-muted/60",
                        active && "bg-primary/[0.08]",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 inline-flex size-3 shrink-0 items-center justify-center rounded-sm border",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border",
                        )}
                      >
                        {active && <Check className="size-2.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          {row.warehouse.name} ·{" "}
                          {row.storage_location.code ??
                            row.storage_location.name}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {row.floor.name} · Level {row.ordinal + 1}
                          {row.name ? ` — ${row.name}` : ""}
                        </span>
                        {row.effective_tags.length > 0 && (
                          <span className="mt-0.5 flex flex-wrap gap-0.5">
                            {row.effective_tags.slice(0, 4).map((t) => (
                              <span
                                key={t}
                                className="inline-flex items-center rounded-full bg-foreground/10 px-1.5 py-0.5 font-mono text-[9px]"
                              >
                                {t}
                              </span>
                            ))}
                            {row.effective_tags.length > 4 && (
                              <span className="text-[9px] text-muted-foreground">
                                +{row.effective_tags.length - 4}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {hasMore && (
          <p className="border-t border-border/60 px-3 py-2 text-center text-[10px] text-muted-foreground">
            Showing first {results.length} — type to refine.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
