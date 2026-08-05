import "server-only";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";

/**
 * MO-scoped cost roll-up returned by
 * `GET /api/production/manufacturing-orders/:uuid/cost-breakdown`.
 *
 * Labour costs are point-in-time: each session's contribution is
 * `worker_wage_at(session.started_at) × session_duration_hours`, so a
 * mid-MO wage change never rewrites the labour cost of sessions that
 * already ran. Machine costs use the workstation's current hourly rate
 * (machine sum → workstation override → workstation-group fallback).
 *
 * Decimals are stringified server-side so the client can format them
 * via `formatCompanyMoney` without pulling in a Decimal library.
 */
export interface MOCostBreakdown {
  manufacturing_order: {
    uuid: string;
    status: string;
    quantity: string;
    quantity_produced: string | null;
    item_name: string | null;
  };
  steps: Array<{
    uuid: string;
    sort_order: number | null;
    name: string | null;
    workstation_name: string | null;
    sessions: Array<{
      uuid: string;
      activity_kind: string;
      started_at: string;
      finished_at: string | null;
      duration_hours: string;
      workers: number;
      quantity_produced: string | null;
      quantity_rejected: string | null;
      labour_cost: string;
      machine_cost: string;
      total_cost: string;
    }>;
    totals: {
      labour_cost: string;
      machine_cost: string;
      material_cost: string | null;
      rejected_material_cost: string | null;
      total_cost: string;
    };
  }>;
  materials: unknown;
  totals: {
    labour_cost: string;
    machine_cost: string;
    material_cost: string;
    planned_material_cost: string | null;
    rejected_material_cost: string | null;
    total_cost: string;
    planned_total_cost: string | null;
  };
  per_unit: {
    labour_cost: string | null;
    machine_cost: string | null;
    material_cost: string | null;
    total_cost: string | null;
    quantity: string;
  } | null;
  _meta: {
    non_mo_overhead_policy: string;
    currency_code: string;
    generated_at: string;
  };
}

export async function getMOCostBreakdown(
  uuid: string,
): Promise<MOCostBreakdown | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<MOCostBreakdown>(
      `/api/production/manufacturing-orders/${encodeURIComponent(uuid)}/cost-breakdown`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
