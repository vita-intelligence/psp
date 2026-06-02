"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { getSocket } from "./socket";
import {
  useConnectionState,
  deriveStatus,
  type ConnectionStatus,
} from "./connection-store";

/**
 * Subscribes to:
 *   1. `online` / `offline` browser events
 *   2. The Phoenix Socket lifecycle callbacks
 *
 * …and pushes both into the Zustand connection store. Fires Sonner
 * toasts on the *transition*, not on every render — debounced via the
 * `useEffect` dep on the derived status.
 *
 * Mount once at the top of the authed layout.
 */
export function useConnectionWatcher() {
  const setNavigatorOnline = useConnectionState((s) => s.setNavigatorOnline);
  const setSocketOpen = useConnectionState((s) => s.setSocketOpen);

  // 1. navigator.onLine — sync once on mount AND listen for events.
  // The store seeds `navigatorOnline: true` to keep SSR/CSR consistent
  // (Node 21+ has a `navigator` global whose `onLine` is misleading).
  // We reconcile to reality here, after hydration.
  useEffect(() => {
    setNavigatorOnline(navigator.onLine);

    function handleOnline() {
      setNavigatorOnline(true);
    }
    function handleOffline() {
      setNavigatorOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [setNavigatorOnline]);

  // 2. Phoenix Socket lifecycle. The Phoenix JS client exposes
  // `onOpen / onClose / onError` which return reference ids we can use
  // to detach on unmount.
  useEffect(() => {
    let alive = true;
    let cleanup: (() => void) | null = null;

    (async () => {
      const socket = await getSocket();
      if (!socket || !alive) return;

      const openRef = socket.onOpen(() => setSocketOpen(true));
      const closeRef = socket.onClose(() => setSocketOpen(false));
      const errorRef = socket.onError(() => setSocketOpen(false));

      // The socket may already be open before our hook mounts — sync
      // the initial state explicitly.
      setSocketOpen(socket.isConnected());

      cleanup = () => {
        socket.off([openRef, closeRef, errorRef]);
      };
    })();

    return () => {
      alive = false;
      cleanup?.();
    };
  }, [setSocketOpen]);

  // 3. Toast on transitions (after the very first paint, to avoid a
  // spurious "online" toast on every page load).
  const status = useConnectionState((s) =>
    deriveStatus(s.navigatorOnline, s.socketOpen, s.hasEverConnected),
  );

  useEffect(() => {
    notifyTransition(status);
  }, [status]);
}

let lastNotified: ConnectionStatus | null = null;

function notifyTransition(status: ConnectionStatus) {
  if (lastNotified === null) {
    lastNotified = status;
    return;
  }
  if (lastNotified === status) return;
  lastNotified = status;

  if (status === "offline") {
    toast.error("You're offline", {
      description: "Live updates are paused until you're back online.",
      id: "connection-status",
    });
  } else if (status === "reconnecting") {
    toast.warning("Reconnecting…", {
      description: "Live updates may be briefly delayed.",
      id: "connection-status",
    });
  } else if (status === "online") {
    toast.success("Back online", {
      description: "Live updates resumed.",
      id: "connection-status",
    });
  }
}
