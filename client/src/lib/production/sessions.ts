/**
 * Workstation-session client — types + fetchers shared by the MO detail
 * page and the CO wizard. Sessions are the shop-floor record of "who
 * was clocked into which workstation on which step for how long, and
 * what did they produce". They're the atomic input for OEE, cost
 * roll-up, and the chronological session-story timeline.
 *
 * Server sorts newest-first (verified > completed > running is the
 * server's business; here we just render). Keep this file transport-
 * only — no formatting, no derived state.
 */

export interface WorkstationSessionRow {
  uuid: string;
  external_id: string | null;
  activity_kind: "mo" | "cleaning" | "maintenance" | "other";
  activity_label: string | null;
  status: "active" | "completed" | "verified";
  started_at: string;
  finished_at: string | null;
  duration_seconds: number | null;
  quantity_produced: string | null;
  quantity_rejected: string | null;
  performance_percentage: number | null;
  notes: string | null;
  workers: string[];
  worker_uuids: string[];
  workstation: { uuid: string; name: string; code: string | null } | null;
  manufacturing_order_step: {
    uuid: string;
    operation_description: string | null;
    sort_order: number | null;
    workstation_group_name: string | null;
    manufacturing_order_uuid: string | null;
    manufacturing_order_id: number | null;
  } | null;
  inserted_at: string;
}

export interface SessionsResponse {
  sessions: WorkstationSessionRow[];
}

async function fetchSessions(url: string): Promise<WorkstationSessionRow[]> {
  const res = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to load sessions (${res.status} ${res.statusText})`,
    );
  }
  const body = (await res.json()) as SessionsResponse;
  return body.sessions ?? [];
}

/** Sessions clocked against a specific Manufacturing Order. */
export function fetchSessionsForMO(
  moId: number,
): Promise<WorkstationSessionRow[]> {
  return fetchSessions(`/api/manufacturing-orders/${moId}/sessions`);
}

/** Sessions clocked against every MO under a Customer Order — used by
 *  the wizard where multiple MOs' sessions blend into one story. */
export function fetchSessionsForCO(
  coUuid: string,
): Promise<WorkstationSessionRow[]> {
  return fetchSessions(`/api/customer-orders/${coUuid}/sessions`);
}
