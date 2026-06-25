import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { CashFlowForecast } from "../types";

export async function getCashFlowForecast(): Promise<{
  cash_flow: CashFlowForecast;
  base_currency: string;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{ cash_flow: CashFlowForecast; base_currency: string }>(
      "/api/cash-flow",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
