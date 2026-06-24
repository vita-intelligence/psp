import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { CustomerOrder } from "../types";

export async function listCustomerOrdersPage(): Promise<{
  items: CustomerOrder[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{ items: CustomerOrder[]; next_cursor: string | null }>(
      "/api/customer-orders",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export async function getCustomerOrder(uuid: string): Promise<CustomerOrder | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { customer_order } = await api<{ customer_order: CustomerOrder }>(
      `/api/customer-orders/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return customer_order;
  } catch {
    return null;
  }
}
