import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { NpdIntegrationConfig } from "./types";

/**
 * Load the current NPD reverse-integration config for the caller's
 * company. Returns ``null`` on any failure so RSCs can degrade to
 * "not configured" (== hide the R&D column, prompt on the settings
 * card) without throwing.
 */
export async function loadNpdIntegrationConfig(): Promise<
  NpdIntegrationConfig | null
> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { npd_integration } = await api<{
      npd_integration: NpdIntegrationConfig;
    }>("/api/settings/npd-integration", {
      token,
      cache: "no-store",
    });
    return npd_integration;
  } catch {
    return null;
  }
}
