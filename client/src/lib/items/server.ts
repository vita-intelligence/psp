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
