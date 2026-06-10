import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { Vendor, VendorSummary } from "../types";

export async function listVendorsPage(): Promise<{
  items: Vendor[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{ items: Vendor[]; next_cursor: string | null }>(
      "/api/vendors",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

/** Picker-shaped list — only active vendors, no cursor. Used by the
 *  PO form's vendor dropdown. */
export async function listVendorsForPicker(): Promise<VendorSummary[] | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const res = await api<{ items: VendorSummary[] }>(
      "/api/vendors?picker=true",
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return null;
  }
}

export async function getVendor(uuid: string): Promise<Vendor | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { vendor } = await api<{ vendor: Vendor }>(
      `/api/vendors/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return vendor;
  } catch {
    return null;
  }
}
