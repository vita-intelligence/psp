import "server-only";
import { api } from "../api";
import { getDeviceToken } from "../devices/server";

/**
 * Server-side helpers for the /m mobile shell. The mobile home page
 * used to load a full list per queue just to read `.length` for the
 * tile badges — fine at seed-scale, catastrophic at real scale.
 *
 * This file centralises the ONE call that replaces those four fetches:
 * a slim `/api/m/home-counts` endpoint that runs per-bucket
 * capped-COUNT queries backend-side. Response stays O(cap) regardless
 * of underlying table size.
 */

/** One integer per mobile tile bucket. Keys match the JSON payload
 *  from `Backend.Mobile.home_counts/1`. Zero for buckets the caller
 *  doesn't have RBAC access to — the FE hides the tile anyway, so
 *  the zero costs nothing to render. */
export interface MobileHomeCounts {
  pickup: number;
  preflight: number;
  closeout: number;
  putaway: number;
  incoming_today: number;
  submitted_inspections: number;
  return_pickup: number;
  three_pl_dispatch: number;
}

export interface MobileHomeCountsPayload {
  /** Server-configured display cap. Counts equal to this value should
   *  render as `{cap}+` on the badge. */
  cap: number;
  counts: MobileHomeCounts;
}

const EMPTY: MobileHomeCountsPayload = {
  cap: 99,
  counts: {
    pickup: 0,
    preflight: 0,
    closeout: 0,
    putaway: 0,
    incoming_today: 0,
    submitted_inspections: 0,
    return_pickup: 0,
    three_pl_dispatch: 0,
  },
};

export async function getMobileHomeCounts(): Promise<MobileHomeCountsPayload> {
  const token = await getDeviceToken();
  if (!token) return EMPTY;
  try {
    return await api<MobileHomeCountsPayload>("/api/m/home-counts", {
      token,
      cache: "no-store",
    });
  } catch {
    // Silent fail — a broken counts endpoint shouldn't lock the
    // operator out of the mobile shell. Fall back to zeros; the
    // downstream list pages still render correctly.
    return EMPTY;
  }
}
