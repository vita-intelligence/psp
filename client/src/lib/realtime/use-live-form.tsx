"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel, Presence } from "phoenix";
import { getSocket } from "./socket";

/**
 * Reusable hook for real-time collaborative forms.
 *
 * Joins a Phoenix channel scoped to one resource. Broadcasts local
 * field changes to every other editor on the same form, applies
 * remote changes, and tracks per-field focus so the UI can show
 * "Alice is editing this field" indicators.
 *
 * Persistence is OUT of scope here — this hook is sync only. Saving
 * to the database still goes through HTTP on Save click.
 *
 * Usage:
 *
 *   const { state, setField, presence, fieldEditors, focusField, blurField } =
 *     useLiveForm<WarehouseForm>({
 *       resource: "warehouse:42",
 *       initialState: warehouse,
 *     });
 *
 *   <Input
 *     value={state.name}
 *     onChange={(e) => setField("name", e.target.value)}
 *     onFocus={() => focusField("name")}
 *     onBlur={() => blurField("name")}
 *   />
 */

export interface CollabPeer {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
  focusField: string | null;
  /** Unix epoch seconds when the peer joined the form channel. Used to
   *  derive the room "creator" — the earliest joiner across the room. */
  joinedAt: number;
}

interface UseLiveFormOptions<T> {
  /** Topic suffix — joins `form:<resource>`. */
  resource: string;
  initialState: T;
  /** Fields where remote inputs should be ignored while WE have focus. */
  protectFocusedFields?: boolean;
  /** Called when a peer broadcasts `form:committed` (i.e. the creator
   *  successfully saved/created). Use this to navigate, toast, or
   *  reset local state. Payload shape is consumer-defined — whatever
   *  the broadcaster pushed. */
  onCommit?: (payload: unknown, byUserId: string) => void;
  /** Skip the channel join entirely. Use when the caller is a viewer
   *  (no edit permission) — they get the static `initialState`, no
   *  presence, no cursors, and `joinError` stays `null` so the UI can
   *  render a clean read-only form instead of a "you can't edit here"
   *  banner. Backend channels enforce edit permission on join, so
   *  letting a viewer try would always 403 — skipping is the
   *  user-friendly path. */
  disabled?: boolean;
}

export interface JoinError {
  reason: "forbidden" | "form_full" | "bad_topic" | "unknown";
  /** Capacity cap the server is enforcing, when `reason === "form_full"`. */
  limit?: number;
}

export interface RemoteCursor {
  /** Normalized 0..1 fractions of the anchor element's width / height. */
  x: number;
  y: number;
  peer: CollabPeer;
}

interface UseLiveFormResult<T> {
  state: T;
  /** Set a single field locally + broadcast to peers. */
  setField: <K extends keyof T>(field: K, value: T[K]) => void;
  /** Replace the entire local state. Doesn't broadcast — use when
   *  resetting to a server snapshot. */
  resetState: (next: T) => void;
  presence: CollabPeer[];
  /** Per-field map of who's currently focused there. */
  fieldEditors: Record<string, CollabPeer | null>;
  focusField: (field: string) => void;
  blurField: (field: string) => void;
  /** True after we've joined the channel and received initial state. */
  connected: boolean;
  /** Populated when the channel REJECTED the join. Distinct from a
   *  transient socket dropout: `joinError` is terminal until the user
   *  retries the page. */
  joinError: JoinError | null;
  /** Earliest joiner of the form — the "room creator". `null` until
   *  presence has synced. May be self (`creator?.id === selfId`) or
   *  any peer. Used to gate finalize/save actions to one editor. */
  creator: CollabPeer | null;
  /** Convenience: `true` when WE are the room creator. */
  isCreator: boolean;
  /** Map of user id → remote cursor position. Empty until peers move
   *  their mouse over the form anchor. */
  cursors: Record<string, RemoteCursor>;
  /** Broadcast our cursor position (normalized 0..1). Internally
   *  throttled to ~20fps. */
  setCursor: (x: number, y: number) => void;
  /** Tell peers our cursor has left the form anchor. Called on mouse
   *  leave / blur and on unmount. */
  hideCursor: () => void;
  /** Broadcast a `form:committed` event to every peer. Use this AFTER
   *  the HTTP save succeeds — the local component should also handle
   *  the success path (this hook never persists). */
  broadcastCommit: (payload: unknown) => void;
}

