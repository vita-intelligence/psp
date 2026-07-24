"use client";

import Link from "next/link";
import { HandCoins, Star } from "lucide-react";
import {
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";
import type { CompanyDefaults, VendorPurchaseTerm } from "@/lib/types";

interface Props {
  terms: VendorPurchaseTerm[];
  prefs: CompanyDefaults;
}

/**
 * Read-only projection of every vendor's purchase term for this item,
 * ranked by priority ascending (1 = primary). CRUD lives on the
 * vendor detail page; this table is the buyer's cross-vendor
 * comparison view.
 *
 * The primary row shows a star chip — that's the vendor whose price
 * feeds `item.default_cost` when no PO history exists.
 */
export function ItemPurchaseTermsCard({ terms, prefs }: Props) {
  const primaryRank = terms.length > 0 ? terms[0].priority : null;

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <HandCoins className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">Purchase terms</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {terms.length}
        </span>
      </header>

      <p className="mb-3 text-[11px] text-muted-foreground">
        Vendor-negotiated commercial baselines. Edit these on each
        vendor&rsquo;s detail page. The primary vendor&rsquo;s price
        seeds this item&rsquo;s default cost when no PO history exists.
      </p>

      {terms.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
          No vendors have quoted this item yet. Add purchase terms from
          a vendor detail page after approving them for this item.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Vendor</th>
                <th className="px-3 py-2 text-center font-medium">Priority</th>
                <th className="px-3 py-2 text-left font-medium">
                  Vendor part
                </th>
                <th className="px-3 py-2 text-right font-medium">Lead time</th>
                <th className="px-3 py-2 text-right font-medium">
                  Price / UoM
                </th>
                <th className="px-3 py-2 text-right font-medium">Min qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {terms.map((row) => (
                <tr key={row.uuid}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {row.priority === primaryRank && (
                        <Star
                          className="size-3 fill-amber-500 text-amber-500"
                          aria-label="Primary vendor"
                        />
                      )}
                      {row.vendor?.uuid ? (
                        <Link
                          href={`/procurement/vendors/${row.vendor.uuid}`}
                          className="block group"
                        >
                          <p className="truncate text-sm font-medium underline-offset-2 group-hover:underline">
                            {row.vendor.name}
                          </p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">
                            {row.vendor.code ?? `#${row.vendor_id}`}
                          </p>
                        </Link>
                      ) : (
                        <p className="truncate text-sm font-medium">
                          {`Vendor #${row.vendor_id}`}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-sm">
                    {row.priority}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {row.vendor_part_no ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-muted-foreground">
                    {row.lead_time_days != null
                      ? `${row.lead_time_days} d`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm font-semibold">
                    {formatCompanyMoney(row.price, prefs, {
                      currency_code: row.currency_code,
                    })}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-muted-foreground">
                    {row.min_quantity
                      ? `${formatCompanyNumber(row.min_quantity, prefs)} ${row.min_quantity_uom ?? ""}`.trim()
                      : "—"}
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
