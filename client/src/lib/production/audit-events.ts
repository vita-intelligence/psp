import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";

/** Every audit-event kind emitted by the workstation ledger. Same
 *  vocabulary the backend changeset enforces — extended values need
 *  a schema PR here first. */
export type WorkstationEventKind =
  | "cleaning_completed"
  | "maintenance_completed"
  | "cleaning_started"
  | "maintenance_started"
  | "note";

export interface WorkstationEventRow {
  id: number;
  uuid: string;
  kind: WorkstationEventKind;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  worker_external_id: string | null;
  worker_name: string | null;
  form_response_uuid: string | null;
  vp_session_id: number | null;
  vp_shift_id: number | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  inserted_at: string;
}

export interface WorkstationAuditEnvelope {
  id: number;
  uuid: string;
  name: string;
  last_cleaning_at: string | null;
  next_cleaning_due_at: string | null;
  last_maintenance_at: string | null;
  next_maintenance_due_at: string | null;
  cleaning_periodicity: string | null;
  cleaning_periodicity_interval: number | null;
  maintenance_periodicity: string | null;
  maintenance_periodicity_interval: number | null;
}

export interface WorkstationEventPage {
  items: WorkstationEventRow[];
  next_cursor: string | null;
  workstation: WorkstationAuditEnvelope;
}

export interface ListWorkstationEventsOpts {
  cursor?: string | null;
  limit?: number;
  /** Comma-separated list of ``WorkstationEventKind`` values. Absent
   *  = every kind. */
  kinds?: WorkstationEventKind[];
}

function toQuery(opts: ListWorkstationEventsOpts): string {
  const params = new URLSearchParams();
  if (typeof opts.limit === "number") params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.kinds && opts.kinds.length > 0) {
    params.set("kind", opts.kinds.join(","));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** First page of the workstation audit-events feed. Returns `null`
 *  on transport failure so the RSC can render the "unavailable"
 *  shell instead of throwing on the paint pass. */
export async function listWorkstationEvents(
  workstationUuid: string,
  opts: ListWorkstationEventsOpts = {},
): Promise<WorkstationEventPage | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<WorkstationEventPage>(
      `/api/production/workstations/${encodeURIComponent(
        workstationUuid,
      )}/events${toQuery(opts)}`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
