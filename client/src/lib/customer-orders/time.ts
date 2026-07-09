import "server-only";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";

/**
 * Wall-clock roll-up returned by
 * `GET /api/customer-orders/:uuid/time-breakdown`. All durations are
 * whole seconds so the client can format via `formatDurationLong`
 * without pulling a duration library.
 *
 * `is_live` is true when at least one phase is still open (no
 * `ended_at`). The wizard schedules a periodic refresh in that case
 * so the current-phase duration ticks up visibly.
 */
export interface COTimeBreakdown {
  customer_order: { uuid: string; code: string | null };
  started_at: string;
  ended_at: string | null;
  is_live: boolean;
  total_elapsed_seconds: number;
  labour_seconds: number;
  session_count: number;
  active_session_count: number;
  phases: Array<{
    /** Matches Backend.CustomerOrders.TimeBreakdown phase keys. Some
     *  are grouped (e.g. `preparing_production` covers the wizard's
     *  `production_planning` + `awaiting_ingredients` because we don't
     *  log the transition between them yet). */
    key:
      | "setup"
      | "approval"
      | "preparing_production"
      | "in_production"
      | "post_production_pre_dispatch"
      | "awaiting_pickup"
      | "dispatched"
      | "delivered"
      | "cancelled";
    label: string;
    started_at: string | null;
    ended_at: string | null;
    /** null when the phase hasn't been reached yet. */
    duration_seconds: number | null;
    /** True when the phase has a real `started_at`. False rows render
     *  as "not reached" rather than being dropped from the list. */
    is_tracked: boolean;
    is_current: boolean;
    is_terminal: boolean;
    description: string | null;
  }>;
  generated_at: string;
}

export async function getCOTimeBreakdown(
  uuid: string,
): Promise<COTimeBreakdown | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<COTimeBreakdown>(
      `/api/customer-orders/${encodeURIComponent(uuid)}/time-breakdown`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
