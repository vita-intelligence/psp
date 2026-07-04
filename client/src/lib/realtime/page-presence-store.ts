"use client";

// Zustand-backed store so multiple consumers on the same page (TopBar
// avatars + action-bar lock guard + cursor overlay) share one Phoenix
// channel per pageId instead of each opening their own.
//
// Ref-counted subscribe(): the first subscriber opens the channel,
// subsequent subscribers just read the same state, the last
// unsubscriber closes it.

import { create } from "zustand";
import { Channel, Presence } from "phoenix";
import { getSocket } from "./socket";
import type {
  CollabPeer,
  PagePresenceJoinError,
  RemoteCursor,
} from "./use-page-presence";

interface Room {
  channel: Channel | null;
  refCount: number;
  peers: CollabPeer[];
  cursorsByPeer: Record<string, { x: number; y: number }>;
  connected: boolean;
  joinError: PagePresenceJoinError | null;
  myUserId: string | null;
}

interface StoreState {
  rooms: Record<string, Room>;
  ensureRoom: (pageId: string) => void;
  releaseRoom: (pageId: string) => void;
  pushCursor: (pageId: string, x: number, y: number) => void;
  hideCursor: (pageId: string) => void;
}

const CURSOR_THROTTLE_MS = 33;
const lastEmit: Record<string, number> = {};
const pendingEmit: Record<string, { x: number; y: number }> = {};
const throttleTimers: Record<string, number> = {};

