"use client";

import { Socket } from "phoenix";
import { env } from "../env";

/**
 * Single Phoenix socket per browser tab. Lazy-instantiated so SSR
 * doesn't try to open a WebSocket. Token comes from
 * `/api/session/token` (route handler that reads the httpOnly cookie
 * and returns the bearer token to the client) — we don't store the
 * token in localStorage / cookies the browser JS can read.
 */
let socket: Socket | null = null;

/**
 * Resolve the Phoenix socket URL from the current page origin so the
 * dev setup just works for laptop + phone alike. The build-time
 * `NEXT_PUBLIC_WS_URL` is treated as a hint: if it points at the local
 * loopback (`localhost` / `127.0.0.1`) we override with the page host
 * because a phone hitting the dev mac over the LAN would otherwise
 * try to connect back to itself. In prod the env URL is a real
 * hostname and gets passed through unchanged.
 */
function resolveSocketUrl(): string {
  const configured = env.wsUrl;
  if (typeof window === "undefined") return configured;

  try {
    const parsed = new URL(configured);
    const loopback =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (!loopback) return configured;

    // BE HTTPS listener lives on :4001 in dev. Mirror the same upgrade
    // protocol the page was loaded over (wss when https, ws when http)
    // so the browser doesn't refuse a mixed-content downgrade.
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.hostname}:${parsed.port || "4001"}${
      parsed.pathname || "/socket"
    }`;
  } catch {
    return configured;
  }
}

export async function getSocket(): Promise<Socket | null> {
  if (typeof window === "undefined") return null;
  if (socket) return socket;

  const res = await fetch("/api/session/token", { cache: "no-store" });
  if (!res.ok) return null;
  const { token } = (await res.json()) as { token: string };
  if (!token) return null;

  socket = new Socket(resolveSocketUrl(), { params: { token } });
  socket.connect();
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
