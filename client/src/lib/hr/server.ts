import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { WorkstationSessionRow } from "../production/sessions";
import type {
  HREmployee,
  HREmployeeLedgerPage,
  HREmployeeReputationEvent,
  HREmployeeWage,
} from "./types";

/** First page of the HR employees ledger. Server components render this
 *  and hand it to `<HREmployeesLedger>` — subsequent pages come from the
 *  DataTable's own `fetchPage` closure so the sort / filter / search
 *  toolbar drives them client-side. */
export async function listHREmployeesFirstPage(): Promise<HREmployeeLedgerPage | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<HREmployeeLedgerPage>("/api/hr/employees", {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

/** Full-detail employee fetch used by the detail page. */
export async function getHREmployee(uuid: string): Promise<HREmployee | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const { employee } = await api<{ employee: HREmployee }>(
      `/api/hr/employees/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return employee;
  } catch {
    return null;
  }
}

/** Options accepted by every timeline fetcher. Cursor-based keyset
 *  pagination, matching the backend `ListQueries.paginate/5` contract. */
export interface HRTimelineOpts {
  /** Page size — clamped to [1, 100] server-side. Defaults:
   *   - profile-page sidebar cards: 5 (the tight preview)
   *   - dedicated infinite-scroll pages: 50 */
  limit?: number;
  /** Opaque keyset cursor. `null` from the previous page means the tail
   *  has been served; don't fetch. */
  cursor?: string | null;
}

/** Envelope every paginated timeline fetcher returns. Cursor-based —
 *  the caller keeps appending pages until `next_cursor === null`. */
export interface HRTimelinePage<T> {
  items: T[];
  next_cursor: string | null;
}

/** Query-string builder shared by every timeline fetch. Empty by
 *  default so the profile card gets the server default (5). */
function toQuery({ limit, cursor }: HRTimelineOpts): string {
  const params = new URLSearchParams();
  if (typeof limit === "number") params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  const s = params.toString();
  return s ? `?${s}` : "";
}

function emptyPage<T>(): HRTimelinePage<T> {
  return { items: [], next_cursor: null };
}

export async function listHREmployeeWages(
  uuid: string,
  opts: HRTimelineOpts = {},
): Promise<HRTimelinePage<HREmployeeWage>> {
  const token = await getSessionToken();
  if (!token) return emptyPage<HREmployeeWage>();
  try {
    const data = await api<HRTimelinePage<HREmployeeWage>>(
      `/api/hr/employees/${encodeURIComponent(uuid)}/wages${toQuery(opts)}`,
      { token, cache: "no-store" },
    );
    return { items: data.items ?? [], next_cursor: data.next_cursor ?? null };
  } catch {
    return emptyPage<HREmployeeWage>();
  }
}

export async function listHREmployeeReputationEvents(
  uuid: string,
  opts: HRTimelineOpts = {},
): Promise<HRTimelinePage<HREmployeeReputationEvent>> {
  const token = await getSessionToken();
  if (!token) return emptyPage<HREmployeeReputationEvent>();
  try {
    const data = await api<HRTimelinePage<HREmployeeReputationEvent>>(
      `/api/hr/employees/${encodeURIComponent(
        uuid,
      )}/reputation-events${toQuery(opts)}`,
      { token, cache: "no-store" },
    );
    return { items: data.items ?? [], next_cursor: data.next_cursor ?? null };
  } catch {
    return emptyPage<HREmployeeReputationEvent>();
  }
}

/**
 * Workstation sessions clocked against this employee. Backend sorts
 * newest-first and blends every kind (production, cleaning,
 * maintenance, other) into one story so the profile page can render
 * a chronological "what did they do at the kiosk" feed.
 *
 * Envelope key from the API is `sessions` (kept for backwards-compat);
 * we normalise to the shared `{ items, next_cursor }` shape here so
 * every timeline consumer looks identical.
 */
export async function listHREmployeeSessions(
  uuid: string,
  opts: HRTimelineOpts = {},
): Promise<HRTimelinePage<WorkstationSessionRow>> {
  const token = await getSessionToken();
  if (!token) return emptyPage<WorkstationSessionRow>();
  try {
    const data = await api<{
      sessions: WorkstationSessionRow[];
      next_cursor: string | null;
    }>(
      `/api/hr/employees/${encodeURIComponent(uuid)}/sessions${toQuery(opts)}`,
      { token, cache: "no-store" },
    );
    return {
      items: data.sessions ?? [],
      next_cursor: data.next_cursor ?? null,
    };
  } catch {
    return emptyPage<WorkstationSessionRow>();
  }
}
