import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  CustomerCredit,
  LoyaltyDashboard,
  LoyaltyProgram,
} from "../types";

/** Whole-dashboard payload — programs grid + per-customer balances +
 *  recent ledger. Server components await this directly; the
 *  `/api/loyalty/dashboard` proxy is what client code hits for live
 *  refreshes. */
export async function getLoyaltyDashboard(): Promise<LoyaltyDashboard | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<LoyaltyDashboard>("/api/loyalty/dashboard", {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

/** Bare list of programs — used by the customer-form picker and by
 *  any "all programs" surface. */
export async function listLoyaltyPrograms(): Promise<LoyaltyProgram[] | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const res = await api<{ items: LoyaltyProgram[] }>(
      "/api/loyalty/programs",
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return null;
  }
}

export async function getLoyaltyProgram(
  uuid: string,
): Promise<LoyaltyProgram | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { loyalty_program } = await api<{ loyalty_program: LoyaltyProgram }>(
      `/api/loyalty/programs/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return loyalty_program;
  } catch {
    return null;
  }
}

/** Customer-scoped ledger + running balance. Mirrors what the BE
 *  returns from `/api/customers/:customer_id/credits`. */
export async function getCustomerCredits(
  customerUuid: string,
): Promise<{
  balance: string;
  currency_code: string;
  items: CustomerCredit[];
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{
      balance: string;
      currency_code: string;
      items: CustomerCredit[];
    }>(`/api/customers/${encodeURIComponent(customerUuid)}/credits`, {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}
