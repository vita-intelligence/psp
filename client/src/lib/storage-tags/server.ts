import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { StorageTag } from "../types";

/**
 * Read the company's storage tag list — picker variant. Returns
 * every tag matching the `kind` (or all when omitted). Used by
 * server components that need the registry on first render (the
 * warehouse plan editor's picker).
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

/**
 * Cursor-paginated server fetch — feeds the admin DataTable. The
 * caller (the table) hits this once for SSR; subsequent pages,
 * search, and sort go through the client-side fetchPage which calls
 * the same `/api/storage-tags` endpoint.
 */
export async function listStorageTagsPage(): Promise<{
  items: StorageTag[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{ items: StorageTag[]; next_cursor: string | null }>(
      "/api/storage-tags",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

/** Single-tag fetch for the edit page. */
export async function getStorageTag(uuid: string): Promise<StorageTag | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { tag } = await api<{ tag: StorageTag }>(
      `/api/storage-tags/${uuid}`,
      { token, cache: "no-store" },
    );
    return tag;
  } catch {
    return null;
  }
}
