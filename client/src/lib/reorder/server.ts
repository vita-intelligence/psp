import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { ReorderSuggestion } from "./types";

/** Fetch every item currently under its reorder threshold. Returns
 *  null on any failure so the calling RSC can render an empty state
 *  gracefully. */
export async function listReorderSuggestions(): Promise<{
  suggestions: ReorderSuggestion[];
  total: number;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{ suggestions: ReorderSuggestion[]; total: number }>(
      "/api/procurement/reorder-suggestions",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
