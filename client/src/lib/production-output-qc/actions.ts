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

/** Packaging measured at QC time. Required for both halves of a
 *  partial-fail split — the parent's remainder and the child's
 *  rejected portion typically need different physical dimensions. */
export interface OutputQcPackaging {
  length_mm: string;
  width_mm: string;
  height_mm: string;
  weight_kg: string;
  stack_factor: string;
}

export interface FailQcInput {
  reason: string | null;
  /** Omit (or pass null) to fail the full lot. When set + smaller than
   *  the lot's current qty, the BE splits the lot into a parent (kept,
   *  status=received) and a child (rejected, status=rejected). */
  reject_qty?: string | null;
  /** Required when reject_qty is set and partial. New physical
   *  dimensions of the parent lot after the split. */
  parent_packaging?: OutputQcPackaging;
  /** Required when reject_qty is set and partial. Physical dimensions
   *  of the rejected child lot. */
  child_packaging?: OutputQcPackaging;
  /** PASS path only — QC operator's corrections applied to the lot
   *  before the status flips to `available`. Any qty delta emits an
   *  adjust_up/adjust_down movement at the production-feed cell so
   *  traceability holds. Send only the fields the operator changed;
   *  omitted fields keep production's recorded values. */
  qty_received?: string;
  package_length_mm?: string;
  package_width_mm?: string;
  package_height_mm?: string;
  package_weight_kg?: string;
  units_per_package?: string;
  stack_factor?: string;
}

/**
 * Pass / fail an output stock_lot. Wraps the BE endpoint that lives
 * under /api/production/output-qc/:lot_uuid, gated by the dedicated
 * production.qc_output capability.
 */
export async function signOffOutputQcAction(
  lotUuid: string,
  verdict: OutputQcVerdict,
  input: FailQcInput,
): Promise<OutputQcResult> {
  const token = await getSessionToken();
  if (!token) {
    return syntheticErrorResult({
      source: "signOffOutputQcAction",
      code: "unauthorized",
      detail: "Sign in again to QC output lots.",
    });
  }

  const body: Record<string, unknown> = {
    verdict,
    reason: input.reason?.trim() || null,
  };
  if (input.reject_qty) body.reject_qty = input.reject_qty;
  if (input.parent_packaging) body.parent_packaging = input.parent_packaging;
  if (input.child_packaging) body.child_packaging = input.child_packaging;
  // Pass-path adjustments — only include keys the operator actually
  // edited so a stray "" doesn't blow away production's recorded
  // value via the BE changeset.
  for (const key of [
    "qty_received",
    "package_length_mm",
    "package_width_mm",
    "package_height_mm",
    "package_weight_kg",
    "units_per_package",
    "stack_factor",
  ] as const) {
    const v = input[key];
    if (v != null && v !== "") body[key] = v;
  }

  try {
    const { lot } = await api<{ lot: { status: string } }>(
      `/api/production/output-qc/${encodeURIComponent(lotUuid)}`,
      { method: "POST", token, body: JSON.stringify(body) },
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
