import { Building2, Layers, MapPin, Sparkles } from "lucide-react";
import type { StockLot, StockLotPlacement } from "@/lib/types";
import { getCompanyDefaults } from "@/lib/company/server";
import { formatCompanyNumber } from "@/lib/format/company";

/**
 * Placements list — where this lot's stock currently lives, broken
 * down by cell. The mobile put-away flow reads from this same data:
 * any row sitting in a system-managed cell shows up there.
 *
 * System cells are rendered with the company-configured
 * `generic_place_name` (default "Holding Room") so operators never see
 * the internal "Unregistered" label.
 */
export async function LotPlacementsCard({ lot }: { lot: StockLot }) {
  const prefs = await getCompanyDefaults();
  const symbol = lot.unit_of_measurement?.symbol ?? "";
  const holdingName = prefs?.generic_place_name?.trim() || "Holding Room";

  // Hide placements that have been emptied — after a move the source
  // placement stays in the table at qty=0 for movement-history rollup
  // but the operator-facing list should only show what's actually on
  // hand. Zero rows here read as "0 KG sitting here" which is wrong
  // semantically and was the exact bug the user flagged.
  const active = lot.placements.filter((p) => Number(p.qty) > 0);

  if (active.length === 0) {
    return (
      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="mb-4 flex items-center gap-2">
          <MapPin className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Placements</h2>
        </header>
        <p className="text-sm text-muted-foreground">
          Nothing on hand — every package has been moved out or consumed.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center gap-2">
        <MapPin className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">Placements</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {active.length} row{active.length === 1 ? "" : "s"}
        </span>
      </header>

      <ul className="divide-y divide-border/60">
        {active.map((p) => (
          <PlacementRow
            key={p.uuid}
            placement={p}
            qty={formatCompanyNumber(p.qty, prefs)}
            symbol={symbol}
            holdingName={holdingName}
          />
        ))}
      </ul>
    </section>
  );
}

function PlacementRow({
  placement,
  qty,
  symbol,
  holdingName,
}: {
  placement: StockLotPlacement;
  qty: string;
  symbol: string;
  holdingName: string;
}) {
  const cell = placement.storage_cell;
  const isSystem = isSystemPlacement(cell);

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        {/* Top breadcrumb: warehouse → floor. System floors get
            collapsed because "(System)" reads as a leak. */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Building2 className="size-3" />
          <span>{cell?.warehouse?.name ?? "—"}</span>
          {!isSystem && cell?.floor?.name && (
            <>
              <span>/</span>
              <span>{cell.floor.name}</span>
            </>
          )}
        </div>

        {/* Headline: location + cell, using the company-numbered codes
            (SL00004 / CELL00011) so display matches the rules admins
            set under Settings → Numbering. For system placements
            that's just the operator-facing "Holding Room" + a small
            Auto pill. */}
        <div className="flex flex-wrap items-center gap-2">
          <Layers className="size-3.5 text-muted-foreground" />
          {isSystem ? (
            <>
              <span className="text-sm font-medium">{holdingName}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                <Sparkles className="size-2.5" />
                Auto
              </span>
            </>
          ) : (
            <>
              <span className="font-mono text-sm font-medium">
                {cell?.storage_location?.code ?? "—"}
              </span>
              {cell?.code && (
                <span className="font-mono text-sm text-muted-foreground">
                  · {cell.code}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-base font-semibold tracking-tight">
          {qty}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {symbol || "qty"}
        </div>
      </div>
    </li>
  );
}

function isSystemPlacement(
  cell: StockLotPlacement["storage_cell"] | null | undefined,
): boolean {
  if (!cell) return false;
  return (
    cell.system_kind === "unregistered" ||
    cell.storage_location?.system_kind === "unregistered" ||
    cell.floor?.system_kind === "unregistered"
  );
}
