import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import { getDeviceToken } from "../devices/server";
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
