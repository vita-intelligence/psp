import { formatCompanyMoney, formatCompanyNumber } from "@/lib/format/company";
import type { CompanyDefaults } from "@/lib/types";
import type { ManufacturingOrder } from "@/lib/production/types";

interface Props {
  mo: ManufacturingOrder;
  company: CompanyDefaults;
}

/**
 * MRPEasy-style cost strip: Total cost / Cost per unit / Cost of
 * materials. Overhead + labor cost rows are placeholders until the
 * execution layer ships — they live in the same component so the
 * layout doesn't shift when those numbers start landing.
 */
export function MOCostSummary({ mo, company }: Props) {
  const uomSymbol = mo.item?.stock_uom?.symbol ?? "Each";

  const rows: Array<{ label: string; value: string | null; muted?: boolean }> = [
    { label: "Total cost", value: mo.materials_cost ?? mo.approximate_cost },
    {
      label: `Cost per 1 ${uomSymbol}`,
      value: mo.cost_per_unit,
    },
    { label: "Cost of materials", value: mo.materials_cost },
    {
      label: "Applied overhead cost",
      value: null,
      muted: true,
    },
    { label: "Labor cost", value: null, muted: true },
  ];

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Cost summary</h2>
        <p className="text-[11px] text-muted-foreground">
          Built from BOM × Qty ({formatCompanyNumber(mo.quantity, company)} {uomSymbol}).
          Overhead + labor land with execution.
        </p>
      </header>
      <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className={r.muted ? "text-muted-foreground/50" : "font-mono font-medium"}>
              {r.value ? formatCompanyMoney(r.value, company) : "—"}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
