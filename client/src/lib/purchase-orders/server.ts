import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { PurchaseOrder } from "../types";

export async function listPurchaseOrdersPage(): Promise<{
  items: PurchaseOrder[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<{ items: PurchaseOrder[]; next_cursor: string | null }>(
      "/api/purchase-orders",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export async function getPurchaseOrder(uuid: string): Promise<PurchaseOrder | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const { purchase_order } = await api<{ purchase_order: PurchaseOrder }>(
      `/api/purchase-orders/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return purchase_order;
  } catch {
    return null;
  }
}
