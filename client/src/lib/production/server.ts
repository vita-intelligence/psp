import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { BOM, BOMLedgerPage } from "./types";

export interface ListBOMsOpts {
  /** Append to the upstream query string verbatim — e.g.
   *  `"item_id=42&limit=25"`. */
  query?: string;
}

export async function listBOMsPage(
  opts: ListBOMsOpts = {},
): Promise<BOMLedgerPage | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const qs = opts.query ? `?${opts.query}` : "";
  try {
    return await api<BOMLedgerPage>(`/api/production/boms${qs}`, {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

export async function getBOM(uuid: string): Promise<BOM | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const { bom } = await api<{ bom: BOM }>(
      `/api/production/boms/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return bom;
  } catch {
    return null;
  }
}

/**
 * Fetch every BOM attached to one output item. Used by the Item
 * detail page's BOMs card. Sorts the primary first.
 */
export async function listBOMsForItem(
  itemId: number,
): Promise<BOMLedgerPage["items"]> {
  const token = await getSessionToken();
  if (!token) return [];
  try {
    const page = await api<BOMLedgerPage>(
      `/api/production/boms?item_id=${encodeURIComponent(String(itemId))}&limit=50&sort=is_primary:desc`,
      { token, cache: "no-store" },
    );
    // Backend default sort still applies after; the FE sorts again
    // to make absolutely sure the primary lands first.
    return page.items.slice().sort((a, b) => {
      if (a.is_primary === b.is_primary) return 0;
      return a.is_primary ? -1 : 1;
    });
  } catch {
    return [];
  }
}
