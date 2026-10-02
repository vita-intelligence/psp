"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Receipt, Search, X } from "lucide-react";
import type { Vendor, VendorItemPrice } from "@/lib/types";
import { formatCompanyDate, formatCompanyMoney } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import { PageControls } from "@/components/forms/page-controls";

interface Props {
  readonly vendor: Vendor;
  /** SSR seed — first page of rows the vendor detail page fetched
   *  server-side. Used as the initial render so the card doesn't
   *  flash a loading spinner on cold loads. */
  readonly rows: VendorItemPrice[];
}

const PAGE_SIZE = 25;
const DEBOUNCE_MS = 250;

/**
 * Read-only projection of the `vendor_item_prices` cache. Each row is
 * the most-recent paid price the company actually paid this vendor
 * for one (item, currency) pair, with a link back to the PO line
 * that set it.
 *
 * Maintained server-side by the PO receive flow — never edited from
 * this card. Searchable + paginated so a vendor with thousands of
 * (item, currency) rows stays navigable.
 */
export function VendorPriceHistoryCard({ vendor, rows: seedRows }: Props) {
  const prefs = useFormatPrefs();

  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<VendorItemPrice[]>(seedRows);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setAppliedSearch(searchInput.trim());
      setPage(0);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const fetchPage = useCallback(
    async ({
      pageIndex,
      search,
      signal,
    }: {
      pageIndex: number;
      search: string;
      signal?: AbortSignal;
    }) => {
      setLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(pageIndex * PAGE_SIZE),
        });
        if (search) params.set("search", search);
        const res = await fetch(
          `/api/vendors/${vendor.uuid}/price-history?${params.toString()}`,
          { signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as {
          items: VendorItemPrice[];
          total: number;
          has_more: boolean;
        };
        setRows(body.items);
        setTotal(body.total);
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return;
        setLoadError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [vendor.uuid],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void fetchPage({ pageIndex: page, search: appliedSearch, signal: ctrl.signal });
    return () => ctrl.abort();
  }, [fetchPage, page, appliedSearch]);

  const totalDisplay = total ?? seedRows.length;
  const firstRow = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastRow = total === 0 ? 0 : page * PAGE_SIZE + rows.length;

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <Receipt className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">Price history</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {totalDisplay}
        </span>
      </header>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Filter by item name, SKU, or barcode…"
          className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-8 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => setSearchInput("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {loadError ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {loadError} —{" "}
          <button
            type="button"
            onClick={() =>
              void fetchPage({ pageIndex: page, search: appliedSearch })
            }
            className="underline"
          >
            retry
          </button>
        </p>
      ) : loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
          {appliedSearch
            ? `No price history matches "${appliedSearch}".`
            : "No purchases received from this vendor yet. The first PO line we receive will seed the cache."}
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-md border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Last paid</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Qty purchased
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Paid on</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((row) => (
                  <tr key={row.uuid}>
                    <td className="px-3 py-2">
                      {row.item?.uuid ? (
                        <Link
                          href={`/production/items/${row.item.uuid}`}
                          className="block group"
                        >
                          <p className="truncate text-sm font-medium underline-offset-2 group-hover:underline">
                            {row.item.name}
                          </p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">
                            {row.item.code ?? `#${row.item_id}`}
                          </p>
                        </Link>
                      ) : (
                        <>
                          <p className="truncate text-sm font-medium">
                            {`Item #${row.item_id}`}
                          </p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">
                            {`#${row.item_id}`}
                          </p>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm font-semibold">
                      {formatCompanyMoney(row.unit_price, prefs, {
                        currency_code: row.currency_code,
                      })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm text-muted-foreground">
                      {row.qty_purchased}
                    </td>
                    <td className="px-3 py-2 text-right text-sm text-muted-foreground">
                      {formatCompanyDate(row.last_paid_at, prefs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total !== null && total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                Showing {firstRow}-{lastRow} of {total}
              </span>
              <PageControls
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                disabled={loading}
                onPageChange={setPage}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
