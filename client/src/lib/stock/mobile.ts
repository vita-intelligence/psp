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
  /** Volumetric fit info from the backend. All percentages are
   *  area-based (the most operator-intuitive metric — shelves run
   *  out of floor space before they run out of weight 90% of the
   *  time). */
  fit?: {
    /** Free area *after* this lot lands. Higher = more headroom. */
    free_pct: number;
    /** Legacy alias for `projected_percent_used` — kept for the
     *  existing mobile chip. New code should read the explicit fields. */
    percent_used: number;
    /** What the cell holds RIGHT NOW. 0 = empty, 100 = full. */
    current_percent_used: number;
    /** What the cell would hold AFTER this lot lands. */
    projected_percent_used: number;
    /** `false` when the fit couldn't be verified (lot is missing
     *  packaging dims OR the destination cell has no dimensions
     *  recorded). Callers should render an "unable to verify fit"
     *  chip in that case instead of the default green "% free"
     *  badge — a distracted worker who sees "100% free" for a
     *  legacy lot without dims might otherwise trust the wrong
     *  signal. Optional for backward compat with pre-hardening
     *  API versions that never emit the key. */
    known?: boolean;
    /** When `known` is false, the reason string surfaces the
     *  ``"unknown_fit"`` marker so UIs can localise the copy.
     *  Populated on both success and disqualified paths from the
     *  backend `check_fit/2`. */
    reason?: string;
  };
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
