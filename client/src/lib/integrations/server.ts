import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { IntegrationTokenList } from "./types";

/**
 * Server-side fetch of the integration-token list for the current
 * user's company. Returns null on any failure so the RSC can degrade
 * to a neutral empty state — the client component will retry on
 * navigation.
 */
export async function listIntegrationTokens(): Promise<IntegrationTokenList | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<IntegrationTokenList>("/api/integration-tokens", {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}
