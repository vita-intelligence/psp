"use client";

import { Socket } from "phoenix";
import { resolveSocketUrl } from "./socket-url";

/**
 * Single Phoenix socket per browser tab. Lazy-instantiated so SSR
 * doesn't try to open a WebSocket. Token comes from
 * `/api/session/token` (route handler that reads the httpOnly cookie
 * and returns the bearer token to the client) — we don't store the
 * token in localStorage / cookies the browser JS can read.
 */
let socket: Socket | null = null;

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
