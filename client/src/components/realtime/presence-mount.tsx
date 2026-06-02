"use client";

import { useLobbyPresence } from "@/lib/realtime/use-lobby-presence";

/**
 * Empty render — its only job is to mount the lobby presence hook
 * once for the authed layout. Renders nothing visible.
 */
export function PresenceMount() {
  useLobbyPresence();
  return null;
}
