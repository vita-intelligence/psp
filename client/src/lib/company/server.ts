// Server-only helpers for fetching the Company singleton. The
// browser never hits /api/company directly — server components and
// server actions fetch it server-side using the cookie token.

import { api, ApiError } from "../api";
import { getSessionToken } from "../auth/server";
import type { Company } from "../types";

export async function getCompany(): Promise<Company | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { company } = await api<{ company: Company }>("/api/company", { token });
    return company;
  } catch (err) {
    // 403 = user is signed in but lacks `company.view`. The page-
    // level RBAC gate (`Can` / hasPermission) renders the empty-state
    // before we get here in the common case; this is a belt-and-
    // braces fallback.
    if (err instanceof ApiError) return null;
    throw err;
  }
}
