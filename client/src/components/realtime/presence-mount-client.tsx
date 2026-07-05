"use client";

import { useLobbyPresence } from "@/lib/realtime/use-lobby-presence";
import { useConnectionWatcher } from "@/lib/realtime/use-connection-watcher";

/**
 * Client sidecar mounted by `PresenceMount` (server). Runs the
 * realtime side-effects: joins the tenant-scoped lobby channel and
 * watches the socket-connection state pill.
 */
export function PresenceMountClient({ companyId }: { companyId: number }) {
  useLobbyPresence(companyId);
  useConnectionWatcher();
  return null;
}
