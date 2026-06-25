"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { ManufacturingOrder } from "../production/types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type CreateMoForLineResult =
  | { ok: true; manufacturing_order: ManufacturingOrder }
  | ErrorResult;

/**
 * Spawns a manufacturing order pre-wired to a CO line. The BE copies
 * item / quantity / due_date from the line and stamps
 * `customer_order_line_id` on the MO so the wizard can project it
 * back into the per-line table.
 */
export async function createMoForLineAction(
  coUuid: string,
  lineUuid: string,
): Promise<CreateMoForLineResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createMoForLineAction");

  try {
    const res = await api<{ manufacturing_order: ManufacturingOrder }>(
      `/api/customer-orders/${encodeURIComponent(
        coUuid,
      )}/lines/${encodeURIComponent(lineUuid)}/create-mo`,
      { method: "POST", token },
    );
    revalidatePath(`/sales/orders/${coUuid}`);
    return { ok: true, manufacturing_order: res.manufacturing_order };
  } catch (err) {
    return toErrorResult(err, {
      source: "createMoForLineAction",
      fallbackDetail: "Couldn't create the manufacturing order for this line.",
    });
  }
}
