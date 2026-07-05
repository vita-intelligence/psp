"use client";

import { useEffect, useRef, useState } from "react";
import type { Channel } from "phoenix";
import { getSocket } from "../realtime/socket";
import type { Comment, CommentEntityType, CommentFile } from "./types";

export type JoinError =
  | { reason: "forbidden" }
  | { reason: "not_found" }
  | { reason: "bad_topic" }
  | { reason: "unknown"; raw?: unknown };

/** Payload the backend broadcasts on `file:attached`. Partial — carries
 *  just the newly-attached file + its parent comment uuid so the client
 *  can append without re-serializing the whole comment. */
export interface FileAttachedEvent {
  comment_uuid: string;
  file: CommentFile;
}

/** Payload the backend broadcasts on `file:removed`. */
export interface FileRemovedEvent {
  comment_uuid: string;
  file_uuid: string;
}

/** Payload for `reaction:added` and `reaction:removed`. */
export interface ReactionEvent {
  comment_uuid: string;
  emoji: string;
  /** Whether the CURRENT viewer's own reaction moved with this event.
   *  Backend fans this out per-subscriber so the caller only bumps
   *  their `own_reacted` flag when it's actually theirs. */
  own_reacted: boolean;
}

interface Options {
  entityType: CommentEntityType;
  entityUuid: string;
  /** Apply a `comment:created` payload to local state. */
  onCreate: (c: Comment) => void;
  /** Apply a `comment:updated` payload to local state. */
  onUpdate: (c: Comment) => void;
  /** Apply a `comment:deleted` payload to local state (soft-delete —
   *  the row stays, body becomes `[deleted]`). */
  onDelete: (c: Comment) => void;
  /** Backend broadcasts a partial payload — comment_uuid + the freshly-
   *  serialized file. Caller finds the parent comment locally and
   *  appends. */
  onFileAttached: (evt: FileAttachedEvent) => void;
  /** File removal is a partial event — backend sends the comment_uuid
   *  + file_uuid rather than the whole comment because the delete case
   *  is common enough that re-serializing the parent is wasteful. */
  onFileRemoved: (evt: FileRemovedEvent) => void;
  /** Reaction added — bump the count on the matching emoji, add a new
   *  entry if the emoji is new. */
  onReactionAdded: (evt: ReactionEvent) => void;
  /** Reaction removed — decrement the count on the matching emoji,
   *  drop the entry when the count hits zero. */
  onReactionRemoved: (evt: ReactionEvent) => void;
  /** Skip the channel join entirely (caller is server-rendered + read
   *  only). The component still renders the static initial timeline. */
  disabled?: boolean;
}

interface Result {
  /** True after we've joined the channel. */
  connected: boolean;
  joinError: JoinError | null;
  /** Whether the joining user can post. Backend tells us at join time. */
  canComment: boolean;
}

/**
 * Subscribe to `comments:<entity_type>:<entity_uuid>`. Pure RPC-ish —
 * the HTTP controller is what writes; the channel just fan-outs the
 * resulting events so every open thread sees them live.
 *
 * Event catalogue:
 *   - `comment:created` / `comment:updated` / `comment:deleted` — body
 *     changes.
 *   - `file:attached` — new attachment on a comment; payload carries
 *     the fully-serialized comment so we can atomically swap it.
 *   - `file:removed` — attachment gone; partial payload to keep the
 *     wire skinny.
 *   - `reaction:added` / `reaction:removed` — emoji reaction toggles;
 *     backend fans out per-subscriber so `own_reacted` is already
 *     resolved from the viewer's perspective.
 */
export function useCommentChannel({
  entityType,
  entityUuid,
  onCreate,
  onUpdate,
  onDelete,
  onFileAttached,
  onFileRemoved,
  onReactionAdded,
  onReactionRemoved,
  disabled = false,
}: Options): Result {
  const [connected, setConnected] = useState(false);
  const [joinError, setJoinError] = useState<JoinError | null>(null);
  const [canComment, setCanComment] = useState(false);

  // Hold the latest callback identities in refs so the effect doesn't
  // tear the channel down on every parent render.
  const onCreateRef = useRef(onCreate);
  const onUpdateRef = useRef(onUpdate);
  const onDeleteRef = useRef(onDelete);
  const onFileAttachedRef = useRef(onFileAttached);
  const onFileRemovedRef = useRef(onFileRemoved);
  const onReactionAddedRef = useRef(onReactionAdded);
  const onReactionRemovedRef = useRef(onReactionRemoved);
  useEffect(() => {
    onCreateRef.current = onCreate;
    onUpdateRef.current = onUpdate;
    onDeleteRef.current = onDelete;
    onFileAttachedRef.current = onFileAttached;
    onFileRemovedRef.current = onFileRemoved;
    onReactionAddedRef.current = onReactionAdded;
    onReactionRemovedRef.current = onReactionRemoved;
  });

  const channelRef = useRef<Channel | null>(null);

  useEffect(() => {
    if (disabled) return;

    let alive = true;
    let cleanup: (() => void) | null = null;

    (async () => {
      const socket = await getSocket();
      if (!socket || !alive) return;

      const topic = `comments:${entityType}:${entityUuid}`;
      const channel = socket.channel(topic, {});
      channelRef.current = channel;

      channel.on("comment:created", (msg: { comment: Comment }) => {
        onCreateRef.current(msg.comment);
      });
      channel.on("comment:updated", (msg: { comment: Comment }) => {
        onUpdateRef.current(msg.comment);
      });
      channel.on("comment:deleted", (msg: { comment: Comment }) => {
        onDeleteRef.current(msg.comment);
      });
      channel.on("file:attached", (msg: FileAttachedEvent) => {
        onFileAttachedRef.current(msg);
      });
      channel.on("file:removed", (msg: FileRemovedEvent) => {
        onFileRemovedRef.current(msg);
      });
      channel.on("reaction:added", (msg: ReactionEvent) => {
        onReactionAddedRef.current(msg);
      });
      channel.on("reaction:removed", (msg: ReactionEvent) => {
        onReactionRemovedRef.current(msg);
      });

      channel
        .join()
        .receive("ok", (resp: { can_comment?: boolean }) => {
          if (!alive) return;
          setConnected(true);
          setCanComment(!!resp.can_comment);
          setJoinError(null);
        })
        .receive("error", (resp: { reason?: string }) => {
          if (!alive) return;
          const reason = resp?.reason;
          if (
            reason === "forbidden" ||
            reason === "not_found" ||
            reason === "bad_topic"
          ) {
            setJoinError({ reason });
          } else {
            setJoinError({ reason: "unknown", raw: resp });
          }
        });

      cleanup = () => {
        try {
          channel.leave();
        } catch {
          // Channel teardown is best-effort.
        }
        channelRef.current = null;
      };
    })();

    return () => {
      alive = false;
      if (cleanup) cleanup();
    };
  }, [entityType, entityUuid, disabled]);

  return { connected, joinError, canComment };
}
