import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { InspectionsLedgerPage } from "./types";

/**
 * Server-side initial paint for the desktop `/procurement/inspections`
 * ledger. Mirrors `listInvoicesPage` — returns the first page so SSR
 * can hydrate the DataTable, then the client takes over for paging /
 * filtering / sort.
 */
export async function listInspectionsPage(): Promise<InspectionsLedgerPage | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<InspectionsLedgerPage>(
      "/api/procurement/inspections",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
