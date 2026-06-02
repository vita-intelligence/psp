"use client";

import { create } from "zustand";

/**
 * Combined "is the realtime layer healthy" state. Two inputs feed it:
 *
 *   1. `navigator.onLine` — the OS' view of whether we have *any*
 *      network. False ⇒ we know we're offline.
 *   2. Phoenix Socket's lifecycle callbacks — `onOpen` / `onClose` /
 *      `onError`. Set indirectly when the socket transitions.
 *
 * The composed `status` is what the UI binds to:
 *
 *   - "online"        — happy path
 *   - "reconnecting"  — was online, now thrashing
 *   - "offline"       — no network or socket has been down for long
 */
export type ConnectionStatus = "online" | "reconnecting" | "offline";

interface ConnectionState {
  navigatorOnline: boolean;
  socketOpen: boolean;
  /** True the very first time the socket opens — pre-open we say
   *  "online" instead of "reconnecting" to avoid a confusing flash. */
  hasEverConnected: boolean;
  setNavigatorOnline: (v: boolean) => void;
  setSocketOpen: (v: boolean) => void;
}

// Initial state must be SSR-stable: Node 21+ defines a global
// `navigator` whose `onLine` is `false`, while the same property in a
// real browser is almost always `true`. Reading it at init would tear
// the hydration tree. Default to "online" and let the watcher hook
// reconcile on mount.
export const useConnectionState = create<ConnectionState>((set) => ({
  navigatorOnline: true,
  socketOpen: false,
  hasEverConnected: false,
  setNavigatorOnline(v) {
    set({ navigatorOnline: v });
  },
  setSocketOpen(v) {
    set((s) => ({
      socketOpen: v,
      hasEverConnected: s.hasEverConnected || v,
    }));
  },
}));

export function deriveStatus(
  navigatorOnline: boolean,
  socketOpen: boolean,
  hasEverConnected: boolean,
): ConnectionStatus {
  if (!navigatorOnline) return "offline";
  if (socketOpen) return "online";
  if (!hasEverConnected) return "online"; // initial mount — don't flash amber
  return "reconnecting";
}
