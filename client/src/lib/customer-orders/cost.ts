import "server-only";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";

/**
 * Project-wide cost roll-up returned by
 * `GET /api/customer-orders/:uuid/cost-breakdown`. Decimals are
 * stringified server-side so the client can render them via
 * `formatCompanyMoney` without pulling in a Decimal library.
 *
 * `active_labour_running_seconds` is the wall-clock sum of currently
 * running kiosk sessions across the CO's MO tree — > 0 means a live
 * "⟳ live" pill lights up on the card and the wizard schedules a
 * periodic refresh so labour ticks up visibly.
 */
export interface COCostBreakdown {
  customer_order: { uuid: string; code: string | null };
  mos: Array<{
    uuid: string;
    code: string | null;
    item_name: string | null;
    status: string;
    quantity: string;
    quantity_produced: string | null;
    per_unit: {
      labour: string | null;
      machine: string | null;
      material: string | null;
      total: string | null;
    };
    totals: {
      labour_cost: string;
      machine_cost: string;
      material_cost: string;
      planned_material_cost: string | null;
      rejected_material_cost: string | null;
      total_cost: string;
      planned_total_cost: string | null;
    };
  }>;
  totals: {
    labour_cost: string;
    machine_cost: string;
    material_cost: string;
    planned_material_cost: string | null;
    rejected_material_cost: string | null;
    total_cost: string;
    planned_total_cost: string | null;
    active_labour_running_seconds: number;
  };
  /**
   * Per-machine roll-up across every session in this CO's MO tree.
   * One row per active rate-enabled machine that saw activity;
   * machines with £0 contribution are dropped BE-side. Rows are
   * pre-sorted by descending cost.
   */
  by_machine: Array<{
    uuid: string;
    name: string;
    asset_tag: string | null;
    workstation_uuid: string;
    workstation_name: string;
    hourly_rate: string;
    hours: string;
    cost: string;
  }>;
  currency_code: string;
  generated_at: string;
}

export async function getCOCostBreakdown(
  uuid: string,
): Promise<COCostBreakdown | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<COCostBreakdown>(
      `/api/customer-orders/${encodeURIComponent(uuid)}/cost-breakdown`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
