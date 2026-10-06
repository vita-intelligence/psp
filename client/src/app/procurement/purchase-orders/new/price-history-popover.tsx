"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { History, Loader2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface PriceHistoryEntry {
  vendor_id: number;
  vendor_uuid: string;
  vendor_name: string;
  unit_price: string | null;
  currency_code: string | null;
  qty: string | null;
  paid_at: string | null;
  po_uuid: string | null;
  po_code: string | null;
}

interface PriceHistoryResponse {
  entries: PriceHistoryEntry[];
  /** `"po_history"` = pulled from real PO lines; `"vendor_cache"` =
   *  fallback to the cached last-paid table (no PO history yet);
   *  `"none"` = item couldn't be resolved. The badge communicates
   *  which source the operator is looking at so a vendor-cache row
   *  doesn't look like a confirmed PO. */
  source: "po_history" | "vendor_cache" | "none";
}

/**
 * Lazy per-item price-history popover for the PO wizard. Fetches on
 * first open (then caches locally so a re-open is instant) and
 * renders a compact table of recent prices across vendors. Pulls
 * from the backend ``GET /api/items/:uuid/price-history`` which
 * prefers real PO-line history and falls back to the cached
 * ``vendor_item_prices`` rows for tenants with no POs yet.
 */
export function PriceHistoryPopover({
  itemUuid,
  itemName,
}: {
  itemUuid: string;
  itemName: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PriceHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/items/${encodeURIComponent(itemUuid)}/price-history?limit=15`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as PriceHistoryResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [itemUuid]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Lazy-fetch the first time the popover opens — operator may
    // never click, no reason to spam the BE.
    if (next && data === null && !loading) {
      void load();
    }
  }

  const entries = data?.entries ?? [];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
          title="Recent paid prices for this item"
        >
          <History className="size-3" />
          History
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <header className="border-b border-border/60 px-3 py-2">
          <p className="text-[11px] font-semibold">Recent prices</p>
          <p className="truncate text-[10px] text-muted-foreground">
            {itemName}
          </p>
          {data?.source === "vendor_cache" && (
            <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
              No PO history yet — showing cached last-paid per vendor.
            </p>
          )}
        </header>

        {loading && (
          <div className="flex items-center justify-center px-3 py-6 text-xs text-muted-foreground">
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            Loading…
          </div>
        )}

        {!loading && error && (
          <div className="px-3 py-4 text-xs text-destructive">
            Couldn&apos;t load: {error}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground">
            No past prices recorded for this item.
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-background text-[9px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5">Vendor</th>
                  <th className="px-3 py-1.5 text-right">Price</th>
                  <th className="px-3 py-1.5 text-right">Qty</th>
                  <th className="px-3 py-1.5">Date</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr
                    key={`${e.vendor_id}-${e.paid_at ?? i}-${e.po_uuid ?? ""}`}
                    className="border-t border-border/40"
                  >
                    <td className="px-3 py-1.5">
                      <Link
                        href={`/vendors/${encodeURIComponent(e.vendor_uuid)}`}
                        className="truncate hover:underline"
                      >
                        {e.vendor_name}
                      </Link>
                      {e.po_code && (
                        <p className="text-[9px] text-muted-foreground">
                          {e.po_code}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {e.unit_price
                        ? `${e.currency_code ?? ""} ${e.unit_price}`.trim()
                        : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                      {e.qty ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {e.paid_at ? e.paid_at.slice(0, 10) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
