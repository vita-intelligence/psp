import "server-only";

import { api } from "../api";
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

export async function getCloseoutDetail(
  moUuid: string,
): Promise<CloseoutDetailResponse | null> {
  const t = await token();
  if (!t) return null;
  try {
    return await api<CloseoutDetailResponse>(
      `/api/m/closeout/${encodeURIComponent(moUuid)}`,
      { token: t, cache: "no-store" },
    );
  } catch {
    return null;
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
