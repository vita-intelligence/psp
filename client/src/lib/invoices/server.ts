import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  ProcurementInvoice,
  ProcurementInvoiceListPage,
} from "./types";

/** Per-PO listing — used by the PO detail Invoices card. The BE
 *  bypasses pagination because each PO carries fewer than ~10
 *  invoices in practice. */
export async function listInvoicesForPO(
  poUuid: string,
): Promise<ProcurementInvoice[]> {
  const token = await getSessionToken();
  if (!token) return [];
  try {
    const { items } = await api<{ items: ProcurementInvoice[] }>(
      `/api/purchase-orders/${encodeURIComponent(poUuid)}/invoices`,
      { token, cache: "no-store" },
    );
    return items;
  } catch {
    return [];
  }
}

/** Global AP-ledger feed. Mirrors the MRPEasy "Incoming invoices"
 *  page — items + a multi-currency totals stack for the header. */
export async function listInvoicesPage(
  qs: string = "",
): Promise<ProcurementInvoiceListPage | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const suffix = qs ? `?${qs}` : "";
    return await api<ProcurementInvoiceListPage>(
      `/api/procurement/invoices${suffix}`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
