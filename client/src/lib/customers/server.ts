import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { Customer, CustomerSummary } from "../types";

export async function listCustomersPage(): Promise<{
  items: Customer[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{ items: Customer[]; next_cursor: string | null }>(
      "/api/customers",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

/** Picker-shaped list — only active customers, no cursor. Will be
 *  used by the Customer Order form's customer dropdown. */
export async function listCustomersForPicker(): Promise<CustomerSummary[] | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const res = await api<{ items: CustomerSummary[] }>(
      "/api/customers?picker=true",
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return null;
  }
}

export async function getCustomer(uuid: string): Promise<Customer | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { customer } = await api<{ customer: Customer }>(
      `/api/customers/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return customer;
  } catch {
    return null;
  }
}
