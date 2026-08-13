import Link from "next/link";
import { AlertTriangle, Clock, PackageOpen } from "lucide-react";
import type { ParkedAtProductionRow } from "@/lib/stock/server";
import { fetchParkedAtProduction } from "@/lib/stock/server";
import type { CompanyDefaults } from "@/lib/types";
import { formatCompanyDate, formatCompanyNumber } from "@/lib/format/company";

/**
 * "Parked at production" alert card. Two rows in one visual block:
 *   * ``stranded`` — ingredients kept at production_feed cells for
 *     more than N hours (default 24) with no live MO booking. The
 *     reason to keep them is spent and nobody is planning to consume
 *     them; a walker should return them to warehouse storage.
 *   * ``expired`` — any lot at a production_feed cell whose
 *     ``expiry_at`` has passed. Regardless of how it got there,
 *     an expired lot must not stay usable.
 *
 * When both lists are empty the card collapses to a single "all
 * clear" ping so the warehouse manager knows the audit ran (the
 * absence of the card would be ambiguous — "no data" vs "endpoint
 * down"). When either list has rows, the card leads with the count
 * + top-3 rows + a link back to the full drill-down.
 */
export async function ParkedAtProductionCard({
  company,
}: {
  company: CompanyDefaults;
}) {
  const data = await fetchParkedAtProduction(24);
  const strandedCount = data.stranded.length;
  const expiredCount = data.expired.length;

  if (strandedCount === 0 && expiredCount === 0) {
    return (
      <section
        aria-label="Parked at production"
        className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300"
      >
        <div className="flex items-center gap-2">
          <PackageOpen className="size-4" />
          <span>
            All production-feed cells clear — no stranded or expired lots.
          </span>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Parked at production — needs attention"
      className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
    >
      <header className="flex items-center gap-2 text-amber-900 dark:text-amber-300">
        <AlertTriangle className="size-4" />
        <h2 className="font-semibold">Parked at production — needs attention</h2>
      </header>

      {strandedCount > 0 && (
        <SectionBlock
          title={
            strandedCount === 1
              ? "1 lot kept at production for > 24 hours"
              : `${strandedCount} lots kept at production for > 24 hours`
          }
          rows={data.stranded.slice(0, 5)}
          company={company}
          mode="stranded"
        />
      )}

      {expiredCount > 0 && (
        <SectionBlock
          title={
            expiredCount === 1
              ? "1 expired lot still at production"
              : `${expiredCount} expired lots still at production`
          }
          rows={data.expired.slice(0, 5)}
          company={company}
          mode="expired"
        />
      )}

      <p className="text-[11px] text-amber-800/80 dark:text-amber-200/60">
        Open the lot in{" "}
        <Link
          href="/stock/lots"
          className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
        >
          Stock lots
        </Link>{" "}
        to walk it back via return-pickup, or dispose it if expired.
      </p>
    </section>
  );
}

function SectionBlock({
  title,
  rows,
  company,
  mode,
}: {
  title: string;
  rows: ParkedAtProductionRow[];
  company: CompanyDefaults;
  mode: "stranded" | "expired";
}) {
  return (
    <div className="space-y-2">
      <p className="font-medium text-amber-900 dark:text-amber-200">{title}</p>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li
            key={`${mode}:${row.lot_uuid ?? "unknown"}`}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-amber-500/20 bg-white/40 px-2.5 py-1.5 text-xs dark:bg-black/10"
          >
            <span className="font-medium text-amber-950 dark:text-amber-100">
              {row.item_name ?? row.lot_code ?? "Unknown lot"}
            </span>
            {row.qty !== null && (
              <span className="text-amber-800/90 dark:text-amber-200/80">
                {formatCompanyNumber(String(row.qty), company)}
              </span>
            )}
            {row.cell_name && (
              <span className="text-amber-800/70 dark:text-amber-200/60">
                @ {row.cell_name}
                {row.warehouse_name ? ` · ${row.warehouse_name}` : ""}
              </span>
            )}
            {mode === "stranded" && typeof row.kept_hours_ago === "number" && (
              <span className="ml-auto inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                <Clock className="size-3" />
                kept {row.kept_hours_ago}h
              </span>
            )}
            {mode === "expired" && row.expiry_at && (
              <span className="ml-auto inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                <Clock className="size-3" />
                expired {formatCompanyDate(row.expiry_at, company)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
