import "server-only";

import { api } from "../api";
import { getSessionToken } from "../auth/server";

export interface ShortageDependentMo {
  uuid: string;
  /** Rendered MO code (e.g. "MO00016") — display this, not the UUID. */
  code: string | null;
  status: string;
  quantity: string;
  item_name: string;
  planned_start: string | null;
}

export interface ShortageRow {
  item: {
    id: number;
    uuid: string;
    name: string;
    item_type: string;
    stock_uom: { id: number; symbol: string; name: string } | null;
  } | null;
  required_qty: string;
  booked_qty: string;
  expecting_qty: string;
  shortage_qty: string;
  on_hand_qty: string;
  dependent_mos: ShortageDependentMo[];
}

export interface ShortagesResponse {
  items: ShortageRow[];
  next_cursor: string | null;
}

export async function getProcurementShortages(): Promise<ShortagesResponse | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<ShortagesResponse>(
      "/api/procurement/shortages?limit=50&sort=shortage_qty:desc",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
