"use client";

import { useEffect } from "react";
import { Channel, Presence } from "phoenix";
import { getSocket } from "./socket";
import { usePresence } from "./presence-store";

// Singleton handle to the lobby channel. Other hooks (notably the
// form-presence beacon) need to push meta updates without re-joining;
// holding the channel ref at module scope is simpler than passing it
// through React context for a single-instance side effect.
let lobbyChannel: Channel | null = null;
let pendingMeta: { current_form: string | null } | null = null;

/**
 * Joins the "lobby" channel on mount, tracks presence in the Zustand
 * store, leaves on unmount. Mount this once at the top of the authed
 * layout — `Presence` is a CRDT broadcast over the socket so every
 * subscriber on the page sees the same view.
 *
 * State syncs through Phoenix's built-in `Presence` JS class. We
 * deliberately do NOT write custom presence_state / presence_diff
 * handlers: the diff format uses `phx_ref` to match the leave side of
 * an `update` to the join side, and hand-rolled merges based on
 * `online_at` or `name` will drop users whenever their meta changes
 * (because those fields don't change on update, so the leave matches
 * both the old and new meta and the user disappears).
 */
export function useLobbyPresence(companyId: number) {
  const reset = usePresence((s) => s.reset);

  useEffect(() => {
    let alive = true;
    let cleanup: (() => void) | null = null;

    (async () => {
      const socket = await getSocket();
      if (!socket || !alive) return;

      // Per-tenant topic — every subscriber to `lobby:<company_id>`
      // is in the same company, so the Presence CRDT is naturally
      // scoped and we don't pay the O(N·n) per-diff filter cost that
      // the shared-topic version needed.
      const channel = socket.channel(`lobby:${companyId}`, {});
      const presence = new Presence(channel);

      presence.onSync(() => {
        // After Phoenix has folded any presence_state / presence_diff
        // into its internal state, dump that state into our Zustand
        // store so consumers re-render with the canonical view.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stateMap: Record<string, any> = (presence as any).state ?? {};
        reset(stateMap);
      });

      channel.join().receive("ok", () => {
        lobbyChannel = channel;
        // Flush any beacon update that fired before we'd joined.
        if (pendingMeta) {
          channel.push("meta:update", pendingMeta);
          pendingMeta = null;
        }
      });

      cleanup = () => {
        channel.leave();
        if (lobbyChannel === channel) lobbyChannel = null;
      };
    })();

    return () => {
      alive = false;
      cleanup?.();
    };
  }, [reset, companyId]);
}

/**
 * Push a meta update onto the lobby channel. Safe to call before the
 * channel finishes joining — the meta will be buffered and flushed
 * once the join completes.
 */
export function pushLobbyMeta(meta: { current_form: string | null }) {
  if (lobbyChannel) {
    lobbyChannel.push("meta:update", meta);
  } else {
    pendingMeta = meta;
  }
}
