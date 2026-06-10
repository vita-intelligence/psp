import type { StockLot } from "@/lib/types";
import { Box } from "lucide-react";

/**
 * Read-only packaging card. Mirrors the receive-form layout so what
 * the operator entered shows up here in the same shape: dims, weight,
 * units/package, stack factor. Derived numbers (footprint area,
 * total weight) are computed here and labelled — those are what the
 * fit-check uses.
 */
export function LotPackagingCard({ lot }: { lot: StockLot }) {
  const hasAll =
    lot.package_length_mm !== null &&
    lot.package_width_mm !== null &&
    lot.package_height_mm !== null &&
    lot.package_weight_kg !== null &&
    lot.units_per_package !== null &&
    lot.stack_factor !== null;

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center gap-2">
        <Box className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">Packaging</h2>
        {!hasAll && (
          <span className="ml-auto rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
            Incomplete
          </span>
        )}
      </header>

      {hasAll ? (
        <>
          <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
            <Row label="Length" value={`${lot.package_length_mm} mm`} />
            <Row label="Width" value={`${lot.package_width_mm} mm`} />
            <Row label="Height" value={`${lot.package_height_mm} mm`} />
            <Row label="Weight" value={`${lot.package_weight_kg} kg`} />
            <Row label="Units / pkg" value={String(lot.units_per_package)} />
            <Row label="Stack factor" value={String(lot.stack_factor)} />
          </dl>

          <div className="mt-4 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            Footprint per package:{" "}
            <span className="font-mono text-foreground">
              {(
                ((lot.package_length_mm ?? 0) * (lot.package_width_mm ?? 0)) /
                1_000_000
              ).toFixed(3)}{" "}
              m²
            </span>
            {" · "}
            Stack height:{" "}
            <span className="font-mono text-foreground">
              {((lot.package_height_mm ?? 0) * (lot.stack_factor ?? 0)) / 1000}{" "}
              m
            </span>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Packaging dimensions weren&apos;t captured at receive. The put-away
          fit-check can&apos;t score this lot until they&apos;re filled in.
        </p>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-sm">{value}</dd>
    </div>
  );
}
