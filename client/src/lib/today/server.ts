import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { TodayBuckets } from "../types";

export async function getTodayBuckets(): Promise<TodayBuckets | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<TodayBuckets>("/api/today", { token, cache: "no-store" });
  } catch {
    return null;
  }
}
