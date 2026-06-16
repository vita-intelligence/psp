import {
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";
import type { CompanyDefaults } from "@/lib/types";
import type { ManufacturingOrder } from "@/lib/production/types";

interface Props {
  mo: ManufacturingOrder;
  company: CompanyDefaults;
}

/**
 * MRPEasy-style parts breakdown: one row per BOM line with required
 * qty × MO qty + unit/total cost. The booking-side columns
 * (Consumed / Booked / Lot / Status / Storage location / Available
 * from) live here too but render as "—" placeholders — they'll
 * populate once the execution layer ships.
 */
export function MOPartsTable({ mo, company }: Props) {
  if (mo.parts.length === 0) {
    return (
      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="mb-3">
          <h2 className="text-sm font-semibold tracking-tight">Parts</h2>
        </header>
        <p className="text-xs text-muted-foreground">
          The connected BOM doesn't have any parts yet.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Parts</h2>
        <p className="text-[11px] text-muted-foreground">
          {mo.bom?.code ?? "BOM"} — required for {formatCompanyNumber(mo.quantity, company)}{" "}
          {mo.item?.stock_uom?.symbol ?? "Each"}
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[60rem] text-xs">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left">Stock item</th>
              <th className="px-2 py-1.5 text-right">Required</th>
              <th className="px-2 py-1.5 text-right">Consumed</th>
              <th className="px-2 py-1.5 text-right">Booked</th>
              <th className="px-2 py-1.5 text-right">Unit cost</th>
              <th className="px-2 py-1.5 text-right">Total cost</th>
              <th className="px-2 py-1.5 text-left">Lot</th>
              <th className="px-2 py-1.5 text-left">Status</th>
              <th className="px-2 py-1.5 text-left">Storage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {mo.parts.map((p) => {
              const uom =
                p.unit_of_measurement?.symbol ??
                p.part?.stock_uom?.symbol ??
                "";

              return (
                <tr key={p.id}>
                  <td className="px-2 py-1.5">
                    <p className="text-sm">
                      {p.part?.name ?? `Item #${p.part?.id ?? "?"}`}
                    </p>
                    {p.part?.code && (
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {p.part.code}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {p.required_qty
                      ? `${formatCompanyNumber(p.required_qty, company)} ${uom}`.trim()
                      : "—"}
                    {p.is_fixed && (
                      <p className="text-[9px] text-muted-foreground">fixed</p>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground/50">
                    —
                  </td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground/50">
                    —
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {p.unit_cost ? formatCompanyMoney(p.unit_cost, company) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {p.total_cost ? formatCompanyMoney(p.total_cost, company) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground/50">—</td>
                  <td className="px-2 py-1.5 text-muted-foreground/50">
                    Not booked
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground/50">—</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Lot reservation, consumed qty, and storage location land with
        the MO execution layer.
      </p>
    </section>
  );
}
