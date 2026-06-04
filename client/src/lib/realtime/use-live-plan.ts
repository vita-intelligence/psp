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
  /** Fired when a peer publishes a mid-edit canvas snapshot for the
   *  same floor this tab is viewing. Receivers replace their local
   *  canvas (outline + walls + holes) with the broadcast version —
   *  callers should ignore the event while a local drag is in
   *  progress to avoid yanking the canvas out from under them. */
  onCanvasPatch?: (event: CanvasPatchEvent) => void;
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

export interface CanvasPatchEvent {
  by: number;
  floor_uuid: string;
  /** Full canvas_json shape — outline + walls + viewport are
   *  intentionally typed loose here so the hook stays a transport
   *  and the editor decides what to do with the blob. */
  canvas: Record<string, unknown>;
  ts: number;
}

/** A peer's mouse cursor on the canvas. World centimetres so any
 *  zoom / pan reproduces correctly. */
export interface RemotePlanCursor {
  peer: CollabPeer;
  floorUuid: string;
  x: number;
  y: number;
}

interface UseLivePlanResult {
  /** True once the channel has joined and presence sync'd. */
  connected: boolean;
  /** Everyone in the room INCLUDING self. Sorted by `joinedAt` so
   *  the avatar stack stays stable across re-renders. */
  peers: CollabPeer[];
  /** Same list without self — for "who else is here" UIs. */
  others: CollabPeer[];
  /** Map of user id → remote cursor position. */
  cursors: Record<string, RemotePlanCursor>;
  /** Broadcast our cursor position in world centimetres. Internally
   *  throttled to ~20fps (50 ms). Pass `null` to hide. */
  setCursor: (x: number, y: number, floorUuid: string) => void;
  /** Tell peers our cursor has left the canvas (e.g. on mouse leave
   *  / blur). Cheap idempotent — safe to call repeatedly. */
  hideCursor: () => void;
  /** Broadcast a mid-edit canvas snapshot. Internally debounced
   *  ~250 ms so a typing-fast operator doesn't flood the channel. */
  broadcastCanvas: (
    floorUuid: string,
    canvas: Record<string, unknown>,
  ) => void;
}

/** Realtime presence + invalidation listener for the warehouse plan
 *  editor. The backend channel only fan-outs notification events —
 *  data still lands via the existing REST endpoints. Pair this hook
 *  with a `router.refresh()` (when not dirty) or a "someone updated
 *  this floor" banner (when dirty) to react to incoming events. */
// Cursor broadcast budget: 20 messages/second per editor. CSS-side
// transitions on the receiver smooth the gaps so the cursor feels
// fluid without flooding the channel.
const CURSOR_THROTTLE_MS = 50;
// Canvas patch debounce: editors that touch state on every drag
// frame would otherwise spam the channel. 250 ms strikes a balance —
// peers see edits land within a quarter-second of the local user
// letting go, and a fast typist still gets aggregated updates.
const CANVAS_DEBOUNCE_MS = 250;

