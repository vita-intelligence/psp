"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel } from "phoenix";
import { getSocket } from "./socket";
import type { CollabPeer } from "./use-live-form";

interface UseLivePlanOptions {
  /** The warehouse uuid to join the plan room for. Falsy = the hook
   *  no-ops (no socket, no presence) so server-rendered pages can
   *  pass a placeholder until the client has it. */
  warehouseUuid: string | null | undefined;
  /** The floor uuid currently focused on this tab. Mirrored into the
   *  presence meta so peers can see who's looking at which floor. */
  activeFloorUuid: string | null | undefined;
  /** Skip the channel join entirely — caller is a viewer with no
   *  edit permission, or the editor isn't mounted yet. */
  disabled?: boolean;
  /** Fired whenever a peer's HTTP mutation lands on the backend.
   *  Payload mirrors the channel event shape so the editor can pick
   *  its policy (silent refresh vs banner). Skipped for events
   *  originating from THIS tab — we compare against the socket's
   *  bound user id so a single user editing in two tabs still sees
   *  the events. */
  onInvalidated?: (event: InvalidationEvent) => void;
}

export interface InvalidationEvent {
  floor_uuid: string | null;
  by_user_id: number | null;
  kind:
    | "floor_saved"
    | "floor_added"
    | "floor_deleted"
    | "location_added"
    | "location_updated"
    | "location_deleted";
}

interface UseLivePlanResult {
  /** True once the channel has joined and presence sync'd. */
  connected: boolean;
  /** Everyone in the room INCLUDING self. Sorted by `joinedAt` so
   *  the avatar stack stays stable across re-renders. */
  peers: CollabPeer[];
  /** Same list without self — for "who else is here" UIs. */
  others: CollabPeer[];
}

/** Realtime presence + invalidation listener for the warehouse plan
 *  editor. The backend channel only fan-outs notification events —
 *  data still lands via the existing REST endpoints. Pair this hook
 *  with a `router.refresh()` (when not dirty) or a "someone updated
 *  this floor" banner (when dirty) to react to incoming events. */
export function useLivePlan({
  warehouseUuid,
  activeFloorUuid,
  disabled,
  onInvalidated,
}: UseLivePlanOptions): UseLivePlanResult {
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  // Mirror selfId into a ref so the channel "floor:invalidated"
  // handler — which closes over the FIRST render's selfId — can read
  // the latest value when filtering self-originating events.
  const selfIdRef = useRef<string | null>(null);
  useEffect(() => {
    selfIdRef.current = selfId;
  }, [selfId]);
  const channelRef = useRef<Channel | null>(null);
  // Stash the latest invalidation callback in a ref so we don't
  // re-subscribe to the channel every render. The Channel binding
  // is heavy; callers tend to rebuild the callback on every editor
  // re-render.
  const onInvalidatedRef = useRef(onInvalidated);
  useEffect(() => {
    onInvalidatedRef.current = onInvalidated;
  }, [onInvalidated]);

  // --- join the channel once per (warehouseUuid, enabled) pair
  useEffect(() => {
    if (disabled || !warehouseUuid) return;
    let cancelled = false;
    let channel: Channel | null = null;

    (async () => {
      const socket = await getSocket();
      if (cancelled || !socket) return;
      channel = socket.channel(`plan:warehouse:${warehouseUuid}`, {});

      channel
        .join()
        .receive("ok", (resp: { user_id?: number }) => {
          if (cancelled) return;
          if (resp?.user_id != null) setSelfId(String(resp.user_id));
          setConnected(true);
        })
        .receive("error", () => {
          if (!cancelled) setConnected(false);
        });

      channel.on("presence_state", (state) => {
        if (!cancelled) setPeers(peersFromPresence(state));
      });
      channel.on("presence_diff", (diff) => {
        if (cancelled) return;
        setPeers((prev) => applyPresenceDiff(prev, diff));
      });
      channel.on("floor:invalidated", (event: InvalidationEvent) => {
        if (cancelled) return;
        // Skip our own broadcast — the local save flow already
        // does router.refresh(); receiving the same event here would
        // just double-refresh.
        if (
          event.by_user_id != null &&
          String(event.by_user_id) === selfIdRef.current
        ) {
          return;
        }
        onInvalidatedRef.current?.(event);
      });

      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      if (channel) channel.leave();
      channelRef.current = null;
      setConnected(false);
      setPeers([]);
    };
  }, [warehouseUuid, disabled]);

  // --- broadcast active floor changes into presence meta
  useEffect(() => {
    if (!connected) return;
    const channel = channelRef.current;
    if (!channel) return;
    channel.push("floor:focus", { floor_uuid: activeFloorUuid ?? null });
  }, [activeFloorUuid, connected]);

  const others = useMemo(
    () => peers.filter((p) => p.id !== selfId),
    [peers, selfId],
  );

  return { connected, peers, others };
}

// --- presence helpers ---------------------------------------------

type PresenceState = Record<
  string,
  { metas: PresenceMeta[] }
>;

interface PresenceMeta {
  name: string;
  email: string;
  avatar?: string | null;
  active_floor_uuid: string | null;
  joined_at: number;
}

function peersFromPresence(state: unknown): CollabPeer[] {
  if (!state || typeof state !== "object") return [];
  const out: CollabPeer[] = [];
  for (const [id, entry] of Object.entries(state as PresenceState)) {
    const meta = entry.metas?.[0];
    if (!meta) continue;
    out.push({
      id,
      name: meta.name ?? "",
      email: meta.email ?? "",
      avatar: meta.avatar ?? null,
      // CollabPeer.focusField is `string | null` — we don't use it
      // for the plan hook so always null.
      focusField: null,
      joinedAt: meta.joined_at ?? 0,
    });
  }
  return out.sort((a, b) => a.joinedAt - b.joinedAt);
}

function applyPresenceDiff(
  prev: CollabPeer[],
  diff: unknown,
): CollabPeer[] {
  if (!diff || typeof diff !== "object") return prev;
  const d = diff as {
    joins?: PresenceState;
    leaves?: PresenceState;
  };

  const map = new Map(prev.map((p) => [p.id, p]));
  for (const id of Object.keys(d.leaves ?? {})) map.delete(id);
  for (const [id, entry] of Object.entries(d.joins ?? {})) {
    const meta = entry.metas?.[0];
    if (!meta) continue;
    map.set(id, {
      id,
      name: meta.name ?? "",
      email: meta.email ?? "",
      avatar: meta.avatar ?? null,
      focusField: null,
      joinedAt: meta.joined_at ?? 0,
    });
  }
  return Array.from(map.values()).sort((a, b) => a.joinedAt - b.joinedAt);
}
