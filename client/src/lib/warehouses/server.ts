// Server-only helpers for fetching warehouses. Browser never hits
// /api/warehouses directly — token stays in the httpOnly cookie.

import { api, ApiError } from "../api";
import { getSessionToken } from "../auth/server";
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

export async function getWarehouse(id: string | number): Promise<Warehouse | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { warehouse } = await api<{ warehouse: Warehouse }>(
      `/api/warehouses/${id}`,
      { token },
    );
    return warehouse;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}
