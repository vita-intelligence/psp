import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { Allergen } from "../types";

/** Read the EU 14 allergen lookup — used by the raw-material form's
 *  multi-select. Cached at fetch time since the data is static. */
export async function listAllergens(): Promise<Allergen[] | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const res = await api<{ items: Allergen[] }>(`/api/allergens`, {
      token,
      cache: "no-store",
    });
    return res.items;
  } catch {
    return null;
  }
}
