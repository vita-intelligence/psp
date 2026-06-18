import "server-only";

import { api } from "../api";
import { getDeviceToken } from "../devices/server";
import { getSessionToken } from "../auth/server";
import type { ManufacturingOrder, PickupQueueEntry } from "../production/types";
import type { ManufacturingOrderBooking } from "../production/types";

export interface PickupQueueResponse {
  items: PickupQueueEntry[];
}

export interface PickupDetailResponse {
  mo: ManufacturingOrder;
  bookings: ManufacturingOrderBooking[];
}

/**
 * Picker queue for the mobile /m/pickup landing page. Device token
 * preferred (tablet), session token fallback (laptop dev-testing).
 */
export async function getPickupQueue(): Promise<PickupQueueResponse | null> {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) return null;

  try {
    return await api<PickupQueueResponse>("/api/m/pickup-queue", {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

/**
 * Per-MO pickup detail — full MO header + the bookings the picker
 * needs to walk (filtered to raw materials + packaging by the BE).
 */
export async function getPickupDetail(
  moUuid: string,
): Promise<PickupDetailResponse | null> {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) return null;

  try {
    return await api<PickupDetailResponse>(
      `/api/m/pickup/${encodeURIComponent(moUuid)}`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
