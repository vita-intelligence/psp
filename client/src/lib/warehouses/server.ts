// Server-only helpers for fetching warehouses. Browser never hits
// /api/warehouses directly — token stays in the httpOnly cookie.

import { api, ApiError } from "../api";
import { getSessionToken } from "../auth/server";
import { getDeviceToken } from "../devices/server";
import type { PageResult } from "@/components/data-table";
import type { Warehouse } from "../types";

/**
 * Pre-fetch the first page server-side so the DataTable has data on
 * first paint. The client takes over for subsequent pages, sort
 * changes, etc. Pass the result as `initialPage` on `<DataTable>`.
 */
export async function listWarehousesFirstPage(
  limit = 25,
): Promise<PageResult<Warehouse>> {
  const token = await getSessionToken();
  if (!token) return { items: [], next_cursor: null };

  try {
    return await api<PageResult<Warehouse>>(
      `/api/warehouses?limit=${limit}`,
      { token },
    );
  } catch (err) {
    if (err instanceof ApiError) return { items: [], next_cursor: null };
    throw err;
  }
}

/** Looks up a warehouse by its public UUID — the value from the URL
 *  param. Returns `null` on 404 / malformed UUID so the caller can
 *  render `notFound()` cleanly. */
export async function getWarehouse(uuid: string): Promise<Warehouse | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { warehouse } = await api<{ warehouse: Warehouse }>(
      `/api/warehouses/${uuid}`,
      { token },
    );
    return warehouse;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

// ---------------------------------------------------------------
// Production facilities — sibling helpers on the same row shape.
// ---------------------------------------------------------------

export async function listProductionFacilitiesFirstPage(
  limit = 25,
): Promise<PageResult<Warehouse>> {
  const token = await getSessionToken();
  if (!token) return { items: [], next_cursor: null };

  try {
    return await api<PageResult<Warehouse>>(
      `/api/production-facilities?limit=${limit}`,
      { token },
    );
  } catch (err) {
    if (err instanceof ApiError) return { items: [], next_cursor: null };
    throw err;
  }
}

export async function getProductionFacility(
  uuid: string,
): Promise<Warehouse | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { warehouse } = await api<{ warehouse: Warehouse }>(
      `/api/production-facilities/${uuid}`,
      { token },
    );
    return warehouse;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/** Slim active-warehouse list for the mobile picker. Tries the device
 *  bearer first so the tablet hits the endpoint without a laptop
 *  session, then falls back to the session token. Returns an empty
 *  list on any error — the picker just hides itself in that case. */
export async function listActiveWarehousesForMobile(): Promise<Warehouse[]> {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) return [];

  try {
    const { items } = await api<{ items: Warehouse[] }>(
      "/api/warehouses?limit=50&filter[is_active]=true",
      { token },
    );
    return items;
  } catch (err) {
    if (err instanceof ApiError) return [];
    throw err;
  }
}
