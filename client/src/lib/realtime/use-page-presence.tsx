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
  /** Reported viewport dimensions in CSS pixels — used by the
   *  avatar-tooltip chip to warn about screen-size mismatches. */
  viewportW?: number | null;
  viewportH?: number | null;
}

export interface RemoteCursor {
  x: number;
  y: number;
  peer: CollabPeer;
}

/** A "point at this element" burst — one peer clicked Alt+element and
 *  the receiver should pulse the DOM node whose `data-collab-id`
 *  matches. Reflow-safe: works even when the element is at a
 *  different pixel location on the receiver's screen. */
export interface PointBurst {
  peerId: string;
  collabId: string;
  /** Unix ms when the burst arrived — used as a stable id + expiry. */
  at: number;
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
  /** Inbound "point at this element" bursts. Consumers pulse the
   *  matching DOM node then call `clearPointBurst(at)` to acknowledge. */
  pointBursts: PointBurst[];
  clearPointBurst: (at: number) => void;
  /** Send a "point at this element" burst to peers. */
  point: (collabId: string) => void;
  connected: boolean;
  joinError: PagePresenceJoinError | null;
}

export function usePagePresence({ pageId, disabled = false }: Options): Result {
  const ensureRoom = usePagePresenceStore((s) => s.ensureRoom);
  const releaseRoom = usePagePresenceStore((s) => s.releaseRoom);
  const pushCursor = usePagePresenceStore((s) => s.pushCursor);
  const hidePeerCursor = usePagePresenceStore((s) => s.hideCursor);
  const pushPoint = usePagePresenceStore((s) => s.pushPoint);
  const clearBurst = usePagePresenceStore((s) => s.clearPointBurst);

  useEffect(() => {
    if (disabled || !pageId) return;
    ensureRoom(pageId);
    return () => releaseRoom(pageId);
  }, [pageId, disabled, ensureRoom, releaseRoom]);

  const room = usePagePresenceStore((s) => (pageId ? s.rooms[pageId] : undefined));

  const allPeers = room?.peers ?? [];
  const cursorsByPeer = room?.cursorsByPeer ?? {};
  const pointBursts = room?.pointBursts ?? [];
  const myUserId = room?.myUserId ?? null;

  // Leader is picked across EVERYONE in the room (including self) so a
  // solo occupant is correctly recognised as the leader; the caller
  // uses `isLeader` to know their own role. The `peers` array we hand
  // out to UI consumers strips self, so the top-bar avatar stack
  // doesn't render your own face as if you were another user.
  const leader = selectLeader(allPeers);
  const isLeader = leader !== null && leader.id === myUserId;
  const peers = myUserId
    ? allPeers.filter((p) => p.id !== myUserId)
    : allPeers;
  const cursors = selectCursors(allPeers, cursorsByPeer, myUserId);

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

  const point = useCallback(
    (collabId: string) => {
      if (!pageId) return;
      pushPoint(pageId, collabId);
    },
    [pageId, pushPoint],
  );

  const clearPointBurst = useCallback(
    (at: number) => {
      if (!pageId) return;
      clearBurst(pageId, at);
    },
    [pageId, clearBurst],
  );

  return {
    peers,
    isLeader,
    leader,
    cursors,
    setCursor,
    hideCursor,
    pointBursts,
    clearPointBurst,
    point,
    connected: room?.connected ?? false,
    joinError: room?.joinError ?? null,
  };
}
