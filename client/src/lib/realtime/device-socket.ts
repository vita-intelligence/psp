"use client";

import { Socket } from "phoenix";
import { resolveSocketUrl } from "./socket-url";

/**
 * Single Phoenix socket per mobile tab, authenticated with the paired
 * device's bearer token. Separate from the session socket because:
 *   - the bearer comes from a different cookie (`psp_device`)
 *   - a single tab is either web (session) or mobile (device), never both
 *
 * Lazy — SSR doesn't try to open a WebSocket. Token fetched from
 * `/api/device/token` so it stays in an httpOnly cookie.
 */
let socket: Socket | null = null;

export async function getDeviceSocket(): Promise<Socket | null> {
  if (typeof window === "undefined") return null;
  if (socket) return socket;

  const res = await fetch("/api/device/token", { cache: "no-store" });
  if (!res.ok) return null;
  const { token } = (await res.json()) as { token: string };
  if (!token) return null;

  socket = new Socket(resolveSocketUrl(), { params: { device_token: token } });
  socket.connect();
  return socket;
}

export function disconnectDeviceSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
