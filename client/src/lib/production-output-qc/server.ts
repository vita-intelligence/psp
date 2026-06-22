import "server-only";

import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { OutputQcEntry } from "../production/types";

export interface OutputQcQueueResponse {
  items: OutputQcEntry[];
}

/**
 * Output-QC queue for the desktop /production/output-qc tab. Returns
 * the manufactured stock_lots that are still `received` and awaiting
 * a pass / fail verdict.
 */
export async function getOutputQcQueue(): Promise<OutputQcQueueResponse | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<OutputQcQueueResponse>("/api/production/output-qc", {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}
