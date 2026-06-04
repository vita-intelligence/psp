// Server-only helpers for fetching warehouse floors. Pairs with
// `lib/warehouses/server.ts` — same SSR pattern, never touches the
// httpOnly cookie from the browser.

import { api, ApiError } from "../api";
import { getSessionToken } from "../auth/server";
import type { Floor } from "../types";

/**
 * List all floors of a warehouse, with storage locations preloaded.
 * The backend orders by `ordinal` ascending so the floor switcher
 * renders ground floor first, mezzanine next, etc.
 *
 * Returns an empty array for any error (unauthorized, 404, malformed
 * UUID). Callers should branch on `warehouse_id` lookup themselves
 * before getting here.
 */
export async function listFloors(warehouseUuid: string): Promise<Floor[]> {
  const token = await getSessionToken();
  if (!token) return [];

  try {
    const { items } = await api<{ items: Floor[] }>(
      `/api/warehouses/${warehouseUuid}/floors`,
      { token },
    );
    return items;
  } catch (err) {
    if (err instanceof ApiError) return [];
    throw err;
  }
}
