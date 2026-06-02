"use client";

import { useLobbyPresence } from "@/lib/realtime/use-lobby-presence";
import { useConnectionWatcher } from "@/lib/realtime/use-connection-watcher";

/**
 * Empty render — its only job is to mount the realtime hooks once for
 * the authed layout (presence tracker + connection state watcher).
 * Renders nothing visible.
 */
export function PresenceMount() {
  useLobbyPresence();
  useConnectionWatcher();
  return null;
}