/**
 * Maximum concurrent editors per form. **Keep in sync** with
 * `@default_room_limit` in the backend `FormChannel`. We use this for
 * UI affordances (showing "X / 10" indicators); the backend is the
 * source of truth for enforcement.
 */
export const MAX_COLLABORATORS = 10;

// Map of `${field}` → epoch ms of the last remote value we applied.
// Used so an out-of-order broadcast doesn't overwrite a newer one.
type Lamport = Record<string, number>;

// Cursor broadcast budget: 20 messages/second per editor. With 10
// editors at the cap that's 200 msg/sec on the channel — well within
// what Phoenix Channels handle. Receivers smooth the gaps with CSS
// transitions, so this gives a perceptually-fluid cursor without
// drowning the WebSocket.
const CURSOR_THROTTLE_MS = 50;

export function useLiveForm<T extends object>({
  resource,
  initialState,
  protectFocusedFields = true,
  onCommit,
  disabled = false,
}: UseLiveFormOptions<T>): UseLiveFormResult<T> {
  // Latest onCommit handler captured in a ref so the channel
  // subscription doesn't have to tear down + re-establish every time
  // the parent component re-renders with a new callback identity.
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);
  const [state, setState] = useState<T>(initialState);
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState<CollabPeer[]>([]);
  const [joinError, setJoinError] = useState<JoinError | null>(null);
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({});
  const [creator, setCreator] = useState<CollabPeer | null>(null);

  const channelRef = useRef<Channel | null>(null);
  // Throttle state for the outgoing cursor broadcasts. Leading edge
  // sends immediately, then suppresses for `CURSOR_THROTTLE_MS`, with
  // a trailing send so the final mouse position isn't dropped.
  const cursorLastSentRef = useRef<number>(0);
  const cursorPendingRef = useRef<{ x: number; y: number } | null>(null);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest presence — mirrored from state so the cursor:move handler
  // can attach peer identity without re-subscribing on every render.
  const peersRef = useRef<CollabPeer[]>([]);
  useEffect(() => {
    peersRef.current = presence;
  }, [presence]);
  const myFocusRef = useRef<string | null>(null);
  const lamportRef = useRef<Lamport>({});
  const stateRef = useRef<T>(initialState);
  const localUserIdRef = useRef<string | null>(null);

  // Keep a ref to state so closures (e.g. snapshot:request handler)
  // always see the latest values without re-creating themselves.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const setField = useCallback<UseLiveFormResult<T>["setField"]>(
    (field, value) => {
      setState((s) => ({ ...s, [field]: value }));
      const ch = channelRef.current;
      if (ch) {
        const ts = Date.now();
        lamportRef.current[String(field)] = ts;
        ch.push("field:change", {
          field: String(field),
          value,
          ts,
        });
      }
    },
    [],
  );

  const resetState = useCallback((next: T) => {
    setState(next);
    stateRef.current = next;
    lamportRef.current = {};
  }, []);

  const focusField = useCallback((field: string) => {
    myFocusRef.current = field;
    channelRef.current?.push("field:focus", { field });
  }, []);

  const blurField = useCallback((field: string) => {
    if (myFocusRef.current === field) myFocusRef.current = null;
    channelRef.current?.push("field:blur", { field });
  }, []);

  const setCursor = useCallback<UseLiveFormResult<T>["setCursor"]>(
    (x, y) => {
      const ch = channelRef.current;
      if (!ch) return;

      cursorPendingRef.current = { x, y };
      const now = Date.now();
      const elapsed = now - cursorLastSentRef.current;

      if (elapsed >= CURSOR_THROTTLE_MS) {
        // Leading edge — fire immediately so the cursor is responsive.
        ch.push("cursor:move", cursorPendingRef.current);
        cursorLastSentRef.current = now;
        cursorPendingRef.current = null;
        return;
      }

      // Trailing edge — schedule a flush for the remaining throttle
      // window so the final position lands even if the mouse stops.
      if (cursorTimerRef.current !== null) return;
      cursorTimerRef.current = setTimeout(() => {
        cursorTimerRef.current = null;
        const pending = cursorPendingRef.current;
        if (!pending) return;
        ch.push("cursor:move", pending);
        cursorLastSentRef.current = Date.now();
        cursorPendingRef.current = null;
      }, CURSOR_THROTTLE_MS - elapsed);
    },
    [],
  );

  const hideCursor = useCallback<UseLiveFormResult<T>["hideCursor"]>(() => {
    const ch = channelRef.current;
    if (!ch) return;
    // Drop any pending throttled send so we don't broadcast a stale
    // "I'm at X, Y" right after telling peers we left.
    if (cursorTimerRef.current !== null) {
      clearTimeout(cursorTimerRef.current);
      cursorTimerRef.current = null;
    }
    cursorPendingRef.current = null;
    ch.push("cursor:hide", {});
  }, []);

  const broadcastCommit = useCallback<
    UseLiveFormResult<T>["broadcastCommit"]
  >((payload) => {
    channelRef.current?.push("form:committed", { payload });
  }, []);

  useEffect(() => {
    // Viewer mode: caller doesn't have edit perms, so joining the
    // channel would 403. Skip the socket dance and let the form
    // render statically from `initialState`.
    if (disabled) return;

    let alive = true;
    let cleanup: (() => void) | null = null;

    (async () => {
      const socket = await getSocket();
      if (!socket || !alive) return;

      const channel = socket.channel(`form:${resource}`, {});
      channelRef.current = channel;

      // Use Phoenix's built-in Presence client. Hand-rolling a diff
      // merge based on user.id would drop users whenever they update
      // their meta (e.g. on field:focus), because the leave half of an
      // `update` shares the same id as the join half. Phoenix tracks
      // these by `phx_ref` internally and gives us the right answer
      // via `onSync`.
      const presence = new Presence(channel);
      presence.onSync(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stateMap: Record<string, any> =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (presence as any).state ?? {};
        const allPeers = peersFromState(stateMap as PresenceState);
        const filtered = allPeers.filter(
          (p) => p.id !== localUserIdRef.current,
        );
        setPresence(filtered);

        // Room creator = earliest joinedAt across EVERYONE in the
        // room, including self. Promotion happens automatically when
        // the previous creator leaves and a new earliest emerges.
        let nextCreator: CollabPeer | null = null;
        for (const peer of allPeers) {
          if (!nextCreator || peer.joinedAt < nextCreator.joinedAt) {
            nextCreator = peer;
          }
        }
        setCreator(nextCreator);

        // Drop cursors for peers who've left so a vanished editor's
        // cursor doesn't linger on the page forever.
        const alive = new Set(filtered.map((p) => p.id));
        setCursors((current) => {
          const next: Record<string, RemoteCursor> = {};
          for (const [id, cursor] of Object.entries(current)) {
            if (alive.has(id)) next[id] = cursor;
          }
          return next;
        });
      });

      channel.on("field:change", (payload) => {
        const { field, value, ts } = payload as {
          field: string;
          value: unknown;
          ts: number;
          by: number;
        };
        const last = lamportRef.current[field] ?? 0;
        if (ts < last) return; // out-of-order: ignore

        // Don't yank a field someone else (we) is actively typing in.
        if (protectFocusedFields && myFocusRef.current === field) return;

        lamportRef.current[field] = ts;
        setState((s) => ({ ...s, [field]: value as T[keyof T] }));
      });

      // Late-joiner snapshot: ask peers for their current state. If
      // nobody responds within 800ms we just stick with our
      // `initialState` (likely fresh from the server-component fetch).
      channel.on("snapshot:request", (payload) => {
        const { by } = payload as { by: number };
        // Respond with our current state so the joiner can sync.
        channel.push("snapshot:response", {
          state: stateRef.current,
          to: by,
        });
      });

      channel.on("snapshot:response", (payload) => {
        const { state: remoteState, to } = payload as {
          state: T;
          to: number;
        };
        const me = Number(localUserIdRef.current);
        if (Number.isFinite(me) && to !== me) return;
        // Only apply if we haven't touched anything yet — otherwise
        // local edits would be clobbered.
        if (Object.keys(lamportRef.current).length > 0) return;
        setState(remoteState);
      });

      channel.on("cursor:move", (payload) => {
        const { by, x, y } = payload as {
          by: number | string;
          x: number;
          y: number;
        };
        const id = String(by);
        if (id === localUserIdRef.current) return;
        setCursors((current) => {
          // Carry the peer identity over from presence so the cursor
          // can render a name + colour. If we don't know who they are
          // yet (presence not synced), skip — they'll show up on the
          // next move.
          const peer = peersRef.current.find((p) => p.id === id);
          if (!peer) return current;
          return { ...current, [id]: { x, y, peer } };
        });
      });

      channel.on("cursor:hide", (payload) => {
        const { by } = payload as { by: number | string };
        const id = String(by);
        setCursors((current) => {
          if (!(id in current)) return current;
          const next = { ...current };
          delete next[id];
          return next;
        });
      });

      channel.on("form:committed", (msg) => {
        const { by, payload } = msg as { by: number | string; payload: unknown };
        onCommitRef.current?.(payload, String(by));
      });

      channel
        .join()
        .receive("ok", (resp) => {
          // The join reply carries our user id (so we can filter
          // ourselves out of presence) and the room limit (informational
          // — backend enforces the cap, but UI surfaces the number).
          const meId = (resp as { user_id?: string | number })?.user_id;
          if (meId !== undefined) localUserIdRef.current = String(meId);
          setConnected(true);
          setJoinError(null);
          channel.push("snapshot:request", {});
        })
        .receive("error", (resp) => {
          // The channel rejected our join — likely permission (forbidden)
          // or capacity (form_full). Mark it terminal so the UI can
          // render a clear message instead of looking "disconnected".
          const reasonRaw =
            ((resp as { reason?: string })?.reason ?? "unknown") as
              | "forbidden"
              | "form_full"
              | "bad_topic"
              | "unknown";
          const limit = (resp as { limit?: number })?.limit;
          setConnected(false);
          setJoinError({ reason: reasonRaw, limit });
        });

      cleanup = () => {
        channel.leave();
        channelRef.current = null;
        setConnected(false);
      };
    })();

    return () => {
      alive = false;
      cleanup?.();
    };
    // We only want to (re)join when the resource itself changes or
    // when the viewer/editor flag flips; the initialState handler is
    // wired separately above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, disabled]);

  const fieldEditors = useMemo<Record<string, CollabPeer | null>>(() => {
    const map: Record<string, CollabPeer | null> = {};
    for (const peer of presence) {
      if (peer.focusField) {
        // First peer wins; concurrent focus on the same field is rare
        // and showing one indicator is enough for the UI.
        if (!map[peer.focusField]) {
          map[peer.focusField] = peer;
        }
      }
    }
    return map;
  }, [presence]);

  const isCreator = Boolean(
    creator && creator.id === localUserIdRef.current,
  );

  return {
    state,
    setField,
    resetState,
    presence,
    fieldEditors,
    focusField,
    blurField,
    connected,
    joinError,
    creator,
    isCreator,
    cursors,
    setCursor,
    hideCursor,
    broadcastCommit,
  };
}

// ---------- presence shape helpers ----------

interface PresenceState {
  [userId: string]: {
    metas: Array<{
      name: string;
      email: string;
      avatar?: string | null;
      focus_field: string | null;
      joined_at: number;
    }>;
  };
}

function peersFromState(state: PresenceState): CollabPeer[] {
  return Object.entries(state).flatMap(([id, entry]) => {
    if (!entry?.metas?.length) return [];
    const meta = entry.metas[0]!;
    return [
      {
        id,
        name: meta.name,
        email: meta.email,
        avatar: meta.avatar ?? null,
        focusField: meta.focus_field ?? null,
        joinedAt: meta.joined_at ?? Number.MAX_SAFE_INTEGER,
      },
    ];
  });
}

