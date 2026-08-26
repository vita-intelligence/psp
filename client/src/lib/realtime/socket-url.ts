"use client";

import { env } from "../env";

// Resolve the Phoenix socket URL from the current page origin so the
// dev setup works for laptop + phone alike. The build-time
// `NEXT_PUBLIC_WS_URL` is treated as a hint that we rewrite to match
// the current page host in dev whenever the configured host is either:
//
//   * `localhost` / `127.0.0.1` — a phone on the LAN can't loop back
//     to the mac; rewrite to the phone's page host so the WS reaches
//     the dev server.
//   * a `*.local` mDNS hostname (or ANY host that doesn't match the
//     current page's hostname) — the dev cert on `:4001` is issued
//     for `localhost`, so if a laptop-user opens `https://localhost`
//     while the env points at `wss://mac.local:4001/socket`, the
//     browser refuses the TLS upgrade on hostname mismatch and the
//     socket silently dies (→ "Offline" pill). Rewriting to the
//     current page hostname keeps the cert match happy AND lets a
//     LAN phone still work because the .env is optimised for one
//     access mode and this resolver corrects for the other.
//
// In prod, `NEXT_PUBLIC_WS_URL` is a real public hostname; the
// hostname will match the page origin (both served from the same
// domain), so the rewrite is a no-op.
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
    // Rewrite whenever the configured host differs from the page
    // origin — covers loopback misuse from a phone AND `.local`
    // hostname misuse from a laptop.
    const hostMismatch = parsed.hostname !== window.location.hostname;
    if (!loopback && !hostMismatch) return configured;

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
