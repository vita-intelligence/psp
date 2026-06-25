import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { StatisticsSnapshot } from "../types";

export async function getStatisticsSnapshot(): Promise<{
  statistics: StatisticsSnapshot;
  base_currency: string;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{ statistics: StatisticsSnapshot; base_currency: string }>(
      "/api/statistics",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
