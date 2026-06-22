"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import {
  syntheticErrorResult,
  toErrorResult,
  type ErrorResult,
} from "../errors/server";

export type OutputQcVerdict = "pass" | "fail";

export type OutputQcResult =
  | { ok: true; status: string }
  | ErrorResult;

/**
 * Pass / fail an output stock_lot. Wraps the BE endpoint that lives
 * under /api/production/output-qc/:lot_uuid, gated by the dedicated
 * production.qc_output capability.
 */
export async function signOffOutputQcAction(
  lotUuid: string,
  verdict: OutputQcVerdict,
  reason: string | null,
): Promise<OutputQcResult> {
  const token = await getSessionToken();
  if (!token) {
    return syntheticErrorResult({
      source: "signOffOutputQcAction",
      code: "unauthorized",
      detail: "Sign in again to QC output lots.",
    });
  }
  try {
    const { lot } = await api<{ lot: { status: string } }>(
      `/api/production/output-qc/${encodeURIComponent(lotUuid)}`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ verdict, reason: reason?.trim() || null }),
      },
    );
    revalidatePath("/production/output-qc");
    return { ok: true, status: lot.status };
  } catch (err) {
    return toErrorResult(err, {
      source: "signOffOutputQcAction",
      fallbackDetail: "Couldn't record the QC sign-off.",
    });
  }
}
