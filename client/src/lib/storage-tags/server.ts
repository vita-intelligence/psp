import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { StorageTag } from "../types";

/**
 * Read the company's storage tag list. Used by server components
 * that need the registry on first render (e.g. the admin page,
 * pre-populating the picker on the warehouse plan editor).
 */
export async function listStorageTags(
  kind?: "location" | "cell",
): Promise<StorageTag[] | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const qs = kind ? `?kind=${kind}` : "";
    const res = await api<{ items: StorageTag[] }>(
      `/api/storage-tags${qs}`,
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return null;
  }
}
