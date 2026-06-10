import "server-only";
import { api } from "../api";
import { getDeviceToken } from "../devices/server";
import type { ScannedCell, StockLot, StockMovement } from "../types";

/**
 * Mobile-side server helpers — all authed via the device bearer
 * cookie set at pair time, not the laptop session cookie. The phone
 * has no session, only a device token.
 */

export async function listPendingPutaway(): Promise<StockLot[]> {
  const token = await getDeviceToken();
  if (!token) return [];
  try {
    const res = await api<{ items: StockLot[] }>(
      "/api/stock/lots/pending-putaway",
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return [];
  }
}

export async function getLotForScan(
  uuid: string,
): Promise<{ lot: StockLot; movements: StockMovement[] } | null> {
  const token = await getDeviceToken();
  if (!token) return null;
  try {
    return await api<{ lot: StockLot; movements: StockMovement[] }>(
      `/api/stock/lots/scan/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export interface MoveRecommendation {
  score: number;
  reason: string;
  /** Volumetric fit info from the backend. `free_pct` is the
   *  percentage of the cell's footprint left unused after this lot
   *  would land — the higher the better. `percent_used` is the
   *  inverse and is what the UI shows as a chip. */
  fit?: { free_pct: number; percent_used: number };
  cell: ScannedCell;
}

export async function listMoveRecommendations(
  lotUuid: string,
): Promise<MoveRecommendation[]> {
  const token = await getDeviceToken();
  if (!token) return [];
  try {
    const res = await api<{ items: MoveRecommendation[] }>(
      `/api/stock/lots/${encodeURIComponent(lotUuid)}/move-recommendations`,
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return [];
  }
}

export async function getCellForScan(uuid: string): Promise<ScannedCell | null> {
  const token = await getDeviceToken();
  if (!token) return null;
  try {
    const res = await api<{ cell: ScannedCell }>(
      `/api/stock/cells/scan/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return res.cell;
  } catch {
    return null;
  }
}
