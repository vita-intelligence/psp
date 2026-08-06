import "server-only";

import { api, ApiError } from "../api";
import { getDeviceToken } from "../devices/server";
import { getSessionToken } from "../auth/server";
import type {
  CloseoutOutputLot,
  CloseoutQueueEntry,
  DispatchCell,
  ManufacturingOrder,
  ManufacturingOrderBooking,
} from "../production/types";

export interface CloseoutQueueResponse {
  items: CloseoutQueueEntry[];
}

export interface CloseoutDetailResponse {
  mo: ManufacturingOrder;
  bookings: ManufacturingOrderBooking[];
  output_lots: CloseoutOutputLot[];
}

export interface DispatchCellsResponse {
  items: DispatchCell[];
}

async function token(): Promise<string | null> {
  return (await getDeviceToken()) ?? (await getSessionToken());
}

export async function getCloseoutQueue(): Promise<CloseoutQueueResponse | null> {
  const t = await token();
  if (!t) return null;
  try {
    return await api<CloseoutQueueResponse>("/api/m/closeout-queue", {
      token: t,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

/** Discriminated union so the page can distinguish "the MO doesn't
 *  exist" from "the MO exists but closeout is gated on something the
 *  operator needs to fix first" — the second case is way more common
 *  than a real 404 (someone bookmarked a link, someone else finished
 *  it, etc.) and deserves a helpful screen instead of "page not found". */
export type CloseoutDetailResult =
  | { kind: "ok"; detail: CloseoutDetailResponse }
  | { kind: "not_found" }
  | { kind: "awaiting_output_qc"; detail: string }
  | { kind: "not_completed"; detail: string };

export async function getCloseoutDetail(
  moUuid: string,
): Promise<CloseoutDetailResult> {
  const t = await token();
  if (!t) return { kind: "not_found" };
  try {
    const detail = await api<CloseoutDetailResponse>(
      `/api/m/closeout/${encodeURIComponent(moUuid)}`,
      { token: t, cache: "no-store" },
    );
    return { kind: "ok", detail };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === "awaiting_output_qc")
        return { kind: "awaiting_output_qc", detail: err.detail };
      if (err.code === "not_completed")
        return { kind: "not_completed", detail: err.detail };
    }
    return { kind: "not_found" };
  }
}

export async function getDispatchCellsForMo(
  moUuid: string,
): Promise<DispatchCellsResponse | null> {
  const t = await token();
  if (!t) return null;
  try {
    return await api<DispatchCellsResponse>(
      `/api/m/closeout/${encodeURIComponent(moUuid)}/dispatch-cells`,
      { token: t, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
