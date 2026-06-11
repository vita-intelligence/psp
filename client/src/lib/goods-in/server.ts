import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import { getDeviceToken } from "../devices/server";
import type { User } from "../types";
import type { Inspection } from "./types";

/** Slim per-line view rendered on the mobile "Expected today" card —
 *  just enough to show "3 items · 540kg total" without scrolling. */
export interface MobileIncomingLine {
  uuid: string;
  qty_ordered: string;
  qty_received: string;
  /** `qty_ordered − qty_received`, server-computed so the FE doesn't
   *  do Decimal math in TypeScript. */
  remaining: string;
  item: {
    id: number;
    uuid: string;
    code: string | null;
    name: string;
  } | null;
}

/** PO header trimmed for the mobile card — vendor + warehouse + the
 *  remaining lines. No money, no approvals, no files. */
export interface MobileIncomingPo {
  id: number;
  uuid: string;
  code: string | null;
  status: "ordered" | "partially_received";
  expected_delivery_date: string;
  delivery_address: string | null;
  notes: string | null;
  vendor: {
    id: number;
    uuid: string;
    code: string | null;
    name: string;
  } | null;
  default_warehouse: {
    id: number;
    uuid: string;
    code: string | null;
    name: string;
  } | null;
  lines: MobileIncomingLine[];
}

/** Most-recent non-terminal Goods-In Inspection attached to the PO —
 *  surfaced on the card so the tap action can route between "start
 *  fresh" and "jump back into the draft". `null` ⇒ no open inspection. */
export interface MobileIncomingOpenInspection {
  id: number;
  uuid: string;
  status: "draft" | "submitted";
  delivery_date: string | null;
  goods_in_operator: { id: number; uuid: string; name: string } | null;
  quality_approver: { id: number; uuid: string; name: string } | null;
}

export interface MobileIncomingRow {
  purchase_order: MobileIncomingPo;
  open_inspection: MobileIncomingOpenInspection | null;
}

export interface MobileIncomingResponse {
  items: MobileIncomingRow[];
  /** ISO date → count. Drives the day-chip badges + summary line at
   *  the top of the mobile list. */
  by_day: Record<string, number>;
}

export interface MobileIncomingOpts {
  /** Horizon window in days from today. Defaults to 7 on the backend
   *  so the FE can omit it. */
  days?: number;
  /** Narrow to one warehouse (default-delivery site). */
  warehouseId?: number | null;
}

/**
 * "Expected today" board — slim list of POs in `ordered` or
 * `partially_received` status with an expected delivery date inside
 * the horizon window. Each row carries the most-recent non-terminal
 * inspection (if any) so the FE can route taps without an extra fetch.
 *
 * Auth: device token first (the tablet picks this up), session token
 * fallback (so the laptop can dev-test without re-pairing).
 */
export async function getMobileIncoming(
  opts: MobileIncomingOpts = {},
): Promise<MobileIncomingResponse | null> {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) return null;

  const params = new URLSearchParams();
  if (opts.days != null) params.set("days", String(opts.days));
  if (opts.warehouseId != null)
    params.set("warehouse_id", String(opts.warehouseId));

  const qs = params.toString();
  const path = `/api/m/incoming${qs ? `?${qs}` : ""}`;

  try {
    return await api<MobileIncomingResponse>(path, {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

/**
 * Look up a goods-in inspection by uuid. Used by the mobile wizard
 * route — falls back to the device bearer token when the dock device
 * cookie is set (mobile shell), then the laptop session cookie (when
 * QC opens the same URL from their desk).
 */
export async function getInspection(uuid: string): Promise<Inspection | null> {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) return null;
  try {
    const { goods_in_inspection } = await api<{
      goods_in_inspection: Inspection;
    }>(`/api/goods-in-inspections/${encodeURIComponent(uuid)}`, {
      token,
      cache: "no-store",
    });
    return goods_in_inspection;
  } catch {
    return null;
  }
}

/**
 * List every inspection on a PO (multi-delivery view). Useful for
 * showing "previous deliveries" on a PO drawer; the mobile wizard
 * itself only ever opens one inspection at a time.
 */
export async function listInspectionsForPo(
  poUuid: string,
): Promise<Inspection[]> {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) return [];
  try {
    const { items } = await api<{ items: Inspection[] }>(
      `/api/purchase-orders/${encodeURIComponent(poUuid)}/goods-in-inspections`,
      { token, cache: "no-store" },
    );
    return items;
  } catch {
    return [];
  }
}

/**
 * Resolve the user behind whichever bearer is active — used by the
 * wizard to decide whether to render the operator step 8 or the
 * approver review panel. Device token first (dock), session token
 * fallback (QC on the desk).
 */
export async function getInspectionViewer(): Promise<User | null> {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) return null;
  try {
    const { user } = await api<{ user: User }>(`/api/auth/me`, {
      token,
      cache: "no-store",
    });
    return user;
  } catch {
    return null;
  }
}
