"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import { getDeviceToken } from "../devices/server";
import {
  syntheticErrorResult,
  toErrorResult,
  type ErrorResult,
} from "../errors/server";
import type { StockLot } from "../types";
import type {
  CompleteDispatchInput,
  RequestDispatchInput,
  RoutingChoice,
  ThreePLDispatchRow,
} from "./types";

export type RouteLotResult =
  | { ok: true; lot: StockLot }
  | (ErrorResult & { ok: false });

export type RequestDispatchResult =
  | { ok: true; dispatch: ThreePLDispatchRow }
  | (ErrorResult & { ok: false });

export type CompleteDispatchResult =
  | { ok: true; lot: StockLot; dispatch: ThreePLDispatchRow }
  | (ErrorResult & { ok: false });

export type CancelDispatchResult =
  | { ok: true; dispatch: ThreePLDispatchRow }
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
    revalidatePath("/m/three-pl-dispatches");
    return { ok: true, lot };
  } catch (err) {
    return toErrorResult(err, {
      source: "routeLotAction",
      fallbackDetail: "Couldn't record the routing decision.",
    });
  }
}

/**
 * Desktop step 1 — queue a dispatch request. Records the qty +
 * optional reference / notes on a `pending` row for the mobile
 * picker queue. No physical move fires here; the warehouse operator
 * completes it later from mobile with a photo + destination scan.
 */
export async function requestDispatchAction(
  input: RequestDispatchInput,
): Promise<RequestDispatchResult> {
  const token = await getSessionToken();
  if (!token) return unauthorized("requestDispatchAction");

  try {
    const res = await api<{ dispatch: ThreePLDispatchRow }>(
      "/api/three-pl/dispatch-requests",
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/three-pl");
    revalidatePath(`/three-pl/${input.lot_uuid}`);
    revalidatePath("/m");
    return { ok: true, dispatch: res.dispatch };
  } catch (err) {
    return toErrorResult(err, {
      source: "requestDispatchAction",
      fallbackDetail: "Couldn't queue the dispatch.",
    });
  }
}

/**
 * Mobile step 2 — execute a pending dispatch. Takes the scanned
 * destination cell + photo evidence, moves the qty physically, and
 * flips the row to `completed`.
 */
export async function completeDispatchAction(
  dispatchUuid: string,
  input: CompleteDispatchInput,
): Promise<CompleteDispatchResult> {
  // Mobile picker flows run in a paired-phone context (device token
  // cookie only); desktop calls run with a session cookie. Same
  // dual-lookup pattern the shipments + warehouses actions use.
  const token = (await getSessionToken()) ?? (await getDeviceToken());
  if (!token) return unauthorized("completeDispatchAction");

  try {
    const res = await api<{ lot: StockLot; dispatch: ThreePLDispatchRow }>(
      `/api/three-pl/dispatch-requests/${encodeURIComponent(dispatchUuid)}/complete`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/three-pl");
    revalidatePath("/m");
    revalidatePath("/m/three-pl-dispatches");
    return { ok: true, lot: res.lot, dispatch: res.dispatch };
  } catch (err) {
    return toErrorResult(err, {
      source: "completeDispatchAction",
      fallbackDetail: "Couldn't complete the dispatch.",
    });
  }
}

/**
 * Desktop cancel — drops a pending dispatch off the picker queue.
 */
export async function cancelDispatchAction(
  dispatchUuid: string,
): Promise<CancelDispatchResult> {
  // Same dual-token dance as completeDispatchAction — the mobile
  // 3PL hub's Cancel button runs on the paired-phone device
  // context, not a desktop session.
  const token = (await getSessionToken()) ?? (await getDeviceToken());
  if (!token) return unauthorized("cancelDispatchAction");

  try {
    const res = await api<{ dispatch: ThreePLDispatchRow }>(
      `/api/three-pl/dispatch-requests/${encodeURIComponent(dispatchUuid)}/cancel`,
      { method: "POST", token, body: JSON.stringify({}) },
    );
    revalidatePath("/three-pl");
    revalidatePath("/m");
    revalidatePath("/m/three-pl-dispatches");
    return { ok: true, dispatch: res.dispatch };
  } catch (err) {
    return toErrorResult(err, {
      source: "cancelDispatchAction",
      fallbackDetail: "Couldn't cancel the dispatch.",
    });
  }
}

/**
 * Cancel-and-return handoff — the picker taps Cancel on a
 * Paperwork or Pickup row. Backend cancels the shipment + flips
 * the source dispatch to ``return_pending`` so the walk-back
 * task lands on the Return tab.
 */
export async function cancelShipmentAndReturnAction(
  shipmentUuid: string,
  reason?: string,
): Promise<CancelDispatchResult> {
  const token = (await getSessionToken()) ?? (await getDeviceToken());
  if (!token) return unauthorized("cancelShipmentAndReturnAction");

  try {
    const res = await api<{ dispatch: ThreePLDispatchRow }>(
      `/api/three-pl/shipments/${encodeURIComponent(shipmentUuid)}/cancel-and-return`,
      {
        method: "POST",
        token,
        body: JSON.stringify(reason ? { reason } : {}),
      },
    );
    revalidatePath("/three-pl");
    revalidatePath("/m");
    revalidatePath("/m/three-pl-dispatches");
    revalidatePath(`/shipments/${shipmentUuid}`);
    return { ok: true, dispatch: res.dispatch };
  } catch (err) {
    return toErrorResult(err, {
      source: "cancelShipmentAndReturnAction",
      fallbackDetail: "Couldn't cancel the shipment.",
    });
  }
}

/**
 * Mobile — finish the return walk-back. Backend physically moves
 * the lot from the current dispatch cell into the scanned 3PL
 * cell + flips dispatch.status to ``cancelled`` in one txn.
 */
export async function completeReturnAction(
  dispatchUuid: string,
  input: { to_cell_uuid: string },
): Promise<CompleteDispatchResult> {
  const token = (await getSessionToken()) ?? (await getDeviceToken());
  if (!token) return unauthorized("completeReturnAction");

  try {
    const res = await api<{ lot: StockLot; dispatch: ThreePLDispatchRow }>(
      `/api/three-pl/returns/${encodeURIComponent(dispatchUuid)}/complete`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/three-pl");
    revalidatePath("/m");
    revalidatePath("/m/three-pl-dispatches");
    return { ok: true, lot: res.lot, dispatch: res.dispatch };
  } catch (err) {
    return toErrorResult(err, {
      source: "completeReturnAction",
      fallbackDetail: "Couldn't complete the return.",
    });
  }
}
