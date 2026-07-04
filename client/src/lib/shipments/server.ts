import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import { getDeviceToken } from "../devices/server";
import { toJsonError } from "../errors/server";
import type { Shipment, ShipmentListResponse } from "./types";

async function token(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

export async function getShipment(uuid: string): Promise<Shipment | null> {
  const t = await token();
  if (!t) return null;
  try {
    const { shipment } = await api<{ shipment: Shipment }>(
      `/api/shipments/${encodeURIComponent(uuid)}`,
      { token: t },
    );
    return shipment;
  } catch {
    return null;
  }
}

export async function listShipments(
  opts: { status?: string } = {},
): Promise<ShipmentListResponse> {
  const t = await token();
  if (!t) return { items: [], next_cursor: null };
  try {
    const qs = new URLSearchParams();
    if (opts.status) qs.set("status", opts.status);
    const path = qs.toString()
      ? `/api/shipments?${qs.toString()}`
      : "/api/shipments";
    return await api<ShipmentListResponse>(path, { token: t });
  } catch {
    return { items: [], next_cursor: null };
  }
}

export type CreateShipmentServerResult =
  | { ok: true; shipment: Shipment }
  | { ok: false; code: string; detail: string };

/**
 * Server-render-safe shipment creation. `createShipmentAction` calls
 * `revalidatePath` which Next 16 refuses to run during a render;
 * this helper skips the cache invalidation so it can safely fire
 * from the /shipments/new server component. The next navigation
 * (redirect to /shipments/[uuid]) freshens the data anyway.
 */
export async function createShipmentServer(
  lotUuid: string,
): Promise<CreateShipmentServerResult> {
  const t = await token();
  if (!t) {
    return { ok: false, code: "unauthorized", detail: "Sign in to continue." };
  }
  try {
    const { shipment } = await api<{ shipment: Shipment }>("/api/shipments", {
      method: "POST",
      token: t,
      body: JSON.stringify({ lot_uuid: lotUuid }),
    });
    return { ok: true, shipment };
  } catch (err) {
    const { payload } = toJsonError(err, {
      source: "createShipmentServer",
      fallbackDetail: "Couldn't create the shipment.",
    });
    return {
      ok: false,
      code: payload.error ?? "error",
      detail: payload.detail,
    };
  }
}
