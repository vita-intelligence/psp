import "server-only";
import { api } from "../api";
import { getDeviceToken } from "../devices/server";
import type { Equipment } from "./types";

/**
 * Mobile-side server helper for the equipment scan flow. Auths via
 * the device bearer cookie set at pair time. Falls back to
 * `null` on any failure so the page can render a 404 gracefully.
 */
export async function getEquipmentForScan(
  uuid: string,
): Promise<Equipment | null> {
  const token = await getDeviceToken();
  if (!token) return null;
  try {
    const { equipment } = await api<{ equipment: Equipment }>(
      `/api/equipment/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return equipment;
  } catch {
    return null;
  }
}
