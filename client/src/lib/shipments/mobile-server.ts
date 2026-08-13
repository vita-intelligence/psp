import "server-only";

import { api } from "../api";
import { getDeviceToken } from "../devices/server";
import { getSessionToken } from "../auth/server";

export interface DispatchPickupRow {
  uuid: string;
  code: string;
  recipient_name: string | null;
  ship_to_city: string | null;
  ship_to_country: string | null;
  planned_ship_at: string | null;
  qty: string | null;
  unit_symbol: string | null;
  lot_code: string | null;
  item_name: string | null;
  customer_name: string | null;
}

export interface DispatchPickupPage {
  items: DispatchPickupRow[];
  /** Opaque cursor for the next page — pass through unmodified to
   *  the follow-up request. ``null`` means the caller has the last
   *  page. */
  next_cursor: string | null;
}

const EMPTY_PAGE: DispatchPickupPage = { items: [], next_cursor: null };

/** First page for the mobile dispatch queue. Device token preferred
 *  (tablet flow), session-token fallback so desk-based ops can still
 *  QA the page from a laptop. */
export async function getFirstDispatchPickupPage(
  opts: { search?: string; limit?: number } = {},
): Promise<DispatchPickupPage> {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) return EMPTY_PAGE;

  const qs = new URLSearchParams();
  if (opts.search) qs.set("search", opts.search);
  if (opts.limit) qs.set("limit", String(opts.limit));
  const query = qs.toString();
  const path = query ? `/api/m/dispatch-pickups?${query}` : "/api/m/dispatch-pickups";

  try {
    return await api<DispatchPickupPage>(path, {
      token,
      cache: "no-store",
    });
  } catch {
    // A broken queue endpoint shouldn't lock the operator out of the
    // page. Empty list falls through and the UI shows the empty state.
    return EMPTY_PAGE;
  }
}
