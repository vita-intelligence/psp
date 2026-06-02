// Server-only helpers for the users team list. Same shape as
// `lib/warehouses/server.ts` — server-component fetchers that read
// the cookie token and call Phoenix without ever exposing the bearer
// to the browser.

import { api, ApiError } from "../api";
import { getSessionToken } from "../auth/server";
import type { PageResult } from "@/components/data-table";
import type { UserListEntry, User } from "../types";

/**
 * Pre-fetch the first page server-side so the DataTable has data on
 * first paint. The client takes over for subsequent pages / sort /
 * filter / search.
 */
export async function listUsersFirstPage(
  limit = 25,
): Promise<PageResult<UserListEntry>> {
  const token = await getSessionToken();
  if (!token) return { items: [], next_cursor: null };

  try {
    return await api<PageResult<UserListEntry>>(
      `/api/users?limit=${limit}`,
      { token },
    );
  } catch (err) {
    if (err instanceof ApiError) return { items: [], next_cursor: null };
    throw err;
  }
}

/** Looks up a user by their public UUID. Returns `null` on 404 /
 *  malformed UUID so callers can render `notFound()` cleanly. */
export async function getUser(
  uuid: string,
): Promise<(User & { is_online?: boolean }) | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { user } = await api<{ user: User & { is_online?: boolean } }>(
      `/api/users/${uuid}`,
      { token },
    );
    return user;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}