export function useLivePlan({
  warehouseUuid,
  activeFloorUuid,
  disabled,
  onInvalidated,
  onCanvasPatch,
}: UseLivePlanOptions): UseLivePlanResult {
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [cursors, setCursors] = useState<Record<string, RemotePlanCursor>>({});
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
  const onCanvasPatchRef = useRef(onCanvasPatch);
  useEffect(() => {
    onCanvasPatchRef.current = onCanvasPatch;
  }, [onCanvasPatch]);
  // Active floor mirror so the cursor handler can label incoming
  // cursors with "wrong floor" — we drop them rather than render a
  // ghost on the wrong plan.
  const activeFloorRef = useRef<string | null>(null);
  useEffect(() => {
    activeFloorRef.current = activeFloorUuid ?? null;
  }, [activeFloorUuid]);
  // Snapshot the latest peers map so the cursor handler can
  // attach a CollabPeer to incoming cursor events without re-binding
  // the channel.
  const peersRef = useRef<CollabPeer[]>([]);
  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

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

      channel.on(
        "cursor:move",
        (event: {
          by: number;
          floor_uuid: string;
          x: number;
          y: number;
        }) => {
          if (cancelled) return;
          // Drop our own broadcasts so we don't render a "you are
          // here" ghost on top of the real cursor.
          if (String(event.by) === selfIdRef.current) return;
          // Drop cursors from peers viewing a different floor —
          // shouldn't happen often (the sender includes their floor
          // uuid) but defensive.
          if (event.floor_uuid !== activeFloorRef.current) return;
          const peer = peersRef.current.find(
            (p) => p.id === String(event.by),
          );
          if (!peer) return;
          setCursors((prev) => ({
            ...prev,
            [String(event.by)]: {
              peer,
              floorUuid: event.floor_uuid,
              x: event.x,
              y: event.y,
            },
          }));
        },
      );

      channel.on("cursor:hide", (event: { by: number }) => {
        if (cancelled) return;
        const key = String(event.by);
        setCursors((prev) => {
          if (!prev[key]) return prev;
          // Object.fromEntries skips the entry being dropped — fast
          // and avoids reaching for a separate mutate-then-spread.
          return Object.fromEntries(
            Object.entries(prev).filter(([k]) => k !== key),
          );
        });
      });

      channel.on("canvas:patch", (event: CanvasPatchEvent) => {
        if (cancelled) return;
        if (String(event.by) === selfIdRef.current) return;
        onCanvasPatchRef.current?.(event);
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

  // --- cursor broadcast (throttled)
  const lastCursorSentAt = useRef(0);
  const setCursor = useCallback(
    (x: number, y: number, floorUuid: string) => {
      const channel = channelRef.current;
      if (!channel || !connected) return;
      const now = performance.now();
      if (now - lastCursorSentAt.current < CURSOR_THROTTLE_MS) return;
      lastCursorSentAt.current = now;
      channel.push("cursor:move", { floor_uuid: floorUuid, x, y });
    },
    [connected],
  );

  const hideCursor = useCallback(() => {
    const channel = channelRef.current;
    if (!channel || !connected) return;
    channel.push("cursor:hide", {});
  }, [connected]);

  // --- canvas broadcast (debounced)
  const canvasTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCanvas = useRef<{
    floorUuid: string;
    canvas: Record<string, unknown>;
  } | null>(null);

  const flushCanvas = useCallback(() => {
    canvasTimer.current = null;
    const pending = pendingCanvas.current;
    pendingCanvas.current = null;
    const channel = channelRef.current;
    if (!pending || !channel || !connected) return;
    channel.push("canvas:patch", {
      floor_uuid: pending.floorUuid,
      canvas: pending.canvas,
    });
  }, [connected]);

  const broadcastCanvas = useCallback(
    (floorUuid: string, canvas: Record<string, unknown>) => {
      pendingCanvas.current = { floorUuid, canvas };
      if (canvasTimer.current) clearTimeout(canvasTimer.current);
      canvasTimer.current = setTimeout(flushCanvas, CANVAS_DEBOUNCE_MS);
    },
    [flushCanvas],
  );

  // Cleanup the debounce timer on unmount so a pending flush after
  // teardown doesn't push to a stale channel.
  useEffect(() => {
    return () => {
      if (canvasTimer.current) clearTimeout(canvasTimer.current);
    };
  }, []);

  // Drop cursors for peers that left the room — otherwise their
  // ghost would linger until a new presence_state arrived.
  useEffect(() => {
    setCursors((prev) => {
      const knownIds = new Set(peers.map((p) => p.id));
      const filtered = Object.entries(prev).filter(([k]) => knownIds.has(k));
      if (filtered.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(filtered);
    });
  }, [peers]);

  // Drop cursors when we switch to a different floor — they belong
  // to the previous canvas and would otherwise sit on the wrong one.
  useEffect(() => {
    setCursors({});
  }, [activeFloorUuid]);

  return {
    connected,
    peers,
    others,
    cursors,
    setCursor,
    hideCursor,
    broadcastCanvas,
  };
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
