import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { Item } from "../types";

export async function listItemsPage(): Promise<{
  items: Item[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{ items: Item[]; next_cursor: string | null }>(
      "/api/items",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export interface ItemPickerRow {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  item_type: string;
  external_sku: string | null;
}

/** Lightweight item list for picker dropdowns on PO lines, lot receive,
 *  etc. Returns active items only. Sorted by code. */
export async function listItemsForPicker(): Promise<ItemPickerRow[]> {
  const token = await getSessionToken();
  if (!token) return [];

  try {
    const res = await api<{ items: Item[] }>(
      "/api/items?picker=true&is_active=true&limit=500",
      { token, cache: "no-store" },
    );
    return res.items.map((i) => ({
      id: i.id,
      uuid: i.uuid,
      code: i.code ?? null,
      name: i.name,
      item_type: i.item_type,
      external_sku: i.external_sku ?? null,
    }));
  } catch {
    return [];
  }
}

export async function getItem(uuid: string): Promise<Item | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { item } = await api<{ item: Item }>(`/api/items/${uuid}`, {
      token,
      cache: "no-store",
    });
    return item;
  } catch {
    return null;
  }
}
