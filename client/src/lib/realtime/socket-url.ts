"use client";

import { env } from "../env";

// Resolve the Phoenix socket URL from the current page origin so the
// dev setup works for laptop + phone alike. The build-time
// `NEXT_PUBLIC_WS_URL` is treated as a hint: if it points at the local
// loopback (`localhost` / `127.0.0.1`) we override with the page host
// because a phone hitting the dev mac over the LAN would otherwise
// try to connect back to itself. In prod the env URL is a real
// hostname and gets passed through unchanged.
//
// Shared by both `socket.ts` (web session) and `device-socket.ts`
// (paired device) so the LAN rewrite stays in one place.
export function resolveSocketUrl(): string {
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
