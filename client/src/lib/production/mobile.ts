import "server-only";
import { api } from "../api";
import { getDeviceToken } from "../devices/server";
import type { Machine } from "./types";

/**
 * Mobile-side server helpers for production entities — all authed via
 * the device bearer cookie set at pair time, not the laptop session
 * cookie. The phone has no session, only a device token that inherits
 * the paired user's permissions.
 */

export async function getMachineForScan(uuid: string): Promise<Machine | null> {
  const token = await getDeviceToken();
  if (!token) return null;
  try {
    const { machine } = await api<{ machine: Machine }>(
      `/api/production/machines/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return machine;
  } catch {
    return null;
  }
}
