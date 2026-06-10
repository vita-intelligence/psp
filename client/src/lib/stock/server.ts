import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { Item, StockLot, StockMovement, Warehouse } from "../types";

/**
 * Fetch the first page of stock lots from the backend. Used by the
 * /stock/lots server component for an SSR-first render — the
 * DataTable then takes over pagination + filtering on the client.
 */
export async function listStockLotsPage(): Promise<{
  items: StockLot[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{ items: StockLot[]; next_cursor: string | null }>(
      "/api/stock/lots",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

/** Fetch the first page of items (catalogue) for the receive-form
 *  item picker. The receive form filters by name/code client-side
 *  from this initial set; large catalogues fall through to the
 *  searchable items endpoint later. */
export async function listItemsForReceive(): Promise<Item[]> {
  const token = await getSessionToken();
  if (!token) return [];
  try {
    const res = await api<{ items: Item[]; next_cursor: string | null }>(
      "/api/items?limit=200",
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return [];
  }
}

/**
 * Fetch a single lot by uuid for the label / detail pages.
 * Returns null when not found or when the user has no session — both
 * are "render the not-found shell" cases for the caller.
 */
export async function getStockLot(uuid: string): Promise<{
  lot: StockLot;
  movements: StockMovement[];
} | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<{ lot: StockLot; movements: StockMovement[] }>(
      `/api/stock/lots/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

/** Warehouse list for the Site filter dropdown on the receive form.
 *  Cheap call — typical companies have a handful of warehouses. */
export async function listWarehousesForReceive(): Promise<Warehouse[]> {
  const token = await getSessionToken();
  if (!token) return [];
  try {
    const res = await api<{ items: Warehouse[]; next_cursor: string | null }>(
      "/api/warehouses?limit=200",
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return [];
  }
}
