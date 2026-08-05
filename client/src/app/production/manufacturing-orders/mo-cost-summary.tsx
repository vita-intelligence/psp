"use client";

import { formatCompanyMoney, formatCompanyNumber } from "@/lib/format/company";
import type { CompanyDefaults } from "@/lib/types";
import type { ManufacturingOrder } from "@/lib/production/types";
import type { MOCostBreakdown } from "@/lib/production/mo-cost";
import { useEntityChannel } from "@/lib/realtime/use-entity-channel";

interface Props {
  mo: ManufacturingOrder;
  company: CompanyDefaults;
  /** Server-fetched cost breakdown. May be null if the breakdown
   *  endpoint failed (missing perms, transient error) — the card
   *  falls back to the MO's static approximate cost in that case. */
  initialCost: MOCostBreakdown | null;
}

/**
 * Cost summary strip. Actual labour + machine come from the
 * session-based breakdown endpoint, which sums
 * `worker_wage_at(session.started_at) × session_duration_hours`
 * across every session on this MO — so a new kiosk session, or a
 * mid-MO wage change on a NEW session, is reflected instantly.
 *
 * Subscribes to the same `workstation_session_mo:<uuid>` topic as
 * `MOSessionsCard`; every broadcast triggers a `router.refresh()`
 * which re-fetches this component's `initialCost` prop from the
 * server component that owns the page.
 */
export function MOCostSummary({ mo, company, initialCost }: Props) {
  useEntityChannel({
    entity: "workstation_session_mo",
    uuid: mo.uuid,
  });

  const uomSymbol = mo.item?.stock_uom?.symbol ?? "Each";
  const totals = initialCost?.totals ?? null;
  const perUnit = initialCost?.per_unit ?? null;

  // Prefer the live breakdown; fall back to the static MO fields when
  // the endpoint hasn't returned anything (unusual — usually a perms
  // gap on a viewer role).
  const material = totals?.material_cost ?? mo.materials_cost ?? null;
  const labour = totals?.labour_cost ?? null;
  const machine = totals?.machine_cost ?? null;
  const total = totals?.total_cost ?? mo.materials_cost ?? mo.approximate_cost ?? null;
  const totalPerUnit = perUnit?.total_cost ?? mo.cost_per_unit ?? null;

  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Total cost", value: total },
    { label: `Cost per 1 ${uomSymbol}`, value: totalPerUnit },
    { label: "Cost of materials", value: material },
    { label: "Machine cost", value: machine },
    { label: "Labour cost", value: labour },
  ];

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Cost summary</h2>
        <p className="text-[11px] text-muted-foreground">
          Actuals from {formatCompanyNumber(mo.quantity, company)} {uomSymbol} · labour + machine
          from booked sessions.
        </p>
      </header>
      <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd
              className={
                r.value ? "font-mono font-medium" : "text-muted-foreground/50"
              }
            >
              {r.value ? formatCompanyMoney(r.value, company) : "—"}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
