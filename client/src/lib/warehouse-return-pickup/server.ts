import "server-only";

import { api } from "../api";
import { getDeviceToken } from "../devices/server";
import { getSessionToken } from "../auth/server";
import type {
  ManufacturingOrder,
  ReturnPickRow,
  ReturnPickupLot,
  ReturnPickupQueueEntry,
} from "../production/types";

export interface ReturnPickupQueueResponse {
  items: ReturnPickupQueueEntry[];
}

export interface ReturnPickupDetailResponse {
  mo: ManufacturingOrder;
  lots_at_dispatch: ReturnPickupLot[];
  /** Trolley rows belonging to the current actor — actionable. */
  trolley: ReturnPickRow[];
  /** Trolley rows held by OTHER workers right now — read-only.
   *  Surfaced so peers see who's holding what without claiming it. */
  trolley_others: ReturnPickRow[];
}

export interface LooseDispatchResponse {
  items: ReturnPickupLot[];
}

export interface TrolleyResponse {
  items: ReturnPickRow[];
  others: ReturnPickRow[];
}

async function token(): Promise<string | null> {
  return (await getDeviceToken()) ?? (await getSessionToken());
}

export async function getReturnPickupQueue(): Promise<ReturnPickupQueueResponse | null> {
  const t = await token();
  if (!t) return null;
  try {
    return await api<ReturnPickupQueueResponse>(
      "/api/m/return-pickup-queue",
      { token: t, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export async function getReturnPickupDetail(
  moUuid: string,
): Promise<ReturnPickupDetailResponse | null> {
  const t = await token();
  if (!t) return null;
  try {
    return await api<ReturnPickupDetailResponse>(
      `/api/m/return-pickup/${encodeURIComponent(moUuid)}`,
      { token: t, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export async function getLooseDispatchLots(): Promise<LooseDispatchResponse | null> {
  const t = await token();
  if (!t) return null;
  try {
    return await api<LooseDispatchResponse>(
      "/api/m/return-pickup/loose",
      { token: t, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export async function getReturnPickupTrolley(): Promise<TrolleyResponse | null> {
  const t = await token();
  if (!t) return null;
  try {
    return await api<TrolleyResponse>("/api/m/return-pickup/trolley", {
      token: t,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}
