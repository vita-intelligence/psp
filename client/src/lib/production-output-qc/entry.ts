import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { OutputQcEntry } from "../production/types";

/**
 * Fetch a single Output QC entry by lot uuid. Powers the detail page
 * at /production/output-qc/[lot_uuid].
 */
export async function getOutputQcEntry(
  lotUuid: string,
): Promise<OutputQcEntry | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const { entry } = await api<{ entry: OutputQcEntry }>(
      `/api/production/output-qc/${encodeURIComponent(lotUuid)}`,
      { token, cache: "no-store" },
    );
    return entry;
  } catch {
    return null;
  }
}
