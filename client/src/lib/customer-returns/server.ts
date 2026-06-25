import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { CustomerInvoice, CustomerReturn } from "../types";

export async function listCustomerReturnsPage(): Promise<{
  items: CustomerReturn[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{ items: CustomerReturn[]; next_cursor: string | null }>(
      "/api/customer-returns",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export async function getCustomerReturn(uuid: string): Promise<{
  customer_return: CustomerReturn;
  credit_note: CustomerInvoice | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{
      customer_return: CustomerReturn;
      credit_note: CustomerInvoice | null;
    }>(`/api/customer-returns/${encodeURIComponent(uuid)}`, {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}
