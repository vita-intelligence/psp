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
 *
 * When `bomId` is provided, the BE uses it to materialise the part
 * list — required when the item has more than one published BOM
 * (otherwise the BE auto-picks the primary one).
 */
export async function createMoForLineAction(
  coUuid: string,
  lineUuid: string,
  bomId?: number,
): Promise<CreateMoForLineResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createMoForLineAction");

  try {
    const body =
      typeof bomId === "number" ? JSON.stringify({ bom_id: bomId }) : undefined;

    const res = await api<{ manufacturing_order: ManufacturingOrder }>(
      `/api/customer-orders/${encodeURIComponent(
        coUuid,
      )}/lines/${encodeURIComponent(lineUuid)}/create-mo`,
      { method: "POST", token, body },
    );
    revalidatePath(`/sales/orders/${coUuid}`);
    revalidatePath(`/projects/${coUuid}`);
    return { ok: true, manufacturing_order: res.manufacturing_order };
  } catch (err) {
    return toErrorResult(err, {
      source: "createMoForLineAction",
      fallbackDetail: "Couldn't create the manufacturing order for this line.",
    });
  }
}

export type MOActionString =
  | "request_purchases"
  | "prepare"
  | "approve"
  | "unprepare"
  | "reject";

export type MOTransitionResult =
  | { ok: true; manufacturing_order: ManufacturingOrder }
  | ErrorResult;

/**
 * Generic MO transition for the project board. The BE's
 * `/manufacturing-orders/:uuid/transition` endpoint accepts a body
 * `{ action: "<string>" }` for the workflow verbs surfaced on the
 * wizard's per-line cards (request purchases, prepare, approve).
 *
 * Kept separate from the production module's `signMOAction` so the
 * board can fire any of the wizard CTAs without dragging the heavier
 * approval-rejection flow into the page.
 */
export async function transitionMOAction(
  coUuid: string,
  moUuid: string,
  action: MOActionString,
): Promise<MOTransitionResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("transitionMOAction");

  try {
    const res = await api<{ manufacturing_order: ManufacturingOrder }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(
        moUuid,
      )}/transition`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ action }),
      },
    );
    revalidatePath(`/projects/${coUuid}`);
    revalidatePath(`/sales/orders/${coUuid}`);
    revalidatePath(`/production/manufacturing-orders/${moUuid}`);
    return { ok: true, manufacturing_order: res.manufacturing_order };
  } catch (err) {
    return toErrorResult(err, {
      source: "transitionMOAction",
      fallbackDetail: "Couldn't transition the manufacturing order.",
    });
  }
}
