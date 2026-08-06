import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";

/**
 * Non-privileged NPD-integration snapshot — just enough to build a
 * deep-link into NPD from a PSP surface. The auth token stays server-
 * only; only enabled + the frontend URL are exposed here.
 *
 * `frontend_url` is intentionally distinct from `npd_base_url` (which
 * targets NPD's HTTP API for server-to-server calls). Deep-links in
 * the browser need the Next.js origin, not the Django API origin.
 *
 * Reads from `GET /api/settings/npd-integration/public`.
 */
export interface NpdPublicConfig {
  enabled: boolean;
  frontend_url: string | null;
}

export async function getNpdPublicConfig(): Promise<NpdPublicConfig> {
  const token = await getSessionToken();
  if (!token) return { enabled: false, frontend_url: null };

  try {
    const { npd_integration } = await api<{ npd_integration: NpdPublicConfig }>(
      `/api/settings/npd-integration/public`,
      { token, cache: "no-store" },
    );
    return npd_integration;
  } catch {
    return { enabled: false, frontend_url: null };
  }
}
