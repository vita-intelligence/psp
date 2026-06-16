import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import { getDeviceToken } from "../devices/server";
import type { InspectionsLedgerPage } from "./types";

export interface ListInspectionsPageOpts {
  /** Append to the upstream query string verbatim — e.g.
   *  `"status=submitted&mine=true&limit=25"`. */
  query?: string;
}

/**
 * Server-side initial paint for both the desktop
 * `/procurement/inspections` ledger and the mobile `/m/inspections`
 * list. Tries session token first, then device — same dual-auth shape
 * as the goods-in fetchers.
 */
export async function listInspectionsPage(
  opts: ListInspectionsPageOpts = {},
): Promise<InspectionsLedgerPage | null> {
  const token = (await getSessionToken()) ?? (await getDeviceToken());
  if (!token) return null;
  const qs = opts.query ? `?${opts.query}` : "";
  try {
    return await api<InspectionsLedgerPage>(
      `/api/procurement/inspections${qs}`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
