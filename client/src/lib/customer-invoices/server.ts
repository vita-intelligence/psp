import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { CustomerInvoice } from "../types";

export async function listCustomerInvoicesPage(): Promise<{
  items: CustomerInvoice[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{ items: CustomerInvoice[]; next_cursor: string | null }>(
      "/api/customer-invoices",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export async function getCustomerInvoice(
  uuid: string,
): Promise<CustomerInvoice | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { customer_invoice } = await api<{
      customer_invoice: CustomerInvoice;
    }>(`/api/customer-invoices/${encodeURIComponent(uuid)}`, {
      token,
      cache: "no-store",
    });
    return customer_invoice;
  } catch {
    return null;
  }
}
