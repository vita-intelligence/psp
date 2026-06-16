import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { Comment, CommentEntityType } from "./types";

/** Map of entity type → URL path prefix. Kept here so the server
 *  fetch + the actions + the proxy routes agree on one source of
 *  truth — adding a new entity type means editing this map once. */
export const COMMENTS_PATH: Record<CommentEntityType, string> = {
  vendor: "vendors",
  purchase_order: "purchase-orders",
  stock_lot: "stock/lots",
  purchase_order_line: "purchase-order-lines",
  bom: "production/boms",
  workstation_group: "production/workstation-groups",
  workstation: "production/workstations",
  routing: "production/routings",
};

/** Server-component-friendly initial timeline fetch. Returns null on
 *  any error so the calling RSC can render a graceful empty state
 *  (the client component will retry / show the live channel anyway). */
export async function listCommentsForEntity(
  entityType: CommentEntityType,
  entityUuid: string,
): Promise<Comment[] | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const prefix = COMMENTS_PATH[entityType];
  if (!prefix) return null;

  try {
    const { items } = await api<{ items: Comment[] }>(
      `/api/${prefix}/${encodeURIComponent(entityUuid)}/comments`,
      { token, cache: "no-store" },
    );
    return items;
  } catch {
    return null;
  }
}
