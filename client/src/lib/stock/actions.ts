"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { StockLot, ComplianceState } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type CreateManualLotResult =
  | { ok: true; lot: StockLot }
  | ErrorResult;

export interface ManualLotPlacementInput {
  cell_id: number;
  qty: string;
}

export interface ManualLotInput {
  item_id: number;
  unit_of_measurement_id: number;
  /** One row per destination cell. The lot's qty_received is the
   *  sum; each row also gets its own receive movement. */
  placements: ManualLotPlacementInput[];
  // optional metadata. `source_kind` is forced to "manual" by the
  // backend — callers don't need to send it.
  unit_cost?: string | null;
  currency?: string | null;
  supplier_batch_no?: string | null;
  country_of_origin?: string | null;
  revision?: string | null;
  manufactured_at?: string | null;
  expiry_at?: string | null;
  available_from?: string | null;
  overall_risk?: "low" | "medium" | "high" | null;
  allergen_status?: ComplianceState | null;
  coa_status?: ComplianceState | null;
  quality_status?: ComplianceState | null;
  notes?: string | null;
}

/**
 * Create a manual lot — for ad-hoc stock entry (opening balances,
 * adjustments). The backend records `source_kind: "manual"` and
 * the actor's `created_by`. Real receives against a Purchase Order
 * land later via the procurement module.
 *
 * POST /api/stock/lots/manual inserts lot + initial placement +
 * receive movement in one transaction; the list cache is
 * invalidated so the new lot shows up immediately.
 */
export async function createManualLotAction(
  input: ManualLotInput,
): Promise<CreateManualLotResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createManualLotAction");

  try {
    const res = await api<{ lot: StockLot }>(
      "/api/stock/lots/manual",
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/stock/lots");
    return { ok: true, lot: res.lot };
  } catch (err) {
    return toErrorResult(err, {
      source: "createManualLotAction",
      fallbackDetail: "Couldn't create the lot.",
    });
  }
}
