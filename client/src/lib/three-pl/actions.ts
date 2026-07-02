"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import {
  syntheticErrorResult,
  toErrorResult,
  type ErrorResult,
} from "../errors/server";
import type { StockLot } from "../types";
import type { RoutingChoice } from "./types";

export type RouteLotResult =
  | { ok: true; lot: StockLot }
  | (ErrorResult & { ok: false });

function unauthorized(source: string): ErrorResult {
  return syntheticErrorResult({
    source,
    code: "unauthorized",
    detail: "Sign in to continue.",
  });
}

/**
 * Record the operator's routing decision on `lotUuid`. Called from
 * the customer-order wizard's post-release step. Backend enforces:
 * `production.final_release` permission, lot must be `available` +
 * `ownership_kind = own`, and the target purpose must have volume
 * capacity for the lot. The error `code` field discriminates between
 * `forbidden`, `not_available`, `already_routed`, `no_customer_for_lot`,
 * `bad_customer`, and `no_capacity` so the wizard can render an inline
 * hint per case.
 *
 * `customerUuid` is used only when the wizard's linked-CO lookup
 * returned nothing (opening-balance / manually-received lots) — the
 * backend prefers the derived customer when both are available.
 */
export async function routeLotAction(
  lotUuid: string,
  choice: RoutingChoice,
  customerUuid?: string | null,
): Promise<RouteLotResult> {
  const token = await getSessionToken();
  if (!token) return unauthorized("routeLotAction");

  try {
    const body: Record<string, unknown> = { choice };
    if (customerUuid) body.customer_uuid = customerUuid;
    const { lot } = await api<{ lot: StockLot }>(
      `/api/three-pl/route/${encodeURIComponent(lotUuid)}`,
      {
        method: "POST",
        token,
        body: JSON.stringify(body),
      },
    );
    revalidatePath("/three-pl");
    revalidatePath("/m");
    return { ok: true, lot };
  } catch (err) {
    return toErrorResult(err, {
      source: "routeLotAction",
      fallbackDetail: "Couldn't record the routing decision.",
    });
  }
}
