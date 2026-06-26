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

export type ListMyDevicesResult =
  | { ok: true; devices: LinkedDevice[] }
  | ErrorResult;

export type PushNavigateResult =
  | { ok: true; pushed_to: LinkedDevice[] }
  | ErrorResult;

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

/**
 * Laptop: list paired devices for the current user. Used by the
 * "Send to device" modal so the operator can pick which phone to
 * push to (or fall back to QR when they haven't paired anything).
 */
export async function listMyDevicesAction(): Promise<ListMyDevicesResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("listMyDevicesAction");

  try {
    const res = await api<{ items: LinkedDevice[] }>("/api/devices", {
      method: "GET",
      token,
    });
    return { ok: true, devices: res.items };
  } catch (err) {
    return toErrorResult(err, {
      source: "listMyDevicesAction",
      fallbackDetail: "Couldn't load your paired devices.",
    });
  }
}

/**
 * Laptop: fan out a navigate command to every paired device. The
 * mobile shell on each device hard-replaces its route to `path`.
 * BE rejects anything outside `/m/*`.
 */
export async function pushNavigateToMyDevicesAction(
  path: string,
): Promise<PushNavigateResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("pushNavigateToMyDevicesAction");

  try {
    const res = await api<{ pushed_to: LinkedDevice[] }>(
      "/api/devices/push-navigate",
      { method: "POST", token, body: JSON.stringify({ path }) },
    );
    return { ok: true, pushed_to: res.pushed_to };
  } catch (err) {
    return toErrorResult(err, {
      source: "pushNavigateToMyDevicesAction",
      fallbackDetail: "Couldn't push to your devices.",
    });
  }
}

/** Laptop: push a navigate command to a single paired device. */
export async function pushNavigateToDeviceAction(
  uuid: string,
  path: string,
): Promise<PushNavigateResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("pushNavigateToDeviceAction");

  try {
    const res = await api<{ device: LinkedDevice }>(
      `/api/devices/${encodeURIComponent(uuid)}/push-navigate`,
      { method: "POST", token, body: JSON.stringify({ path }) },
    );
    return { ok: true, pushed_to: [res.device] };
  } catch (err) {
    return toErrorResult(err, {
      source: "pushNavigateToDeviceAction",
      fallbackDetail: "Couldn't push to that device.",
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
