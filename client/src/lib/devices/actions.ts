"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";
import type { DevicePairingCode, LinkedDevice } from "../types";

export type CreatePairingCodeResult =
  | { ok: true; pairing: DevicePairingCode }
  | ErrorResult;

export type RevokeDeviceResult =
  | { ok: true; device: LinkedDevice }
  | ErrorResult;

export type SendPingResult = { ok: true } | ErrorResult;

/**
 * Laptop: create a one-time pairing code. The dialog renders the
 * returned code as a QR + 6-char fallback, and subscribes to the
 * `pairing:<uuid>` channel so it auto-closes once the phone claims.
 */
export async function createPairingCodeAction(): Promise<CreatePairingCodeResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createPairingCodeAction");

  try {
    const res = await api<{ pairing: DevicePairingCode }>(
      "/api/devices/pairing-codes",
      { method: "POST", token, body: JSON.stringify({}) },
    );
    return { ok: true, pairing: res.pairing };
  } catch (err) {
    return toErrorResult(err, {
      source: "createPairingCodeAction",
      fallbackDetail: "Couldn't generate a pairing code.",
    });
  }
}

// NOTE: `claimDeviceAction` moved out of Server Actions. The phone
// posts directly to `/api/device/claim` (a Route Handler) because
// iOS Safari (a) shows an HTTP-form-submit interstitial and
// (b) drops Set-Cookie on Server Action protocol responses over
// plain-HTTP LAN. The route handler is the only reliable path.

/** Laptop: revoke a device. Boots open sockets on the device side. */
export async function revokeDeviceAction(
  uuid: string,
): Promise<RevokeDeviceResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("revokeDeviceAction");

  try {
    const res = await api<{ device: LinkedDevice }>(
      `/api/devices/${encodeURIComponent(uuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath("/settings/devices");
    return { ok: true, device: res.device };
  } catch (err) {
    return toErrorResult(err, {
      source: "revokeDeviceAction",
      fallbackDetail: "Couldn't revoke that device.",
    });
  }
}

/** Laptop: send a test ping to a paired device. */
export async function sendPingAction(
  uuid: string,
  message?: string,
): Promise<SendPingResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("sendPingAction");

  try {
    await api<void>(`/api/devices/${encodeURIComponent(uuid)}/ping`, {
      method: "POST",
      token,
      body: JSON.stringify(message ? { message } : {}),
    });
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "sendPingAction",
      fallbackDetail: "Couldn't send the ping.",
    });
  }
}
