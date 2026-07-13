"use client";

import Link from "next/link";
import { Receipt } from "lucide-react";
import type { VendorItemPrice } from "@/lib/types";
import { formatCompanyDate, formatCompanyMoney } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";

interface Props {
  rows: VendorItemPrice[];
}

/**
 * Read-only projection of the `vendor_item_prices` cache. Each row is
 * the most-recent paid price the company actually paid this vendor
 * for one (item, currency) pair, with a link back to the PO line
 * that set it.
 *
 * Maintained server-side by the PO receive flow — never edited from
 * this card. If the prices look stale, the answer is "buy something
 * from them again", not a manual override.
 */
export function VendorPriceHistoryCard({ rows }: Props) {
  const prefs = useFormatPrefs();

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <Receipt className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">Price history</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {rows.length}
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
          No purchases received from this vendor yet. The first PO line we
          receive will seed the cache.
        </p>
      ) : (
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
                        href={`/settings/items/${row.item.uuid}`}
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
      )}
    </section>
  );
}
