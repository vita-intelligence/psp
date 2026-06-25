import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { OrderWizardSnapshot } from "../types";

/**
 * Fetches the order-wizard snapshot for a customer order. Returns
 * `null` if there's no session or the BE call fails — the page
 * renders a graceful empty state in that case.
 */
export async function getOrderWizard(
  coUuid: string,
): Promise<OrderWizardSnapshot | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { wizard } = await api<{ wizard: OrderWizardSnapshot }>(
      `/api/customer-orders/${encodeURIComponent(coUuid)}/wizard`,
      { token, cache: "no-store" },
    );
    return wizard;
  } catch {
    return null;
  }
}
