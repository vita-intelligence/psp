import "server-only";

import { api } from "../api";
import { getDeviceToken } from "../devices/server";
import { getSessionToken } from "../auth/server";
import type {
  ManufacturingOrder,
  ManufacturingOrderBooking,
  PreflightQueueEntry,
} from "../production/types";

export interface PreflightQueueResponse {
  items: PreflightQueueEntry[];
}

export interface PreflightDetailResponse {
  mo: ManufacturingOrder;
  bookings: ManufacturingOrderBooking[];
  preflight_complete: boolean;
}

/**
 * Production-operator queue. Device token preferred (tablet next to
 * the line), session token fallback (laptop dev-testing).
 */
export async function getPreflightQueue(): Promise<PreflightQueueResponse | null> {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) return null;

  try {
    return await api<PreflightQueueResponse>("/api/m/preflight-queue", {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

/**
 * Per-MO preflight detail — full booking list with current receipt
 * state, plus a `preflight_complete` flag so the page can show "Ready
 * to start production" CTA when every row is signed off.
 */
export async function getPreflightDetail(
  moUuid: string,
): Promise<PreflightDetailResponse | null> {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) return null;

  try {
    return await api<PreflightDetailResponse>(
      `/api/m/preflight/${encodeURIComponent(moUuid)}`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
