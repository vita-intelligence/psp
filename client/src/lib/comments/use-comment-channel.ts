"use client";

import { useEffect, useRef, useState } from "react";
import type { Channel } from "phoenix";
import { getSocket } from "../realtime/socket";
import type { Comment, CommentEntityType } from "./types";

export type JoinError =
  | { reason: "forbidden" }
  | { reason: "not_found" }
  | { reason: "bad_topic" }
  | { reason: "unknown"; raw?: unknown };

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
 * Mirrors the pattern in `use-live-form.tsx` but stays tiny because
 * there's no per-field collab + no cursor overlay to manage.
 */
export function useCommentChannel({
  entityType,
  entityUuid,
  onCreate,
  onUpdate,
  onDelete,
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
  useEffect(() => {
    onCreateRef.current = onCreate;
    onUpdateRef.current = onUpdate;
    onDeleteRef.current = onDelete;
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
