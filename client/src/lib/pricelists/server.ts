import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { Pricelist, PricelistSummary } from "../types";

export async function listPricelistsPage(): Promise<{
  items: Pricelist[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{ items: Pricelist[]; next_cursor: string | null }>(
      "/api/pricelists",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

/** Picker-shaped list — only active pricelists, no cursor. Used by
 *  the customer form's pricelist dropdown + future CO line forms. */
export async function listPricelistsForPicker(): Promise<
  PricelistSummary[] | null
> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const res = await api<{ items: PricelistSummary[] }>(
      "/api/pricelists?picker=true",
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return null;
  }
}

export async function getPricelist(uuid: string): Promise<Pricelist | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { pricelist } = await api<{ pricelist: Pricelist }>(
      `/api/pricelists/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return pricelist;
  } catch {
    return null;
  }
}
