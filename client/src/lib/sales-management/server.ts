import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { SalesManagementSnapshot } from "../types";

export async function getSalesManagementSnapshot(): Promise<{
  sales_management: SalesManagementSnapshot;
  base_currency: string;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{
      sales_management: SalesManagementSnapshot;
      base_currency: string;
    }>("/api/sales-management", { token, cache: "no-store" });
  } catch {
    return null;
  }
}
