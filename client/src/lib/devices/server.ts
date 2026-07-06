import "server-only";

import { cookies } from "next/headers";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import { serverEnv } from "../env";
import type {
  DevicePairingCode,
  LinkedDevice,
} from "../types";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** What gets stashed in the (non-httpOnly) display cookie so the
 *  mobile shell can render "Connected as X · Device Y" without an
 *  extra fetch. NOT auth — purely UI state.
 *
 *  Kept deliberately tiny (under ~256 bytes) because iOS Safari
 *  silently drops cookies over ~4KB and the full User payload with
 *  permissions + avatar blows that out — when the cookie disappears,
 *  /m can't render and bounces back to /pair. Anything heavier than
 *  this should come from a server fetch keyed by the device token. */
export interface DeviceDisplay {
  user_name: string;
  user_email: string;
  user_uuid?: string;
  device_uuid: string;
  device_label: string;
}

/**
 * Mobile-side: read the device bearer token (set when /pair claimed
 * a code). Mirrors `getSessionToken` but for the paired-device cookie.
 */
export async function getDeviceToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(serverEnv.deviceCookieName)?.value ?? null;
}

/**
 * Mobile-side: read the cached `{user, device}` display blob written
 * alongside the device bearer at claim time. NOT auth — purely so the
 * mobile shell can render "Connected as X · Device Y" without an
 * extra fetch.
 */
export async function getDeviceDisplay(): Promise<DeviceDisplay | null> {
  const store = await cookies();
  const raw = store.get(serverEnv.deviceUserCookieName)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DeviceDisplay;
  } catch {
    return null;
  }
}

export async function setDeviceCookies(token: string, display: DeviceDisplay) {
  const store = await cookies();
  store.set(serverEnv.deviceCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  store.set(serverEnv.deviceUserCookieName, JSON.stringify(display), {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}

export async function clearDeviceCookies() {
  const store = await cookies();
  store.delete(serverEnv.deviceCookieName);
  store.delete(serverEnv.deviceUserCookieName);
}

/**
 * Laptop-side: list this user's currently-paired devices, scoped to
 * the session. Used by /settings/devices SSR.
 */
export async function listDevices(): Promise<LinkedDevice[]> {
  const token = await getSessionToken();
  if (!token) return [];
  try {
    const res = await api<{ items: LinkedDevice[] }>("/api/devices", {
      token,
      cache: "no-store",
    });
    return res.items;
  } catch {
    return [];
  }
}

/**
 * Public-side: validate a pairing code on the /pair page before
 * showing the claim form. Returns null if the code is missing,
 * expired, or already claimed (the page just shows an error banner).
 */
export async function lookupPairingCode(
  code: string,
): Promise<DevicePairingCode | null> {
  try {
    const res = await api<{ pairing: DevicePairingCode }>(
      `/api/devices/pairing-codes/${encodeURIComponent(code)}`,
      { cache: "no-store" },
    );
    return res.pairing;
  } catch {
    return null;
  }
}
