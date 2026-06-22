"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import {
  syntheticErrorResult,
  toErrorResult,
  type ErrorResult,
} from "../errors/server";
import type { ManufacturingOrder } from "../production/types";

export type RunActionResult =
  | { ok: true; mo: ManufacturingOrder }
  | ErrorResult;

function unauthorized(source: string): ErrorResult {
  return syntheticErrorResult({
    source,
    code: "unauthorized",
    detail: "Sign in again to run production.",
  });
}

/** Flip a preflight-cleared MO to `in_progress` + stamp actual_start. */
export async function startProductionAction(
  uuid: string,
): Promise<RunActionResult> {
  const token = await getSessionToken();
  if (!token) return unauthorized("startProductionAction");

  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(uuid)}/start-production`,
      { method: "POST", token, body: JSON.stringify({}) },
    );
    revalidatePath("/production/runs");
    revalidatePath(`/production/runs/${uuid}`);
    revalidatePath(`/production/manufacturing-orders/${uuid}`);
    return { ok: true, mo };
  } catch (err) {
    return toErrorResult(err, {
      source: "startProductionAction",
      fallbackDetail: "Couldn't start production.",
    });
  }
}

interface OperationTimeEntry {
  step_uuid: string;
  actual_start: string;
  actual_finish: string;
}

/** One physical package the operator produced. Each becomes its own
 *  output stock_lot so a 25 kg blend split into 1 main sack + 1
 *  sample drum is recorded as two distinct lots. Sum of pack qtys
 *  must equal `quantity_produced`. */
export interface PackInput {
  qty: string;
  length_mm: string;
  width_mm: string;
  height_mm: string;
  weight_kg: string;
  stack_factor: string;
}

interface FinishInput {
  actual_start: string | null;
  actual_finish: string | null;
  quantity_produced: string;
  /** Optional per-operation time allocation produced by the divider
   *  slider in the Finish dialog. When set, each step's
   *  actual_start / actual_finish is stamped inside the same
   *  transaction that closes the MO. */
  operation_times?: OperationTimeEntry[];
  /** Required at Finish — one entry per physical package produced. */
  packs: PackInput[];
}

/** Stamp actual_finish + quantity_produced, create the produced lot,
 *  transition the MO to `completed`. */
export async function finishProductionAction(
  uuid: string,
  input: FinishInput,
): Promise<RunActionResult> {
  const token = await getSessionToken();
  if (!token) return unauthorized("finishProductionAction");

  const body: Record<string, unknown> = {
    quantity_produced: input.quantity_produced,
    packs: input.packs,
  };
  if (input.actual_start) body.actual_start = input.actual_start;
  if (input.actual_finish) body.actual_finish = input.actual_finish;
  if (input.operation_times && input.operation_times.length > 0) {
    body.operation_times = input.operation_times;
  }

  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(uuid)}/finish-production`,
      { method: "POST", token, body: JSON.stringify(body) },
    );
    revalidatePath("/production/runs");
    revalidatePath(`/production/runs/${uuid}`);
    revalidatePath(`/production/manufacturing-orders/${uuid}`);
    return { ok: true, mo };
  } catch (err) {
    return toErrorResult(err, {
      source: "finishProductionAction",
      fallbackDetail: "Couldn't finish production.",
    });
  }
}
