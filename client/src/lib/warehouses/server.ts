// Server-only helpers for fetching warehouses. Browser never hits
// /api/warehouses directly — token stays in the httpOnly cookie.

import { api, ApiError } from "../api";
import { getSessionToken } from "../auth/server";
import type { Warehouse } from "../types";

export async function listWarehouses(): Promise<Warehouse[]> {
  const token = await getSessionToken();
  if (!token) return [];

  try {
    const { warehouses } = await api<{ warehouses: Warehouse[] }>(
      "/api/warehouses",
      { token },
    );
    return warehouses;
  } catch (err) {
    if (err instanceof ApiError) return [];
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
