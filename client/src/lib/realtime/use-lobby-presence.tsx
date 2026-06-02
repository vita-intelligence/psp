"use client";

import { useEffect } from "react";
import { Presence } from "phoenix";
import { getSocket } from "./socket";
import { usePresence } from "./presence-store";

/**
 * Joins the "lobby" channel on mount, tracks presence in the Zustand
 * store, leaves on unmount. Mount this once at the top of the authed
 * layout — `Presence` is a CRDT broadcast over the socket so every
 * subscriber on the page sees the same view.
 */
export function useLobbyPresence() {
  const reset = usePresence((s) => s.reset);
  const diff = usePresence((s) => s.diff);

  useEffect(() => {
    let alive = true;
    let cleanup: (() => void) | null = null;

    (async () => {
      const socket = await getSocket();
      if (!socket || !alive) return;

      const channel = socket.channel("lobby", {});
      const presence = new Presence(channel);

      presence.onSync(() => {
        // Phoenix.Presence.list returns array shape — we want the raw
        // dict to merge into the store keyed by user id.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stateMap: Record<string, any> = (presence as any).state ?? {};
        reset(stateMap);
      });

      channel.on("presence_state", (state) => {
        reset(state as Record<string, { metas: never[] }>);
      });

      channel.on("presence_diff", (payload) => {
        const { joins = {}, leaves = {} } = payload as {
          joins: Record<string, { metas: never[] }>;
          leaves: Record<string, { metas: never[] }>;
        };
        diff(joins, leaves);
      });

      channel.join();
      cleanup = () => {
        channel.leave();
      };
    })();

    return () => {
      alive = false;
      cleanup?.();
    };
  }, [reset, diff]);
}