export const usePagePresenceStore = create<StoreState>((set, get) => ({
  rooms: {},

  ensureRoom: (pageId) => {
    const existing = get().rooms[pageId];
    if (existing) {
      set((s) => ({
        rooms: {
          ...s.rooms,
          [pageId]: { ...existing, refCount: existing.refCount + 1 },
        },
      }));
      return;
    }

    // Seed placeholder so subsequent ensureRoom calls hit the fast path.
    set((s) => ({
      rooms: {
        ...s.rooms,
        [pageId]: {
          channel: null,
          refCount: 1,
          peers: [],
          cursorsByPeer: {},
          connected: false,
          joinError: null,
          myUserId: null,
        },
      },
    }));

    (async () => {
      const socket = await getSocket();
      if (!socket) return;

      // Room might have been released while we awaited the socket.
      const current = get().rooms[pageId];
      if (!current) return;

      const topic = `page:${encodeURIComponent(pageId)}`;
      const channel = socket.channel(topic, {});
      const presence = new Presence(channel);

      const rebuildPeers = () => {
        const list: CollabPeer[] = [];
        presence.list((id, { metas }) => {
          const meta = metas[0] ?? {};
          list.push({
            id,
            name: (meta.name as string) ?? "",
            email: (meta.email as string) ?? "",
            avatar: (meta.avatar as string) ?? null,
            joinedAt:
              (meta.joined_at as number) ?? Number.MAX_SAFE_INTEGER,
          });
          return list;
        });
        set((s) => {
          const r = s.rooms[pageId];
          if (!r) return s;
          return {
            rooms: { ...s.rooms, [pageId]: { ...r, peers: list } },
          };
        });
      };

      presence.onSync(rebuildPeers);

      channel.on(
        "cursor:move",
        (msg: { from: number; x: number; y: number }) => {
          set((s) => {
            const r = s.rooms[pageId];
            if (!r) return s;
            return {
              rooms: {
                ...s.rooms,
                [pageId]: {
                  ...r,
                  cursorsByPeer: {
                    ...r.cursorsByPeer,
                    [String(msg.from)]: { x: msg.x, y: msg.y },
                  },
                },
              },
            };
          });
        },
      );

      channel.on("cursor:hide", (msg: { from: number }) => {
        set((s) => {
          const r = s.rooms[pageId];
          if (!r) return s;
          if (!(String(msg.from) in r.cursorsByPeer)) return s;
          const next = { ...r.cursorsByPeer };
          delete next[String(msg.from)];
          return {
            rooms: {
              ...s.rooms,
              [pageId]: { ...r, cursorsByPeer: next },
            },
          };
        });
      });

      channel
        .join()
        .receive("ok", (resp: { user_id?: number }) => {
          set((s) => {
            const r = s.rooms[pageId];
            if (!r) return s;
            return {
              rooms: {
                ...s.rooms,
                [pageId]: {
                  ...r,
                  channel,
                  connected: true,
                  myUserId: resp?.user_id != null ? String(resp.user_id) : null,
                  joinError: null,
                },
              },
            };
          });
        })
        .receive("error", (resp: { reason?: string; limit?: number }) => {
          const reason = resp?.reason;
          const err: PagePresenceJoinError =
            reason === "room_full" || reason === "bad_topic"
              ? { reason, limit: resp?.limit }
              : { reason: "unknown" };
          set((s) => {
            const r = s.rooms[pageId];
            if (!r) return s;
            return {
              rooms: {
                ...s.rooms,
                [pageId]: { ...r, channel, joinError: err },
              },
            };
          });
        });
    })();
  },

  releaseRoom: (pageId) => {
    const room = get().rooms[pageId];
    if (!room) return;
    if (room.refCount > 1) {
      set((s) => ({
        rooms: {
          ...s.rooms,
          [pageId]: { ...room, refCount: room.refCount - 1 },
        },
      }));
      return;
    }
    // Last subscriber — tear down.
    room.channel?.leave();
    if (throttleTimers[pageId] !== undefined) {
      window.clearTimeout(throttleTimers[pageId]);
      delete throttleTimers[pageId];
    }
    delete lastEmit[pageId];
    delete pendingEmit[pageId];
    set((s) => {
      const next = { ...s.rooms };
      delete next[pageId];
      return { rooms: next };
    });
  },

  pushCursor: (pageId, x, y) => {
    const room = get().rooms[pageId];
    if (!room?.channel) return;
    const now = Date.now();
    const elapsed = now - (lastEmit[pageId] ?? 0);
    if (elapsed >= CURSOR_THROTTLE_MS) {
      lastEmit[pageId] = now;
      room.channel.push("cursor:move", { x, y });
      return;
    }
    pendingEmit[pageId] = { x, y };
    if (throttleTimers[pageId] !== undefined) return;
    throttleTimers[pageId] = window.setTimeout(() => {
      delete throttleTimers[pageId];
      const pending = pendingEmit[pageId];
      delete pendingEmit[pageId];
      const r = get().rooms[pageId];
      if (pending && r?.channel) {
        lastEmit[pageId] = Date.now();
        r.channel.push("cursor:move", pending);
      }
    }, CURSOR_THROTTLE_MS - elapsed);
  },

  hideCursor: (pageId) => {
    const room = get().rooms[pageId];
    if (!room?.channel) return;
    room.channel.push("cursor:hide", {});
    delete pendingEmit[pageId];
    if (throttleTimers[pageId] !== undefined) {
      window.clearTimeout(throttleTimers[pageId]);
      delete throttleTimers[pageId];
    }
  },
}));

/** Selector helpers ------------------------------------------------ */

export function selectLeader(peers: CollabPeer[]): CollabPeer | null {
  if (peers.length === 0) return null;
  return [...peers].sort((a, b) => {
    if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
    return Number(a.id) - Number(b.id);
  })[0];
}

export function selectCursors(
  peers: CollabPeer[],
  cursorsByPeer: Record<string, { x: number; y: number }>,
  myUserId: string | null,
): RemoteCursor[] {
  if (!myUserId) return [];
  return Object.entries(cursorsByPeer)
    .filter(([id]) => id !== myUserId)
    .map(([id, pos]) => {
      const peer = peers.find((p) => p.id === id);
      return peer ? { peer, x: pos.x, y: pos.y } : null;
    })
    .filter((c): c is RemoteCursor => c !== null);
}
