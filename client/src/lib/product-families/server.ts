import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { ProductFamily } from "../types";

/**
 * Cursor-paginated server fetch — feeds the admin DataTable. The
 * caller (the table) hits this once for SSR; subsequent pages,
 * search, and sort go through the client-side fetchPage which hits
 * `/api/product-families` directly.
 */
export async function listProductFamiliesPage(): Promise<{
  items: ProductFamily[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{ items: ProductFamily[]; next_cursor: string | null }>(
      "/api/product-families",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

/** Single-family fetch for the edit page. */
export async function getProductFamily(
  uuid: string,
): Promise<ProductFamily | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { family } = await api<{ family: ProductFamily }>(
      `/api/product-families/${uuid}`,
      { token, cache: "no-store" },
    );
    return family;
  } catch {
    return null;
  }
}
