import "server-only";

import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { ProductionRunEntry } from "../production/types";

export interface ProductionRunQueueResponse {
  items: ProductionRunEntry[];
}

/**
 * Production-runs queue for the /production/runs tab. Returns the
 * MOs that are preflight-cleared and either ready-to-start (status
 * `scheduled` + every booking received) or actively `in_progress`.
 */
export async function getProductionRunQueue(): Promise<ProductionRunQueueResponse | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<ProductionRunQueueResponse>(
      "/api/production/runs",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
