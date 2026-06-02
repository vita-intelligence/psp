// Server-only helpers for fetching permission templates. The browser
// never hits /api/roles directly — the httpOnly cookie + token live
// server-side and Phoenix only sees the Bearer header.

import { api, ApiError } from "../api";
import { getSessionToken } from "../auth/server";
import type { PageResult } from "@/components/data-table";
import type { PermissionTemplate } from "../types";

/**
 * Pre-fetch the first page server-side so the DataTable has data on
 * first paint. Subsequent pages / sort / search go through the client
 * fetcher via `/api/roles`.
 */
export async function listTemplatesFirstPage(
  limit = 25,
): Promise<PageResult<PermissionTemplate>> {
  const token = await getSessionToken();
  if (!token) return { items: [], next_cursor: null };

  try {
    return await api<PageResult<PermissionTemplate>>(
      `/api/roles?limit=${limit}`,
      { token },
    );
  } catch (err) {
    if (err instanceof ApiError) return { items: [], next_cursor: null };
    throw err;
  }
}

/** Looks up a template by its public UUID. Returns `null` on 404 /
 *  malformed UUID so callers can render `notFound()` cleanly. */
export async function getTemplate(
  uuid: string,
): Promise<PermissionTemplate | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { template } = await api<{ template: PermissionTemplate }>(
      `/api/roles/${uuid}`,
      { token },
    );
    return template;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}
