"use client";

// Universal page-scoped presence + head-of-room leadership + optional
// cursor sync. One shared Phoenix channel per pageId across all
// consumers (TopBar avatars + detail-page lock guard + cursor overlay
// all subscribe to the same room via the store).
//
// Every page that opts in gets:
//
//   - `peers`      the CollabPeer[] currently in this page room
//   - `isLeader`   true when the local user has the earliest joined_at
//   - `leader`     the CollabPeer whose earliest joined_at wins
//   - `cursors`    RemoteCursor[] the caller can render as overlays
//   - `setCursor`  publish local cursor to peers (normalised 0..1)
//   - `hideCursor` tell peers we've moved off-page
//   - `connected`  true after channel join has succeeded
//   - `joinError`  null | { reason: ... }
//
// The pageId is typically the URL path — but any stable string works.
// `<TopBar>` derives it from usePathname() so every route becomes a
// room without per-page opt-in.

import { useCallback, useEffect } from "react";
import {
  selectCursors,
  selectLeader,
  usePagePresenceStore,
} from "./page-presence-store";

export interface CollabPeer {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
  /** Unix epoch seconds. Lowest wins leadership. */
  joinedAt: number;
}

export interface RemoteCursor {
  x: number;
  y: number;
  peer: CollabPeer;
}

export interface PagePresenceJoinError {
  reason: "room_full" | "bad_topic" | "unknown";
  limit?: number;
}

interface Options {
  /** Stable identifier for the room. Recommended: the URL pathname of
   *  the current route (e.g. "/sales/orders/abc-uuid"). */
  pageId: string;
  /** Skip channel join entirely — used on the login screen and any
   *  page rendered pre-auth. */
  disabled?: boolean;
}

interface Result {
  peers: CollabPeer[];
  isLeader: boolean;
  leader: CollabPeer | null;
  cursors: RemoteCursor[];
  setCursor: (x: number, y: number) => void;
  hideCursor: () => void;
  connected: boolean;
  joinError: PagePresenceJoinError | null;
}

export function usePagePresence({ pageId, disabled = false }: Options): Result {
  const ensureRoom = usePagePresenceStore((s) => s.ensureRoom);
  const releaseRoom = usePagePresenceStore((s) => s.releaseRoom);
  const pushCursor = usePagePresenceStore((s) => s.pushCursor);
  const hidePeerCursor = usePagePresenceStore((s) => s.hideCursor);

  useEffect(() => {
    if (disabled || !pageId) return;
    ensureRoom(pageId);
    return () => releaseRoom(pageId);
  }, [pageId, disabled, ensureRoom, releaseRoom]);

  const room = usePagePresenceStore((s) => (pageId ? s.rooms[pageId] : undefined));

  const peers = room?.peers ?? [];
  const cursorsByPeer = room?.cursorsByPeer ?? {};
  const myUserId = room?.myUserId ?? null;

  const leader = selectLeader(peers);
  const isLeader = leader !== null && leader.id === myUserId;
  const cursors = selectCursors(peers, cursorsByPeer, myUserId);

  const setCursor = useCallback(
    (x: number, y: number) => {
      if (!pageId) return;
      pushCursor(pageId, x, y);
    },
    [pageId, pushCursor],
  );

  const hideCursor = useCallback(() => {
    if (!pageId) return;
    hidePeerCursor(pageId);
  }, [pageId, hidePeerCursor]);

  return {
    peers,
    isLeader,
    leader,
    cursors,
    setCursor,
    hideCursor,
    connected: room?.connected ?? false,
    joinError: room?.joinError ?? null,
  };
}
